import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { localParts } from '../common/time';
import { toMinutes } from '../common/validation';

export class TimetableEntryDto {
  @IsString() classId: string;
  @IsInt() @Min(0) @Max(6) dayOfWeek: number;
  @IsString() periodId: string;
  @IsString() roomId: string;
  @IsString() subjectId: string;
  @IsOptional() @IsString() teacherId?: string;
}

const entryInclude = {
  class: { select: { id: true, name: true } },
  period: true,
  room: { select: { id: true, name: true, kind: true } },
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, name: true, honorific: true } },
} satisfies Prisma.TimetableEntryInclude;

@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(schoolId: string, filter: { classId?: string; roomId?: string; teacherId?: string }) {
    return this.prisma.timetableEntry.findMany({
      where: { schoolId, ...filter },
      include: entryInclude,
      orderBy: [{ dayOfWeek: 'asc' }, { period: { number: 'asc' } }],
    });
  }

  async create(user: AuthUser, schoolId: string, dto: TimetableEntryDto) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    if (!school.schoolDays.includes(dto.dayOfWeek)) throw new BadRequestException('That day isn’t a school day.');

    const [cls, period, room, subject, teacher] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: dto.classId, schoolId } }),
      this.prisma.period.findFirst({ where: { id: dto.periodId, schoolId } }),
      this.prisma.room.findFirst({ where: { id: dto.roomId, schoolId } }),
      this.prisma.subject.findFirst({ where: { id: dto.subjectId, schoolId } }),
      dto.teacherId ? this.prisma.user.findFirst({ where: { id: dto.teacherId, schoolId, role: Role.TEACHER } }) : null,
    ]);
    if (!cls) throw new BadRequestException('Class not found in this school.');
    if (!period) throw new BadRequestException('Period not found in this school.');
    if (!room) throw new BadRequestException('Room not found in this school.');
    if (!subject) throw new BadRequestException('Subject not found in this school.');
    if (dto.teacherId && !teacher) throw new BadRequestException('Teacher not found in this school.');

    // Explain clashes precisely instead of relying on a bare unique-constraint error.
    const slot = { dayOfWeek: dto.dayOfWeek, periodId: dto.periodId };
    const clashes = await this.prisma.timetableEntry.findMany({
      where: {
        schoolId,
        ...slot,
        OR: [{ classId: dto.classId }, { roomId: dto.roomId }, ...(dto.teacherId ? [{ teacherId: dto.teacherId }] : [])],
      },
      include: entryInclude,
    });
    for (const c of clashes) {
      if (c.classId === dto.classId) throw new ConflictException(`${cls.name} already has ${c.subject.name} in period ${period.number}.`);
      if (c.roomId === dto.roomId) throw new ConflictException(`${room.name} is already used by ${c.class.name} in period ${period.number}.`);
      if (dto.teacherId && c.teacherId === dto.teacherId) throw new ConflictException(`${teacher!.name} already teaches ${c.class.name} in period ${period.number}.`);
    }

    const entry = await this.prisma.timetableEntry.create({ data: { ...dto, schoolId }, include: entryInclude });
    await this.audit.log(user, 'timetable.create', 'timetable', entry.id, { ...dto });
    return entry;
  }

  async remove(user: AuthUser, schoolId: string, id: string) {
    const { count } = await this.prisma.timetableEntry.deleteMany({ where: { id, schoolId } });
    if (!count) throw new NotFoundException('Lesson not found.');
    await this.audit.log(user, 'timetable.delete', 'timetable', id);
    return { ok: true };
  }

  /**
   * The lesson happening at a moment, for a room or a class. Automatic
   * attendance uses this to know which class a room gateway is hearing.
   */
  async lessonAt(schoolId: string, at: Date, where: { roomId?: string; classId?: string }) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const { dayOfWeek, time, date } = localParts(at, school.timezone);
    const now = toMinutes(time);
    const period = (await this.prisma.period.findMany({ where: { schoolId } })).find(
      (p) => toMinutes(p.startTime) <= now && now < toMinutes(p.endTime),
    );
    if (!period) return { date, dayOfWeek, time, period: null, lesson: null };
    const lesson = await this.prisma.timetableEntry.findFirst({
      where: { schoolId, dayOfWeek, periodId: period.id, ...where },
      include: entryInclude,
    });
    return { date, dayOfWeek, time, period, lesson };
  }
}

@Roles(...STAFF)
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  /** A teacher sees only their own lessons; other staff see the whole school. */
  @Get()
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query('classId') classId?: string, @Query('roomId') roomId?: string, @Query('teacherId') teacherId?: string) {
    if (user.role === Role.TEACHER) return this.timetable.list(schoolId, { teacherId: user.id });
    return this.timetable.list(schoolId, { classId, roomId, teacherId });
  }

  @Get('now')
  now(@SchoolId() schoolId: string, @Query('roomId') roomId?: string, @Query('classId') classId?: string, @Query('at') at?: string) {
    if (!roomId && !classId) throw new BadRequestException('Give a roomId or a classId.');
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) throw new BadRequestException('“at” must be a date and time.');
    return this.timetable.lessonAt(schoolId, when, { roomId, classId });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: TimetableEntryDto) {
    return this.timetable.create(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.timetable.remove(user, schoolId, id);
  }
}

@Module({ controllers: [TimetableController], providers: [TimetableService], exports: [TimetableService] })
export class TimetableModule {}
