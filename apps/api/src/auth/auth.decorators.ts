import { createParamDecorator, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { ModuleKey } from '../platform/registry';

export interface AuthUser {
  id: string;
  schoolId: string | null;
  role: Role;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const REQUIRES_MODULE = 'requiresModule';

/** Every role that works at a school (everyone except parents and the platform owner). */
export const STAFF: Role[] = [Role.SCHOOL_ADMIN, Role.TEACHER, Role.TRANSPORT, Role.NURSE, Role.CANTEEN, Role.ACCOUNTANT];
/** Staff who see the whole school. Teachers see only their own lessons. */
export const SCHOOL_WIDE: Role[] = STAFF.filter((r) => r !== Role.TEACHER);

/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is limited to these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Route only works when the school has this module switched on. */
export const RequiresModule = (key: ModuleKey) => SetMetadata(REQUIRES_MODULE, key);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** The school of the logged-in user. Throws for users without a school (the platform owner). */
export const SchoolId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
  if (!user?.schoolId) throw new ForbiddenException('This action needs a school account.');
  return user.schoolId;
});
