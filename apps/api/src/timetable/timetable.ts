import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { localParts } from '../common/time';
import { toMinutes } from '../common/validation';
import { CurriculumController, CurriculumService } from './curriculum';

export class TimetableEntryDto {
  @IsString() classId: string;
  @IsInt() @Min(0) @Max(6) dayOfWeek: number;
  @IsString() periodId: string;
  @IsString() roomId: string;
  @IsString() subjectId: string;
  /** Only needed when the subject has no teacher yet in this class: who it is. Otherwise the lesson has the subject's teacher. */
  @IsOptional() @IsString() teacherId?: string;
}

/** Who teaches a subject in a class: set once for all of its lessons. `null` takes the teacher off them. */
export class AssignTeacherDto {
  @IsString() classId: string;
  @IsString() subjectId: string;
  @ValidateIf((d) => d.teacherId !== null) @IsString() teacherId: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const entryInclude = {
  class: { select: { id: true, name: true } },
  period: true,
  room: { select: { id: true, name: true, kind: true } },
  subject: { select: { id: true, name: true, nameAr: true } },
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

  /**
   * Places a subject in one of the school's fixed periods for a class. The subject must be one of the
   * class's subjects (its year group's), and the teacher is the subject's teacher in that class: the
   * school assigns subjects to teachers, and the lessons follow. When the subject has no teacher yet,
   * `teacherId` says who it is and becomes the teacher of all of its lessons in the class.
   */
  async create(user: AuthUser, schoolId: string, dto: TimetableEntryDto) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    if (!school.schoolDays.includes(dto.dayOfWeek)) throw new BadRequestException('That day isn’t a school day.');

    const [cls, period, room, subject] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: dto.classId, schoolId } }),
      this.prisma.period.findFirst({ where: { id: dto.periodId, schoolId } }),
      this.prisma.room.findFirst({ where: { id: dto.roomId, schoolId } }),
      this.prisma.subject.findFirst({ where: { id: dto.subjectId, schoolId } }),
    ]);
    if (!cls) throw new BadRequestException('Class not found in this school.');
    if (!period) throw new BadRequestException('Period not found in this school.');
    if (!room) throw new BadRequestException('Room not found in this school.');
    if (!subject) throw new BadRequestException('Subject not found in this school.');

    const assigned = await this.prisma.classSubject.findUnique({
      where: { classId_subjectId: { classId: dto.classId, subjectId: dto.subjectId } },
      include: { teacher: { select: { id: true, name: true, active: true } } },
    });
    if (!assigned) throw new BadRequestException('This subject isn’t one of this class’s subjects. Add it to the year group’s subjects first.');
    const needsTeacher = !assigned.teacher;
    if (needsTeacher && !dto.teacherId) throw new BadRequestException('Choose the teacher of this subject in this class.');
    if (!needsTeacher && dto.teacherId && dto.teacherId !== assigned.teacher!.id) {
      throw new BadRequestException(`${assigned.teacher!.name} teaches ${subject.name} in ${cls.name}. To change the teacher, change it for the whole subject.`);
    }
    const teacher = needsTeacher
      ? await this.prisma.user.findFirst({ where: { id: dto.teacherId!, schoolId, role: Role.TEACHER, active: true }, select: { id: true, name: true } })
      : assigned.teacher;
    if (!teacher) throw new BadRequestException('Teacher not found in this school.');

    // Explain clashes precisely instead of relying on a bare unique-constraint error.
    const clashes = await this.prisma.timetableEntry.findMany({
      where: { schoolId, dayOfWeek: dto.dayOfWeek, periodId: dto.periodId, OR: [{ classId: dto.classId }, { roomId: dto.roomId }, { teacherId: teacher.id }] },
      include: entryInclude,
    });
    for (const c of clashes) {
      if (c.classId === dto.classId) throw new ConflictException(`${cls.name} already has ${c.subject.name} in period ${period.number}.`);
      if (c.roomId === dto.roomId) throw new ConflictException(`${room.name} is already used by ${c.class.name} in period ${period.number}.`);
      if (c.teacherId === teacher.id) throw new ConflictException(`${teacher.name} already teaches ${c.class.name} in period ${period.number}.`);
    }

    // The first time a subject is placed with a teacher, that teacher takes the whole subject in the class.
    if (needsTeacher) await this.assignTeacher(user, schoolId, { classId: dto.classId, subjectId: dto.subjectId, teacherId: teacher.id });
    const entry = await this.prisma.timetableEntry.create({
      data: { schoolId, classId: dto.classId, dayOfWeek: dto.dayOfWeek, periodId: dto.periodId, roomId: dto.roomId, subjectId: dto.subjectId, teacherId: teacher.id },
      include: entryInclude,
    });
    await this.audit.log(user, 'timetable.create', 'timetable', entry.id, { classId: dto.classId, dayOfWeek: dto.dayOfWeek, periodId: dto.periodId, roomId: dto.roomId, subjectId: dto.subjectId, teacherId: teacher.id });
    return entry;
  }

  /**
   * The teacher of a subject in a class: one person for the whole subject, so every lesson of it in the
   * class is theirs and marks, attendance and parent chat all agree. A teacher can't be in two classes at
   * once, so a clash with another of their lessons is refused and nothing changes. `null` takes the teacher off.
   */
  async assignTeacher(user: AuthUser, schoolId: string, dto: AssignTeacherDto) {
    const [cls, subject] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: dto.classId, schoolId }, select: { id: true, name: true } }),
      this.prisma.subject.findFirst({ where: { id: dto.subjectId, schoolId }, select: { id: true, name: true } }),
    ]);
    if (!cls) throw new BadRequestException('Class not found in this school.');
    if (!subject) throw new BadRequestException('Subject not found in this school.');
    const key = { classId_subjectId: { classId: dto.classId, subjectId: dto.subjectId } };
    if (!(await this.prisma.classSubject.findUnique({ where: key, select: { classId: true } }))) {
      throw new BadRequestException('This subject isn’t one of this class’s subjects. Add it to the year group’s subjects first.');
    }
    const lessons = await this.prisma.timetableEntry.findMany({ where: { schoolId, classId: dto.classId, subjectId: dto.subjectId }, select: { id: true, dayOfWeek: true, periodId: true } });

    let teacher: { id: string; name: string; honorific: string | null } | null = null;
    if (dto.teacherId) {
      teacher = await this.prisma.user.findFirst({ where: { id: dto.teacherId, schoolId, role: Role.TEACHER, active: true }, select: { id: true, name: true, honorific: true } });
      if (!teacher) throw new BadRequestException('Teacher not found in this school.');
      if (lessons.length) {
        const busy = await this.prisma.timetableEntry.findFirst({
          where: { schoolId, teacherId: teacher.id, id: { notIn: lessons.map((l) => l.id) }, OR: lessons.map((l) => ({ dayOfWeek: l.dayOfWeek, periodId: l.periodId })) },
          include: { class: { select: { name: true } }, period: { select: { number: true } } },
        });
        if (busy) throw new ConflictException(`${teacher.name} already teaches ${busy.class.name} on ${DAY_NAMES[busy.dayOfWeek]} in period ${busy.period.number}.`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.classSubject.update({ where: key, data: { teacherId: dto.teacherId } }),
      this.prisma.timetableEntry.updateMany({ where: { id: { in: lessons.map((l) => l.id) } }, data: { teacherId: dto.teacherId } }),
    ]);
    await this.audit.log(user, 'timetable.assign', 'class', dto.classId, { subjectId: dto.subjectId, teacherId: dto.teacherId, lessons: lessons.length });
    return { lessons: lessons.length, teacher };
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
  @Put('assign')
  assign(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: AssignTeacherDto) {
    return this.timetable.assignTeacher(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.timetable.remove(user, schoolId, id);
  }
}

@Module({ controllers: [TimetableController, CurriculumController], providers: [TimetableService, CurriculumService], exports: [TimetableService] })
export class TimetableModule {}
