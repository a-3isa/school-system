import { Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ExceptionStatus, ExceptionType, Role } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId, SCHOOL_WIDE, STAFF } from '../auth/auth.decorators';
import { dbDate } from '../common/dates';
import { localParts } from '../common/time';
import { DevicesController, DevicesService, OwnerGatewaysController } from './devices';
import { GatewayController, IngestService, MqttBridge } from './ingest';
import { AttendanceEvaluator } from './evaluator';
import { LocationsController, LocationsService } from './locations';

export class ResolveDto {
  @IsOptional() @IsString() note?: string;
}

/** The dashboard's list of things someone has to look at. */
@RequiresModule('attendance')
@Roles(...SCHOOL_WIDE)
@Controller('attendance/exceptions')
export class ExceptionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@SchoolId() schoolId: string, @Query('date') date?: string, @Query('status') status?: ExceptionStatus, @Query('type') type?: ExceptionType) {
    return this.prisma.attendanceException.findMany({
      where: { schoolId, date: date ? dbDate(date) : undefined, status, type },
      include: { student: { select: { id: true, firstName: true, lastName: true, class: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /**
   * Anyone responsible can resolve an exception on its own day; after that it
   * needs an admin (decision C18).
   */
  @Roles(Role.SCHOOL_ADMIN, Role.TRANSPORT, Role.NURSE, Role.SOCIAL_WORKER)
  @Post(':id/resolve')
  async resolve(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: ResolveDto) {
    const ex = await this.prisma.attendanceException.findFirst({ where: { id, schoolId } });
    if (!ex) throw new NotFoundException('Exception not found.');
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const today = localParts(new Date(), school.timezone).date;
    if (user.role !== Role.SCHOOL_ADMIN && ex.date.toISOString().slice(0, 10) !== today) {
      throw new ForbiddenException('This is from an earlier day. An admin has to resolve it.');
    }
    const updated = await this.prisma.attendanceException.update({
      where: { id },
      data: { status: ExceptionStatus.RESOLVED, note: dto.note, resolvedById: user.id, resolvedAt: new Date() },
    });
    await this.audit.log(user, 'exception.resolve', 'exception', id, { type: ex.type, note: dto.note ?? null });
    return updated;
  }
}

@Module({
  controllers: [DevicesController, OwnerGatewaysController, GatewayController, ExceptionsController, LocationsController],
  providers: [DevicesService, IngestService, MqttBridge, AttendanceEvaluator, LocationsService],
  exports: [AttendanceEvaluator, IngestService, LocationsService],
})
export class DevicesModule {}
