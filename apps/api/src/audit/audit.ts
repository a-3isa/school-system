import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, Roles, SchoolId } from '../auth/auth.decorators';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records who changed what. Call it after every write. */
  log(actor: AuthUser, action: string, entity: string, entityId?: string, data?: Prisma.InputJsonValue, schoolId?: string | null) {
    return this.prisma.auditLog.create({
      data: { schoolId: schoolId ?? actor.schoolId, actorId: actor.id, action, entity, entityId, data },
    });
  }
}

@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles(Role.SCHOOL_ADMIN)
  @Get()
  list(@SchoolId() schoolId: string, @Query('entity') entity?: string) {
    return this.prisma.auditLog.findMany({
      where: { schoolId, ...(entity ? { entity } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
