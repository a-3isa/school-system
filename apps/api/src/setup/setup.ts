import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { AttendanceMode, Role, RoomKind } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { mapPrismaError, TIME_RE, toMinutes } from '../common/validation';

// ---------- DTOs ----------

export class SchoolSettingsDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsEnum(AttendanceMode) attendanceMode?: AttendanceMode;
  @IsOptional() @Matches(TIME_RE, { message: 'absenceNoticeTime must look like 08:15' }) absenceNoticeTime?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  schoolDays?: number[];
}

export class GradeDto {
  @IsString() @MinLength(1) name: string;
  @IsInt() order: number;
}

export class ClassDto {
  @IsString() @MinLength(1) name: string;
  @IsString() gradeId: string;
  @IsOptional() @IsString() homeroomTeacherId?: string;
}

export class RoomDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsEnum(RoomKind) kind?: RoomKind;
}

export class SubjectDto {
  @IsString() @MinLength(1) name: string;
}

export class PeriodDto {
  @IsInt() @Min(1) number: number;
  @Matches(TIME_RE, { message: 'startTime must look like 08:00' }) startTime: string;
  @Matches(TIME_RE, { message: 'endTime must look like 08:45' }) endTime: string;
}

// ---------- Service ----------

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  school(schoolId: string) {
    return this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  }

  async updateSchool(user: AuthUser, schoolId: string, dto: SchoolSettingsDto) {
    if (dto.attendanceMode === AttendanceMode.AUTOMATIC) {
      const mod = await this.prisma.schoolModule.findUnique({ where: { schoolId_key: { schoolId, key: 'attendance' } } });
      const automatic = (mod?.features as Record<string, boolean> | undefined)?.automatic;
      if (!mod?.enabled || !automatic) {
        throw new BadRequestException('Automatic attendance isn’t included in this school’s plan.');
      }
    }
    const school = await this.prisma.school.update({
      where: { id: schoolId },
      data: { ...dto, schoolDays: dto.schoolDays ? [...new Set(dto.schoolDays)].sort() : undefined },
    });
    await this.audit.log(user, 'school.update', 'school', schoolId, { ...dto });
    return school;
  }

  async checkPeriod(schoolId: string, dto: PeriodDto, ignoreId?: string) {
    const start = toMinutes(dto.startTime);
    const end = toMinutes(dto.endTime);
    if (end <= start) throw new BadRequestException('A period must end after it starts.');
    const others = await this.prisma.period.findMany({ where: { schoolId, NOT: ignoreId ? { id: ignoreId } : undefined } });
    const clash = others.find((p) => start < toMinutes(p.endTime) && toMinutes(p.startTime) < end);
    if (clash) throw new BadRequestException(`Overlaps period ${clash.number} (${clash.startTime}–${clash.endTime}).`);
  }

  async assertOwned(model: 'grade' | 'user', schoolId: string, id: string | undefined, label: string) {
    if (!id) return;
    const row = model === 'grade'
      ? await this.prisma.grade.findFirst({ where: { id, schoolId } })
      : await this.prisma.user.findFirst({ where: { id, schoolId, role: Role.TEACHER } });
    if (!row) throw new BadRequestException(`${label} not found in this school.`);
  }
}

// ---------- Controllers ----------

@Controller('school')
export class SchoolController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  get(@SchoolId() schoolId: string) {
    return this.setup.school(schoolId);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch()
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: SchoolSettingsDto) {
    return this.setup.updateSchool(user, schoolId, dto);
  }
}

@Roles(...STAFF)
@Controller('grades')
export class GradesController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: GradeDto) {
    const grade = await this.prisma.grade.create({ data: { ...dto, schoolId } }).catch((e) => mapPrismaError(e, 'A grade with this name already exists.'));
    await this.audit.log(user, 'grade.create', 'grade', grade.id, { ...dto });
    return grade;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.grade.deleteMany({ where: { id, schoolId } }).catch((e) => mapPrismaError(e));
    if (!count) throw new NotFoundException('Grade not found.');
    await this.audit.log(user, 'grade.delete', 'grade', id);
    return { ok: true };
  }
}

@Roles(...STAFF)
@Controller('classes')
export class ClassesController {
  constructor(private readonly prisma: PrismaService, private readonly setup: SetupService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.class.findMany({
      where: { schoolId },
      include: { grade: true, homeroomTeacher: { select: { id: true, name: true } }, _count: { select: { students: true } } },
      orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
    });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: ClassDto) {
    await this.setup.assertOwned('grade', schoolId, dto.gradeId, 'Grade');
    await this.setup.assertOwned('user', schoolId, dto.homeroomTeacherId, 'Teacher');
    const cls = await this.prisma.class.create({ data: { ...dto, schoolId } }).catch((e) => mapPrismaError(e, 'A class with this name already exists.'));
    await this.audit.log(user, 'class.create', 'class', cls.id, { ...dto });
    return cls;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.class.deleteMany({ where: { id, schoolId } }).catch((e) => mapPrismaError(e));
    if (!count) throw new NotFoundException('Class not found.');
    await this.audit.log(user, 'class.delete', 'class', id);
    return { ok: true };
  }
}

@Roles(...STAFF)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.room.findMany({ where: { schoolId }, orderBy: { name: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: RoomDto) {
    const room = await this.prisma.room.create({ data: { ...dto, schoolId } }).catch((e) => mapPrismaError(e, 'A room with this name already exists.'));
    await this.audit.log(user, 'room.create', 'room', room.id, { ...dto });
    return room;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.room.deleteMany({ where: { id, schoolId } }).catch((e) => mapPrismaError(e));
    if (!count) throw new NotFoundException('Room not found.');
    await this.audit.log(user, 'room.delete', 'room', id);
    return { ok: true };
  }
}

@Roles(...STAFF)
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: SubjectDto) {
    const subject = await this.prisma.subject.create({ data: { ...dto, schoolId } }).catch((e) => mapPrismaError(e, 'A subject with this name already exists.'));
    await this.audit.log(user, 'subject.create', 'subject', subject.id, { ...dto });
    return subject;
  }
}

@Roles(...STAFF)
@Controller('periods')
export class PeriodsController {
  constructor(private readonly prisma: PrismaService, private readonly setup: SetupService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.period.findMany({ where: { schoolId }, orderBy: { number: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: PeriodDto) {
    await this.setup.checkPeriod(schoolId, dto);
    const period = await this.prisma.period.create({ data: { ...dto, schoolId } }).catch((e) => mapPrismaError(e, `Period ${dto.number} already exists.`));
    await this.audit.log(user, 'period.create', 'period', period.id, { ...dto });
    return period;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: PeriodDto) {
    if (!(await this.prisma.period.findFirst({ where: { id, schoolId } }))) throw new NotFoundException('Period not found.');
    await this.setup.checkPeriod(schoolId, dto, id);
    const period = await this.prisma.period.update({ where: { id }, data: dto }).catch((e) => mapPrismaError(e, `Period ${dto.number} already exists.`));
    await this.audit.log(user, 'period.update', 'period', id, { ...dto });
    return period;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.period.deleteMany({ where: { id, schoolId } });
    if (!count) throw new NotFoundException('Period not found.');
    await this.audit.log(user, 'period.delete', 'period', id);
    return { ok: true };
  }
}

@Module({
  controllers: [SchoolController, GradesController, ClassesController, RoomsController, SubjectsController, PeriodsController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
