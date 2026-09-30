import { Body, Controller, Get, HttpException, HttpStatus, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { IsString, Matches, MinLength } from 'class-validator';
import { createHash, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public } from './auth.decorators';
import { WhatsAppService } from './whatsapp';

export class LoginDto {
  @IsString()
  login: string; // email or phone

  @IsString()
  @MinLength(1)
  password: string;
}

export class CodeRequestDto {
  @Matches(/^\+\d{8,15}$/, { message: 'Enter the mobile number with its country code, like +201001234567.' })
  phone: string;
}

export class CodeVerifyDto extends CodeRequestDto {
  @Matches(/^\d{6}$/, { message: 'The code has 6 digits.' })
  code: string;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const hashCode = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}:${process.env.JWT_SECRET ?? 'dev-secret'}`).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private async issue(user: { id: string; schoolId: string | null; role: string; name: string }) {
    const token = await this.jwt.signAsync({ sub: user.id, schoolId: user.schoolId, role: user.role });
    return { token, user: { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId } };
  }

  /**
   * Sends a 6-digit sign-in code by WhatsApp. Answers the same whether or not
   * the number has an account, so the endpoint can't be used to find parents.
   */
  async requestCode(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    const recent = await this.prisma.loginCode.count({ where: { phone, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent >= MAX_CODES_PER_HOUR) {
      throw new HttpException('Too many codes for this number. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (user?.active) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.prisma.loginCode.create({ data: { phone, codeHash: hashCode(phone, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
      await this.whatsapp.sendLoginCode(phone, code);
    } else {
      await this.prisma.loginCode.create({ data: { phone, codeHash: 'none', expiresAt: new Date() } });
    }
    return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async verifyCode(phone: string, code: string) {
    const row = await this.prisma.loginCode.findFirst({ where: { phone, usedAt: null }, orderBy: { createdAt: 'desc' } });
    const wrong = () => new UnauthorizedException('That code is wrong or has expired. Ask for a new one.');
    if (!row || row.expiresAt < new Date() || row.attempts >= MAX_ATTEMPTS) throw wrong();
    if (row.codeHash !== hashCode(phone, code)) {
      await this.prisma.loginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw wrong();
    }
    await this.prisma.loginCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user?.active) throw wrong();
    return this.issue(user);
  }

  async login(login: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: login.toLowerCase() }, { phone: login }], active: true },
    });
    const ok = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedException('Wrong email, phone or password.');
    return this.issue(user);
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

  @Public()
  @Post('code')
  requestCode(@Body() dto: CodeRequestDto) {
    return this.auth.requestCode(dto.phone);
  }

  @Public()
  @Post('code/verify')
  verifyCode(@Body() dto: CodeVerifyDto) {
    return this.auth.verifyCode(dto.phone, dto.code);
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
  providers: [AuthService, WhatsAppService],
  exports: [WhatsAppService],
})
export class AuthModule {}
