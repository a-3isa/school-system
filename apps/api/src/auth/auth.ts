import { Body, Controller, Get, HttpException, HttpStatus, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { EmailCodePurpose, Role } from '@prisma/client';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { createHash, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public } from './auth.decorators';
import { EmailService } from './email';

export class LoginDto {
  @IsString()
  login: string; // email

  @IsString()
  @MinLength(1)
  password: string;
}

export class EmailDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;
}

export class SetPasswordDto extends EmailDto {
  @Matches(/^\d{6}$/, { message: 'The code has 6 digits.' })
  code: string;

  @IsString()
  @MinLength(8, { message: 'Choose a password of at least 8 characters.' })
  password: string;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const hashCode = (email: string, code: string) => createHash('sha256').update(`${email}:${code}:${process.env.JWT_SECRET ?? 'dev-secret'}`).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  private async issue(user: { id: string; schoolId: string | null; role: string; name: string }) {
    const token = await this.jwt.signAsync({ sub: user.id, schoolId: user.schoolId, role: user.role });
    return { token, user: { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId } };
  }

  /** Everyone signs in with their email and password. */
  async login(login: string, password: string) {
    const user = await this.prisma.user.findFirst({ where: { email: login.trim().toLowerCase(), active: true } });
    const ok = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password.');
    return this.issue(user);
  }

  private async limit(email: string) {
    const recent = await this.prisma.emailCode.count({ where: { email, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent >= MAX_CODES_PER_HOUR) {
      throw new HttpException('Too many codes for this email. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async sendCode(email: string, purpose: EmailCodePurpose, subject: string, text: (code: string) => string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.emailCode.create({ data: { email, purpose, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    await this.email.send({ to: email, subject, text: text(code) });
  }

  /**
   * A parent creates their account in the app. Only an email the school has
   * registered gets a code; the answer is the same either way, so the app
   * can't be used to find out who is a parent at which school.
   */
  async startSignup(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    await this.limit(email);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { school: { select: { name: true } } } });
    if (!user?.active || user.role !== Role.PARENT) {
      await this.prisma.emailCode.create({ data: { email, purpose: EmailCodePurpose.SIGNUP, codeHash: 'none', expiresAt: new Date() } });
    } else if (user.passwordHash) {
      await this.email.send({
        to: email,
        subject: 'You already have an account',
        text: `Hello ${user.name},\n\nYou already have an account for ${user.school?.name ?? 'your school'}. Sign in with this email, or choose “Forgot password” in the app.`,
      });
    } else {
      await this.sendCode(email, EmailCodePurpose.SIGNUP, 'Your sign-up code', (code) =>
        `Hello ${user.name},\n\n${user.school?.name ?? 'The school'} registered this email for you. Your sign-up code is ${code}.\nType it in the app to choose your password. It works for 15 minutes.\n\nIf you didn’t ask for it, ignore this email.`,
      );
    }
    return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  /** Forgot password: a code to any active account with this email. Same answer either way. */
  async forgotPassword(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    await this.limit(email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.active) {
      await this.prisma.emailCode.create({ data: { email, purpose: EmailCodePurpose.RESET, codeHash: 'none', expiresAt: new Date() } });
    } else {
      await this.sendCode(email, EmailCodePurpose.RESET, 'Your password reset code', (code) =>
        `Hello ${user.name},\n\nYour code to choose a new password is ${code}. It works for 15 minutes.\n\nIf you didn’t ask for it, ignore this email; your password stays the same.`,
      );
    }
    return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  /** Sign-up or reset: check the emailed code, set the password, and sign in. */
  async setPassword(rawEmail: string, code: string, password: string) {
    const email = rawEmail.trim().toLowerCase();
    const wrong = () => new UnauthorizedException('That code is wrong or has expired. Ask for a new one.');
    const row = await this.prisma.emailCode.findFirst({ where: { email, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!row || row.expiresAt < new Date()) throw wrong();
    // Use up an attempt before comparing, atomically, so parallel guesses can't get past the limit.
    const { count } = await this.prisma.emailCode.updateMany({
      where: { id: row.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (count !== 1 || row.codeHash !== hashCode(email, code)) throw wrong();
    const used = await this.prisma.emailCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw wrong();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.active) throw wrong();
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    return this.issue(updated);
  }

  async me(auth: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: { id: true, name: true, email: true, phone: true, role: true, schoolId: true, consentAt: true, school: { select: { name: true, attendanceMode: true } } },
    });
    const modules = auth.schoolId
      ? (await this.prisma.schoolModule.findMany({ where: { schoolId: auth.schoolId, enabled: true } })).map((m) => m.key)
      : [];
    const { school, ...rest } = user;
    return { ...rest, schoolName: school?.name ?? null, attendanceMode: school?.attendanceMode ?? null, modules };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.login, dto.password);
  }

  /** Parent app › Create account: emails a code if the school registered this email. */
  @Public()
  @Post('signup')
  signup(@Body() dto: EmailDto) {
    return this.auth.startSignup(dto.email);
  }

  @Public()
  @Post('password/forgot')
  forgot(@Body() dto: EmailDto) {
    return this.auth.forgotPassword(dto.email);
  }

  /** The emailed code plus the new password; signs the person in. */
  @Public()
  @Post('password/set')
  setPassword(@Body() dto: SetPasswordDto) {
    return this.auth.setPassword(dto.email, dto.code, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'dev-secret',
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailService],
  exports: [EmailService],
})
export class AuthModule {}
