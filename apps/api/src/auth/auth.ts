import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { CodePurpose, Role } from '@prisma/client';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { createHash, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Public, Roles } from './auth.decorators';
import { EmailService } from './email';
import { WhatsAppService } from './whatsapp';

const PHONE = /^\+\d{8,15}$/;
const PHONE_MESSAGE = 'Enter the mobile number with its country code, like +201001234567.';

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

export class SignupPhoneDto extends EmailDto {
  @Matches(/^\d{6}$/, { message: 'The code has 6 digits.' })
  emailCode: string;

  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;
}

export class SignupCompleteDto {
  @IsString()
  ticket: string;

  @Matches(/^\d{6}$/, { message: 'The code has 6 digits.' })
  phoneCode: string;

  @IsString()
  @MinLength(8, { message: 'Choose a password of at least 8 characters.' })
  password: string;
}

export class SignupResendDto {
  @IsString()
  ticket: string;

  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;
}

export class ResetPasswordDto extends EmailDto {
  @Matches(/^\d{6}$/, { message: 'The code has 6 digits.' })
  code: string;

  @IsString()
  @MinLength(8, { message: 'Choose a password of at least 8 characters.' })
  password: string;
}

export class PhoneDto {
  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;
}

export class PhoneVerifyDto extends PhoneDto {
  @Matches(/^\d{6}$/, { message: 'The code has 6 digits.' })
  code: string;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const SECRET = () => process.env.JWT_SECRET ?? 'dev-secret';
// Sign-up tickets are signed with their own key, so one can never be used to sign in.
const TICKET_SECRET = () => `${SECRET()}:signup-ticket`;
const hashCode = (target: string, code: string) => createHash('sha256').update(`${target}:${code}:${SECRET()}`).digest('hex');
const wrongCode = () => new UnauthorizedException('That code is wrong or has expired. Ask for a new one.');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
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

  // ---- codes ----------------------------------------------------------------

