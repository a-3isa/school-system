import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Injectable, Module, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { CodePurpose, Role } from '@prisma/client';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { createHash, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications';
import { AuditService } from '../audit/audit';
import { isModuleKey, ModuleKey, MODULES, visibleFeatures } from '../platform/registry';
import { AuthUser, CurrentUser, Public, Roles } from './auth.decorators';
import { EmailService } from './email';
import { ChatGateway } from '../messaging/chat.gateway';
import { ChatGatewayModule } from '../messaging/chat-gateway.module';
import { LoginThrottleService } from './login-throttle';
import { SESSION_DAYS } from './session';
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
// No fallback: a known default would let anyone sign their own tokens on a server started without one.
const SECRET = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Set JWT_SECRET (see apps/api/.env.example) before starting the API.');
  return secret;
};
// Sign-up tickets are signed with their own key, so one can never be used to sign in.
const TICKET_SECRET = () => `${SECRET()}:signup-ticket`;
const hashCode = (target: string, code: string) => createHash('sha256').update(`${target}:${code}:${SECRET()}`).digest('hex');
const wrongCode = () => new UnauthorizedException('That code is wrong or has expired. Ask for a new one.');


/** The school's name for a letter, or a neutral one. */
const schoolName = (user: { school?: { name: string } | null }) => user.school?.name ?? 'Your school';

