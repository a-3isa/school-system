import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MODULES, ModuleKey } from '../platform/registry';
import { AuthUser, IS_PUBLIC, REQUIRES_FEATURE, REQUIRES_MODULE, ROLES } from './auth.decorators';

/**
 * Runs on every request: checks the login token, the caller's role and that
 * the school has the route's module switched on.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Sign in first.');

    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
    // Role and school come from the database, not the token, so a deactivated
    // account or a changed role takes effect on the next request.
    const row = await this.prisma.user.findUnique({ where: { id: sub }, select: { id: true, schoolId: true, role: true, active: true } });
    if (!row?.active) throw new UnauthorizedException('Your session has expired. Sign in again.');
    const user: AuthUser = { id: row.id, schoolId: row.schoolId, role: row.role };
    req.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role can’t do this.');
    }

    const moduleKey = this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRES_MODULE, targets);
    if (moduleKey && moduleKey !== 'core') {
      if (!user.schoolId) throw new ForbiddenException('This action needs a school account.');
      const mod = await this.prisma.schoolModule.findUnique({
        where: { schoolId_key: { schoolId: user.schoolId, key: moduleKey } },
      });
      if (!mod?.enabled) {
        throw new ForbiddenException(`${MODULES[moduleKey].name} isn’t switched on for this school.`);
      }
    }

    const needed = this.reflector.getAllAndOverride<{ module: ModuleKey; feature: string } | undefined>(REQUIRES_FEATURE, targets);
    if (needed) {
      if (!user.schoolId) throw new ForbiddenException('This action needs a school account.');
      const mod = await this.prisma.schoolModule.findUnique({
        where: { schoolId_key: { schoolId: user.schoolId, key: needed.module } },
      });
      if (!mod?.enabled || !(mod.features as Record<string, boolean> | null)?.[needed.feature]) {
        throw new ForbiddenException('Smart bands and readers (automatic attendance) aren’t part of this school’s subscription.');
      }
    }
    return true;
  }
}