  private async limit(target: string, purpose: CodePurpose) {
    const recent = await this.prisma.verificationCode.count({ where: { target, purpose, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent >= MAX_CODES_PER_HOUR) throw new HttpException('Too many codes. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
  }

  private async newCode(target: string, purpose: CodePurpose) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.verificationCode.create({ data: { target, purpose, codeHash: hashCode(target, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    return code;
  }

  /** Records a request that sends nothing, so it counts and answers like the others. */
  private nothingSent(target: string, purpose: CodePurpose) {
    return this.prisma.verificationCode.create({ data: { target, purpose, codeHash: 'none', expiresAt: new Date() } });
  }

  /** Checks a code and uses it up. Attempts are counted atomically before comparing. */
  private async useCode(target: string, purpose: CodePurpose, code: string) {
    const row = await this.prisma.verificationCode.findFirst({ where: { target, purpose, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!row || row.expiresAt < new Date()) throw wrongCode();
    const { count } = await this.prisma.verificationCode.updateMany({
      where: { id: row.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (count !== 1 || row.codeHash !== hashCode(target, code)) throw wrongCode();
    const used = await this.prisma.verificationCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw wrongCode();
  }

  private async phoneFree(phone: string, userId: string) {
    const other = await this.prisma.user.findUnique({ where: { phone } });
    if (other && other.id !== userId) throw new BadRequestException('This mobile number is already used by another account.');
  }

  private async sendPhoneCode(phone: string) {
    await this.limit(phone, CodePurpose.PHONE);
    await this.whatsapp.sendCode(phone, await this.newCode(phone, CodePurpose.PHONE));
  }

  /** Saves a mobile the parent proved, and tells the school's admins when it changed. */
  private async savePhone(userId: string, phone: string, how: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const user = await this.prisma.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
    if (before.phone !== phone && user.schoolId) {
      const admins = await this.prisma.user.findMany({ where: { schoolId: user.schoolId, role: Role.SCHOOL_ADMIN, active: true }, select: { id: true } });
      await this.notifications.notify(
        admins.map((a) => ({
          schoolId: user.schoolId!,
          userId: a.id,
          type: 'parent.phoneChanged',
          title: `${user.name} changed their mobile`,
          body: before.phone ? `${user.name} checked a new mobile, ${phone}, ${how}. It replaces ${before.phone}.` : `${user.name} checked their mobile, ${phone}, ${how}.`,
          data: { parentId: user.id, phone, previous: before.phone },
        })),
      );
      await this.audit.log({ id: user.id, schoolId: user.schoolId, role: user.role }, 'parent.phone', 'user', user.id, { phone, previous: before.phone });
    }
    return user;
  }

  // ---- sign-up in the parent app -------------------------------------------

  /**
   * Step 1. Only an email the school registered gets a code; the answer is
   * the same either way, so the app can't be used to find out who is a parent.
   */
  async startSignup(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    await this.limit(email, CodePurpose.SIGNUP);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { school: { select: { name: true } } } });
    if (!user?.active || user.role !== Role.PARENT) {
      await this.nothingSent(email, CodePurpose.SIGNUP);
    } else if (user.passwordHash) {
      await this.nothingSent(email, CodePurpose.SIGNUP);
      await this.email.send({
        to: email,
        subject: 'You already have an account',
        text: `Hello ${user.name},\n\nYou already have an account for ${user.school?.name ?? 'your school'}. Sign in with this email, or choose “Forgot password” in the app.`,
      });
    } else {
      const code = await this.newCode(email, CodePurpose.SIGNUP);
      await this.email.send({
        to: email,
        subject: 'Your sign-up code',
        text: `Hello ${user.name},\n\n${user.school?.name ?? 'The school'} registered this email for you. Your sign-up code is ${code}.\nType it in the app to continue. It works for 15 minutes.\n\nIf you didn’t ask for it, ignore this email.`,
      });
    }
    return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  /** Step 2. The emailed code proves the email; the mobile then gets a WhatsApp code. */
  async signupPhone(rawEmail: string, emailCode: string, phone: string) {
    const email = rawEmail.trim().toLowerCase();
    await this.useCode(email, CodePurpose.SIGNUP, emailCode);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.active || user.role !== Role.PARENT || user.passwordHash) throw wrongCode();
    await this.phoneFree(phone, user.id);
    await this.sendPhoneCode(phone);
    const ticket = await this.jwt.signAsync({ sub: user.id, phone }, { secret: TICKET_SECRET(), expiresIn: '30m' });
    return { ticket, sentTo: phone, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  private async readTicket(ticket: string): Promise<{ sub: string; phone: string }> {
    try {
      return await this.jwt.verifyAsync(ticket, { secret: TICKET_SECRET() });
    } catch {
      throw new UnauthorizedException('Sign-up took too long. Start again.');
    }
  }

  /** Step 2 again: the WhatsApp code didn't arrive, or the number was wrong. */
  async resendSignupPhone(ticket: string, phone: string) {
    const claim = await this.readTicket(ticket);
    const user = await this.prisma.user.findUnique({ where: { id: claim.sub } });
    if (!user?.active || user.passwordHash) throw new UnauthorizedException('Sign-up took too long. Start again.');
    await this.phoneFree(phone, user.id);
    await this.sendPhoneCode(phone);
    const next = await this.jwt.signAsync({ sub: user.id, phone }, { secret: TICKET_SECRET(), expiresIn: '30m' });
    return { ticket: next, sentTo: phone, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  /** Step 3. The WhatsApp code proves the mobile; the password finishes the account. */
  async completeSignup(ticket: string, phoneCode: string, password: string) {
    const claim = await this.readTicket(ticket);
    await this.useCode(claim.phone, CodePurpose.PHONE, phoneCode);
    const user = await this.prisma.user.findUnique({ where: { id: claim.sub } });
    if (!user?.active || user.passwordHash) throw wrongCode();
    await this.phoneFree(claim.phone, user.id);
    await this.savePhone(user.id, claim.phone, 'when signing up in the app');
    const done = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
    });
    return this.issue(done);
  }

  // ---- forgotten password ----------------------------------------------------

  /** Only for accounts that are set up; a parent who never signed up uses Create account. */
  async forgotPassword(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    await this.limit(email, CodePurpose.RESET);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.active || !user.passwordHash) {
      await this.nothingSent(email, CodePurpose.RESET);
    } else {
      const code = await this.newCode(email, CodePurpose.RESET);
      await this.email.send({
        to: email,
        subject: 'Your password reset code',
        text: `Hello ${user.name},\n\nYour code to choose a new password is ${code}. It works for 15 minutes.\n\nIf you didn’t ask for it, ignore this email; your password stays the same.`,
      });
    }
    return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async resetPassword(rawEmail: string, code: string, password: string) {
    const email = rawEmail.trim().toLowerCase();
    await this.useCode(email, CodePurpose.RESET, code);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.active || !user.passwordHash) throw wrongCode();
    return this.issue(await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } }));
  }

  // ---- a parent changing their mobile ----------------------------------------

  async requestPhoneChange(auth: AuthUser, phone: string) {
    await this.phoneFree(phone, auth.id);
    await this.sendPhoneCode(phone);
    return { sentTo: phone, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async confirmPhoneChange(auth: AuthUser, phone: string, code: string) {
    await this.useCode(phone, CodePurpose.PHONE, code);
    await this.phoneFree(phone, auth.id);
    const user = await this.savePhone(auth.id, phone, 'in the app');
    return { phone: user.phone, phoneVerifiedAt: user.phoneVerifiedAt };
  }

  async me(auth: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: {
        id: true, name: true, email: true, phone: true, phoneVerifiedAt: true, role: true, schoolId: true, consentAt: true,
        school: { select: { name: true, attendanceMode: true } },
      },
    });
    const rows = auth.schoolId ? await this.prisma.schoolModule.findMany({ where: { schoolId: auth.schoolId, enabled: true } }) : [];
    const modules = rows.map((m) => m.key);
    // The school subscribes to automatic attendance: straps, gateways and tracking.
    const straps = !!(rows.find((m) => m.key === 'attendance')?.features as Record<string, boolean> | undefined)?.automatic;
    const { school, ...rest } = user;
    return { ...rest, schoolName: school?.name ?? null, attendanceMode: school?.attendanceMode ?? null, straps, modules };
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

  /** Parent app › Create account, step 1: a code to the email the school registered. */
  @Public()
  @Post('signup')
  signup(@Body() dto: EmailDto) {
    return this.auth.startSignup(dto.email);
  }

  /** Step 2: the emailed code and the parent's mobile; a WhatsApp code goes to the mobile. */
  @Public()
  @Post('signup/phone')
  signupPhone(@Body() dto: SignupPhoneDto) {
    return this.auth.signupPhone(dto.email, dto.emailCode, dto.phone);
  }

  /** Send the WhatsApp code again, to the same or a corrected number. */
  @Public()
  @Post('signup/resend')
  signupResend(@Body() dto: SignupResendDto) {
    return this.auth.resendSignupPhone(dto.ticket, dto.phone);
  }

  /** Step 3: the WhatsApp code and a password; the mobile is saved as checked and the parent signed in. */
  @Public()
  @Post('signup/complete')
  signupComplete(@Body() dto: SignupCompleteDto) {
    return this.auth.completeSignup(dto.ticket, dto.phoneCode, dto.password);
  }

  @Public()
  @Post('password/forgot')
  forgot(@Body() dto: EmailDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('password/reset')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.email, dto.code, dto.password);
  }

  /** A signed-in parent changing their mobile: a WhatsApp code to the new number. */
  @Roles(Role.PARENT)
  @Post('phone')
  requestPhone(@CurrentUser() user: AuthUser, @Body() dto: PhoneDto) {
    return this.auth.requestPhoneChange(user, dto.phone);
  }

  @Roles(Role.PARENT)
  @Post('phone/verify')
  verifyPhone(@CurrentUser() user: AuthUser, @Body() dto: PhoneVerifyDto) {
    return this.auth.confirmPhoneChange(user, dto.phone, dto.code);
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
        secret: SECRET(),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailService, WhatsAppService],
  exports: [EmailService, WhatsAppService],
})
export class AuthModule {}