/** A short, courteous letter in English and then Arabic, signed by the school. */
function letter(name: string, school: string, en: string, ar: string) {
  return `Dear ${name},\n\n${en}\n\nKind regards,\n${school}\n\n———\n\nعزيزنا ولي الأمر ${name}،\n\n${ar}\n\nمع خالص التحية،\n${school}`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly throttle: LoginThrottleService,
    private readonly chat: ChatGateway,
  ) {}

  private async issue(user: { id: string; schoolId: string | null; role: string; name: string; sessionVersion: number }) {
    const token = await this.jwt.signAsync({ sub: user.id, schoolId: user.schoolId, role: user.role, sv: user.sessionVersion }, { expiresIn: `${SESSION_DAYS(user.role)}d` });
    return { token, user: { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId } };
  }

  /** Everyone signs in with their email and password. */
  async login(login: string, password: string, address = 'unknown') {
    const email = login.trim().toLowerCase();
    await this.throttle.check(email, address);
    const user = await this.prisma.user.findFirst({ where: { email, active: true } });
    const ok = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      await this.throttle.fail(email, address);
      throw new UnauthorizedException('Wrong email or password.');
    }
    await this.throttle.succeed(email, address);
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
          title: `${user.name} updated their mobile number`,
          body: before.phone ? `${user.name} verified a new mobile number, ${phone}, ${how}. It replaces ${before.phone}.` : `${user.name} verified their mobile number, ${phone}, ${how}.`,
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
        subject: `${schoolName(user)}: you already have an account · لديكم حساب بالفعل`,
        text: letter(user.name, schoolName(user),
          `You already have an account with ${schoolName(user)}. Please sign in with this email address, or choose “Forgot password?” in the app.`,
          `لديكم حساب بالفعل لدى ${schoolName(user)}. يُرجى تسجيل الدخول بهذا البريد، أو اختيار «نسيت كلمة المرور؟» في التطبيق.`),
      });
    } else {
      const code = await this.newCode(email, CodePurpose.SIGNUP);
      await this.email.send({
        to: email,
        subject: `${schoolName(user)}: your registration code ${code} · رمز التسجيل`,
        text: letter(user.name, schoolName(user),
          `Welcome to ${schoolName(user)}. Your registration code is ${code}. Please enter it in the app to continue; it is valid for 15 minutes.\n\nIf you did not request this, you may safely ignore this email.`,
          `أهلًا بكم في ${schoolName(user)}. رمز التسجيل الخاص بكم هو ${code}. يُرجى إدخاله في التطبيق للمتابعة، وهو صالح لمدة 15 دقيقة.\n\nإن لم تطلبوا هذا الرمز، يمكنكم تجاهل هذه الرسالة.`),
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
    const user = await this.prisma.user.findUnique({ where: { email }, include: { school: { select: { name: true } } } });
    if (!user?.active || !user.passwordHash) {
      await this.nothingSent(email, CodePurpose.RESET);
    } else {
      const code = await this.newCode(email, CodePurpose.RESET);
      await this.email.send({
        to: email,
        subject: `${schoolName(user)}: your password reset code ${code} · رمز إعادة تعيين كلمة المرور`,
        text: letter(user.name, schoolName(user),
          `Your code to choose a new password is ${code}. It is valid for 15 minutes.\n\nIf you did not request this, you may safely ignore this email; your password will not change.`,
          `رمز اختيار كلمة مرور جديدة هو ${code}، وهو صالح لمدة 15 دقيقة.\n\nإن لم تطلبوا ذلك، يمكنكم تجاهل هذه الرسالة؛ ولن تتغير كلمة المرور.`),
      });
    }
    return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async resetPassword(rawEmail: string, code: string, password: string) {
    const email = rawEmail.trim().toLowerCase();
    await this.useCode(email, CodePurpose.RESET, code);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.active || !user.passwordHash) throw wrongCode();
    // A new password ends every sign-in made before it; the one issued here is made under the new number and stays.
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), sessionVersion: { increment: 1 } } });
    await this.dropConnections(user.id);
    return this.issue(updated);
  }

  /** Ends every sign-in this person has, on every device. */
  async signOutEverywhere(auth: AuthUser) {
    await this.prisma.user.update({ where: { id: auth.id }, data: { sessionVersion: { increment: 1 } } });
    await this.dropConnections(auth.id);
    return { signedOut: true };
  }

  /** After the sign-ins are ended: close the open chat, and stop pushing to the phones, which no longer have a login to ask for anything. */
  private async dropConnections(userId: string) {
    this.chat.disconnectUser(userId);
    await this.prisma.deviceToken.deleteMany({ where: { userId } });
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
        id: true, name: true, honorific: true, email: true, phone: true, phoneVerifiedAt: true, role: true, schoolId: true, consentAt: true,
        school: { select: { name: true, nameAr: true, attendanceMode: true, logoMime: true } },
      },
    });
    const rows = auth.schoolId ? await this.prisma.schoolModule.findMany({ where: { schoolId: auth.schoolId, enabled: true } }) : [];
    // Only modules that are built, so screens never offer what doesn't exist yet.
    const built = rows.filter((m) => isModuleKey(m.key) && MODULES[m.key].available);
    const modules = built.map((m) => m.key);
    // Each enabled module's feature switches, so screens can hide what a school doesn't have.
    const features: Record<string, Record<string, boolean>> = {};
    for (const m of built) features[m.key] = visibleFeatures(m.key as ModuleKey, m.features as Record<string, boolean> | null);
    // The school subscribes to automatic attendance: straps, gateways and tracking.
    const straps = !!features.attendance?.automatic;
    const { school, ...rest } = user;
    return { ...rest, schoolName: school?.name ?? null, schoolNameAr: school?.nameAr ?? null, schoolLogo: !!school?.logoMime, attendanceMode: school?.attendanceMode ?? null, straps, modules, features };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: { ip?: string }) {
    return this.auth.login(dto.login, dto.password, req.ip);
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

  /** "Sign out of all devices": every sign-in made before now stops working. */
  @Post('sign-out-everywhere')
  signOutEverywhere(@CurrentUser() user: AuthUser) {
    return this.auth.signOutEverywhere(user);
  }
}

@Module({
  imports: [
    ChatGatewayModule,
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: SECRET(),
        // Every token states its own lifetime (see issue()); this is only the safe default.
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailService, WhatsAppService, LoginThrottleService],
  exports: [EmailService, WhatsAppService],
})
export class AuthModule {}
