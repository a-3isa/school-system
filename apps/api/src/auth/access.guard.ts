import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MODULES, ModuleKey } from '../platform/registry';
import { AuthUser, IS_PUBLIC, REQUIRES_FEATURE, REQUIRES_MODULE, ROLES } from './auth.decorators';

/**
 * The account behind a login token's subject, if it is still active. Role and
 * school come from the database, not the token, so a deactivated account or a
 * changed role takes effect on the next request.
 */
export async function loadActiveUser(prisma: PrismaService, sub: string): Promise<AuthUser | null> {
  const row = await prisma.user.findUnique({ where: { id: sub }, select: { id: true, schoolId: true, role: true, active: true } });
  return row?.active ? { id: row.id, schoolId: row.schoolId, role: row.role } : null;
}

/** Does the school have this module switched on and, if given, this feature of it? */
export async function schoolHas(prisma: PrismaService, schoolId: string, module: ModuleKey, feature?: string): Promise<boolean> {
  const mod = await prisma.schoolModule.findUnique({ where: { schoolId_key: { schoolId, key: module } } });
  if (!mod?.enabled) return false;
  return !feature || !!(mod.features as Record<string, boolean> | null)?.[feature];
}

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
    const user = await loadActiveUser(this.prisma, sub);
    if (!user) throw new UnauthorizedException('Your session has expired. Sign in again.');
    req.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role can’t do this.');
    }

    const moduleKey = this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRES_MODULE, targets);
    if (moduleKey && moduleKey !== 'core') {
      if (!user.schoolId) throw new ForbiddenException('This action needs a school account.');
      if (!(await schoolHas(this.prisma, user.schoolId, moduleKey))) {
        throw new ForbiddenException(`${MODULES[moduleKey].name} isn’t switched on for this school.`);
      }
    }

    const needed = this.reflector.getAllAndOverride<{ module: ModuleKey; feature: string } | undefined>(REQUIRES_FEATURE, targets);
    if (needed) {
      if (!user.schoolId) throw new ForbiddenException('This action needs a school account.');
      if (!(await schoolHas(this.prisma, user.schoolId, needed.module, needed.feature))) {
        throw new ForbiddenException(
          needed.module === 'attendance' && needed.feature === 'automatic'
            ? 'Smart bands and readers (automatic attendance) aren’t part of this school’s subscription.'
            : 'This isn’t part of this school’s subscription.',
        );
      }
    }
    return true;
  }
}
