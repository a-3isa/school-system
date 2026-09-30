import { Body, Controller, Get, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public } from './auth.decorators';

export class LoginDto {
  @IsString()
  login: string; // email or phone

  @IsString()
  @MinLength(1)
  password: string;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: login.toLowerCase() }, { phone: login }], active: true },
    });
    const ok = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedException('Wrong email, phone or password.');
    const token = await this.jwt.signAsync({ sub: user.id, schoolId: user.schoolId, role: user.role });
    return { token, user: { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId } };
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
  providers: [AuthService],
})
export class AuthModule {}
