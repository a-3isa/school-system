import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AssessmentKind, Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { dbDate, isoDate } from '../common/dates';
import { localParts } from '../common/time';
import { defined } from '../common/validation';
import { NotificationsService } from '../notifications/notifications';
import { SchoolCalendar } from '../setup/calendar';
import { AcademicsAccess, CANT_MARK } from './access';
import { bandOf, MarkItem, round1, subjectPercent } from './grades';
import { numberOf, ScoreService } from './scores';

export const EXAM_KINDS: AssessmentKind[] = [AssessmentKind.MIDTERM, AssessmentKind.FINAL];
export const DEFAULT_WEIGHT: Record<AssessmentKind, number> = { CLASSWORK: 1, QUIZ: 1, HOMEWORK: 1, PROJECT: 2, MIDTERM: 3, FINAL: 4 };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CANT_READ = 'You can see only the classes and subjects you teach.';

export class CreateAssessmentDto {
  @IsString() classId: string;
  @IsString() subjectId: string;
  @IsEnum(AssessmentKind) kind: AssessmentKind;
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsString() date: string;
  @IsInt() @Min(1) @Max(1000) maxScore: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) weight?: number;
  @IsOptional() @Matches(HHMM) startTime?: string;
  @IsOptional() @Matches(HHMM) endTime?: string;
  @IsOptional() @IsString() roomId?: string;
}

export class UpdateAssessmentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxScore?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) weight?: number;
  @IsOptional() @Matches(HHMM) startTime?: string;
  @IsOptional() @Matches(HHMM) endTime?: string;
  @IsOptional() @ValidateIf((d) => d.roomId !== null) @IsString() roomId?: string | null;
}

export class MarkDto {
  @IsString() studentId: string;
  @IsOptional() @ValidateIf((d) => d.score !== null) @IsNumber() score?: number | null;
  @IsOptional() @IsBoolean() absent?: boolean;
  @IsOptional() @IsBoolean() excused?: boolean;
  @IsOptional() @IsString() @MaxLength(300) comment?: string | null;
}

export class SaveMarksDto {
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => MarkDto) marks: MarkDto[];
}

const listSelect = {
  id: true, kind: true, title: true, date: true, term: true, yearId: true, maxScore: true, weight: true, startTime: true, endTime: true, publishedAt: true, createdById: true,
  class: { select: { id: true, name: true } },
  subject: { select: { id: true, name: true, nameAr: true } },
  room: { select: { id: true, name: true } },
  _count: { select: { marks: true } },
} satisfies Prisma.AssessmentSelect;

const present = ({ _count, ...a }: Prisma.AssessmentGetPayload<{ select: typeof listSelect }>) => ({ ...a, date: isoDate(a.date), markedCount: _count.marks });

@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly calendar: SchoolCalendar,
    private readonly access: AcademicsAccess,
    private readonly scores: ScoreService,
  ) {}

  private async load(schoolId: string, id: string) {
    const a = await this.prisma.assessment.findFirst({ where: { id, schoolId }, include: { class: { select: { id: true, name: true, system: true } }, subject: { select: { id: true, name: true, nameAr: true } } } });
    if (!a) throw new NotFoundException('Assessment not found.');
    return a;
  }

  /**
   * Whoever teaches the subject in the class now. Writing an assessment doesn't keep the right: when a
   * subject changes teacher, the new teacher takes over its assessments and marks.
   */
  private async assertMayChange(user: AuthUser, schoolId: string, a: { classId: string; subjectId: string }) {
    await this.access.assertMayWrite(user, schoolId, a.classId, a.subjectId);
  }

  // ---- the picker ---------------------------------------------------------

  /** The class and subject pairs the caller can open in the gradebook; `canMark` says whether they may enter marks. */
  async teaching(user: AuthUser, schoolId: string) {
    const include = { class: { select: { name: true } }, subject: { select: { name: true, nameAr: true } } };
    const mine = new Set<string>();
    let rows;
    if (user.role === Role.SCHOOL_ADMIN) {
      rows = await this.prisma.classSubject.findMany({ where: { class: { schoolId } }, select: { classId: true, subjectId: true, ...include } });
    } else {
      const homerooms = await this.access.homeroomIds(schoolId, user.id);
      rows = await this.prisma.classSubject.findMany({
        where: { class: { schoolId }, OR: [{ teacherId: user.id }, ...(homerooms.length ? [{ classId: { in: homerooms } }] : [])] },
        select: { classId: true, subjectId: true, teacherId: true, ...include },
      });
      for (const r of rows) if (r.teacherId === user.id) mine.add(`${r.classId}:${r.subjectId}`);
    }
    const seen = new Map<string, { classId: string; className: string; subjectId: string; subjectName: string; subjectNameAr: string | null; canMark: boolean }>();
    for (const r of rows) {
      const key = `${r.classId}:${r.subjectId}`;
      if (!seen.has(key)) seen.set(key, { classId: r.classId, className: r.class.name, subjectId: r.subjectId, subjectName: r.subject.name, subjectNameAr: r.subject.nameAr, canMark: user.role === Role.SCHOOL_ADMIN || mine.has(key) });
    }
    return [...seen.values()].sort((a, b) => a.className.localeCompare(b.className, 'en', { numeric: true }) || a.subjectName.localeCompare(b.subjectName));
  }

  // ---- assessments ----------------------------------------------------------

  async list(user: AuthUser, schoolId: string, q: { classId?: string; subjectId?: string; term?: string; yearId?: string }) {
    const readable = await this.access.readableAssessments(user, schoolId);
    const term = q.term ? Number(q.term) : undefined;
    if (term !== undefined && term !== 1 && term !== 2) throw new BadRequestException('Choose term 1 or 2.');
    const rows = await this.prisma.assessment.findMany({
      where: { AND: [readable, { ...(q.classId ? { classId: q.classId } : {}), ...(q.subjectId ? { subjectId: q.subjectId } : {}), ...(term ? { term } : {}), ...(q.yearId ? { yearId: q.yearId } : {}) }] },
      select: listSelect,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const classIds = [...new Set(rows.map((r) => r.class.id))];
    const counts = await this.prisma.student.groupBy({ by: ['classId'], where: { schoolId, active: true, classId: { in: classIds } }, _count: true });
    const students = new Map(counts.map((c) => [c.classId, c._count]));
    return rows.map((r) => ({ ...present(r), studentCount: students.get(r.class.id) ?? 0 }));
  }

  /** Checks the exam fields together, whichever kind it is. */
  private checkExamFields(kind: AssessmentKind, f: { startTime?: string | null; endTime?: string | null; roomId?: string | null }) {
    if (EXAM_KINDS.includes(kind)) {
      if (!f.startTime || !f.endTime) throw new BadRequestException('Exams need a start and an end time.');
      if (f.endTime <= f.startTime) throw new BadRequestException('An exam must end after it starts.');
    } else if (f.startTime || f.endTime || f.roomId) {
      throw new BadRequestException('Only exams have a time and a room.');
    }
  }

  private async assertNoExamClash(schoolId: string, a: { classId: string; date: string; startTime: string; endTime: string; roomId: string | null }, exceptId?: string) {
    const others = await this.prisma.assessment.findMany({
      where: { schoolId, date: dbDate(a.date), kind: { in: EXAM_KINDS }, ...(exceptId ? { id: { not: exceptId } } : {}), OR: [{ classId: a.classId }, ...(a.roomId ? [{ roomId: a.roomId }] : [])] },
      select: { classId: true, roomId: true, startTime: true, endTime: true },
    });
    const overlapping = others.filter((o) => o.startTime && o.endTime && o.startTime < a.endTime && a.startTime < o.endTime);
    if (overlapping.some((o) => o.classId === a.classId)) throw new BadRequestException('This class already has an exam at that time.');
    if (a.roomId && overlapping.some((o) => o.roomId === a.roomId)) throw new BadRequestException('That room is already used for an exam at that time.');
  }

  async create(user: AuthUser, schoolId: string, dto: CreateAssessmentDto) {
    const [cls, subject] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: dto.classId, schoolId }, select: { id: true } }),
      this.prisma.subject.findFirst({ where: { id: dto.subjectId, schoolId }, select: { id: true } }),
    ]);
    if (!cls) throw new NotFoundException('Class not found.');
    if (!subject) throw new NotFoundException('Subject not found.');
    await this.access.assertMayWrite(user, schoolId, dto.classId, dto.subjectId);
    dbDate(dto.date);
    this.checkExamFields(dto.kind, dto);
    if (dto.roomId && !(await this.prisma.room.findFirst({ where: { id: dto.roomId, schoolId }, select: { id: true } }))) throw new NotFoundException('Room not found.');
    const term = await this.calendar.termOf(schoolId, dto.date);
    if (!term) throw new BadRequestException('That date isn’t in an academic year.');
    if (EXAM_KINDS.includes(dto.kind)) await this.assertNoExamClash(schoolId, { classId: dto.classId, date: dto.date, startTime: dto.startTime!, endTime: dto.endTime!, roomId: dto.roomId ?? null });

    const a = await this.prisma.assessment.create({
      data: {
        schoolId, yearId: term.yearId, term: term.term, classId: dto.classId, subjectId: dto.subjectId, kind: dto.kind, title: dto.title.trim(), date: dbDate(dto.date),
        maxScore: dto.maxScore, weight: dto.weight ?? DEFAULT_WEIGHT[dto.kind], startTime: dto.startTime ?? null, endTime: dto.endTime ?? null, roomId: dto.roomId ?? null, createdById: user.id,
      },
      select: listSelect,
    });
    await this.audit.log(user, 'assessment.create', 'assessment', a.id, { classId: dto.classId, subjectId: dto.subjectId, kind: dto.kind });
    return { ...present(a), studentCount: await this.prisma.student.count({ where: { schoolId, classId: dto.classId, active: true } }) };
  }

  async update(user: AuthUser, schoolId: string, id: string, dto: UpdateAssessmentDto) {
    const a = await this.load(schoolId, id);
    await this.assertMayChange(user, schoolId, a);
    const merged = {
      date: dto.date ?? isoDate(a.date),
      startTime: dto.startTime ?? a.startTime,
      endTime: dto.endTime ?? a.endTime,
      roomId: dto.roomId === undefined ? a.roomId : dto.roomId,
    };
    dbDate(merged.date);
    this.checkExamFields(a.kind, merged);
    if (dto.roomId && !(await this.prisma.room.findFirst({ where: { id: dto.roomId, schoolId }, select: { id: true } }))) throw new NotFoundException('Room not found.');
    if (dto.maxScore !== undefined && dto.maxScore < a.maxScore && (await this.prisma.mark.count({ where: { assessmentId: id, score: { gt: dto.maxScore } } })) > 0) {
      throw new BadRequestException('Some marks are higher than the new maximum.');
    }
    const term = await this.calendar.termOf(schoolId, merged.date);
    if (!term) throw new BadRequestException('That date isn’t in an academic year.');
    if (EXAM_KINDS.includes(a.kind)) await this.assertNoExamClash(schoolId, { classId: a.classId, date: merged.date, startTime: merged.startTime!, endTime: merged.endTime!, roomId: merged.roomId }, id);

    const { date, title, ...rest } = dto;
    const saved = await this.prisma.assessment.update({
      where: { id },
      data: { ...defined({ ...rest, title: title?.trim() }), ...(date !== undefined ? { date: dbDate(date) } : {}), yearId: term.yearId, term: term.term },
      select: listSelect,
    });
    await this.audit.log(user, 'assessment.edit', 'assessment', id, { ...dto });
    return present(saved);
  }

  async remove(user: AuthUser, schoolId: string, id: string) {
    const a = await this.load(schoolId, id);
    await this.assertMayChange(user, schoolId, a);
    if (a.publishedAt) throw new BadRequestException('Published marks can’t be deleted. Unpublish them first.');
    await this.prisma.assessment.delete({ where: { id } });
    await this.audit.log(user, 'assessment.delete', 'assessment', id, { title: a.title });
    return { ok: true };
  }

  // ---- marks --------------------------------------------------------------

  async marks(user: AuthUser, schoolId: string, id: string) {
    const a = await this.load(schoolId, id);
    if (!(await this.access.mayRead(user, schoolId, a.classId, a.subjectId))) throw new ForbiddenException(CANT_READ);
    const [students, marks] = await Promise.all([
      this.prisma.student.findMany({ where: { schoolId, classId: a.classId, active: true }, select: { id: true, firstName: true, lastName: true, code: true }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] }),
      this.prisma.mark.findMany({ where: { assessmentId: id } }),
    ]);
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    return students.map((s) => {
      const m = byStudent.get(s.id);
      return { id: s.id, name: `${s.firstName} ${s.lastName}`, code: s.code, mark: m ? { score: numberOf(m.score), absent: m.absent, excused: m.excused, comment: m.comment } : null };
    });
  }

  async saveMarks(user: AuthUser, schoolId: string, id: string, dto: SaveMarksDto) {
    const a = await this.load(schoolId, id);
    await this.access.assertMayWrite(user, schoolId, a.classId, a.subjectId);
    const ids = [...new Set(dto.marks.map((m) => m.studentId))];
    const inClass = await this.prisma.student.count({ where: { id: { in: ids }, schoolId, classId: a.classId, active: true } });
    if (inClass !== ids.length) throw new BadRequestException('Some of these students aren’t in this class.');

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const m of dto.marks) {
      const absent = !!m.absent;
      if (m.excused && !absent) throw new BadRequestException('Only a student who was absent can be excused.');
      const comment = m.comment?.trim() || null;
      let score: number | null = null;
      if (!absent && m.score !== undefined && m.score !== null) {
        if (m.score < 0 || m.score > a.maxScore) throw new BadRequestException(`Scores must be between 0 and ${a.maxScore}.`);
        if (Math.abs(m.score * 100 - Math.round(m.score * 100)) > 1e-6) throw new BadRequestException('Scores can have at most 2 decimals.');
        score = m.score;
      }
      const where = { assessmentId_studentId: { assessmentId: id, studentId: m.studentId } };
      if (score === null && !absent && !comment) {
        writes.push(this.prisma.mark.deleteMany({ where: { assessmentId: id, studentId: m.studentId } })); // a blank cell clears the mark
      } else {
        const data = { score, absent, excused: absent && !!m.excused, comment, updatedById: user.id };
        writes.push(this.prisma.mark.upsert({ where, create: { assessmentId: id, studentId: m.studentId, ...data }, update: data }));
      }
    }
    await this.prisma.$transaction(writes);
    await this.audit.log(user, 'marks.save', 'assessment', id, { count: dto.marks.length });
    return { saved: dto.marks.length };
  }

  async publish(user: AuthUser, schoolId: string, id: string) {
    const a = await this.load(schoolId, id);
    await this.access.assertMayWrite(user, schoolId, a.classId, a.subjectId);
    const marks = await this.prisma.mark.findMany({ where: { assessmentId: id }, select: { studentId: true } });
    if (!marks.length) throw new BadRequestException('Enter at least one mark before publishing.');
    if (a.publishedAt) return { published: true, told: 0 };
    await this.prisma.assessment.update({ where: { id }, data: { publishedAt: new Date() } });
    const guardians = await this.prisma.studentGuardian.findMany({
      where: { studentId: { in: marks.map((m) => m.studentId) }, restricted: false, user: { active: true } },
      select: { userId: true, student: { select: { id: true, firstName: true } } },
    });
    const told = await this.notifications.notify(
      guardians.map((g) => ({
        schoolId, userId: g.userId, type: 'marks.published',
        title: `New mark for ${g.student.firstName} in ${a.subject.name}: ${a.title}`, body: `${a.subject.name}: ${a.title}`,
        data: { studentId: g.student.id, assessmentId: id, subject: a.subject.name, subjectAr: a.subject.nameAr, title: a.title },
      })),
    );
    await this.audit.log(user, 'assessment.publish', 'assessment', id, { told });
    return { published: true, told };
  }

  async unpublish(user: AuthUser, schoolId: string, id: string) {
    await this.load(schoolId, id);
    await this.prisma.assessment.update({ where: { id }, data: { publishedAt: null } });
    await this.audit.log(user, 'assessment.unpublish', 'assessment', id);
    return { published: false };
  }

  // ---- the gradebook and the exam timetable ----------------------------------

  async gradebook(user: AuthUser, schoolId: string, q: { classId?: string; subjectId?: string; term?: string; yearId?: string }, today: string) {
    if (!q.classId || !q.subjectId) throw new BadRequestException('Choose a class and a subject.');
    const term = q.term ? Number(q.term) : undefined;
    if (term !== undefined && term !== 1 && term !== 2) throw new BadRequestException('Choose term 1 or 2.');
    const cls = await this.prisma.class.findFirst({ where: { id: q.classId, schoolId }, select: { id: true, name: true, system: true } });
    if (!cls) throw new NotFoundException('Class not found.');
    if (!(await this.access.mayRead(user, schoolId, cls.id, q.subjectId))) throw new ForbiddenException(CANT_READ);

    const now = await this.calendar.termOf(schoolId, today);
    const year = q.yearId
      ? await this.prisma.academicYear.findFirst({ where: { id: q.yearId, schoolId } })
      : now ? await this.prisma.academicYear.findFirst({ where: { id: now.yearId } }) : await this.prisma.academicYear.findFirst({ where: { schoolId }, orderBy: { startsOn: 'desc' } });
    const students = await this.prisma.student.findMany({ where: { schoolId, classId: cls.id, active: true }, select: { id: true, firstName: true, lastName: true, code: true }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] });
    if (!year) return { class: cls, year: null, term: term ?? 1, assessments: [], students: students.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, code: s.code, marks: {}, percent: null, band: null })) };
    const useTerm = term ?? (now && now.yearId === year.id ? now.term : 1);

    const [assessments, bands] = await Promise.all([this.scores.assessments(schoolId, cls.id, year.id, useTerm, { subjectId: q.subjectId }), this.scores.bandsOf(schoolId, cls.system)]);
    return {
      class: cls,
      year: { id: year.id, name: year.name },
      term: useTerm,
      assessments: assessments.map((a) => ({ id: a.id, kind: a.kind, title: a.title, date: isoDate(a.date), maxScore: a.maxScore, weight: a.weight, publishedAt: a.publishedAt, startTime: a.startTime, endTime: a.endTime, roomId: a.roomId })),
      students: students.map((s) => {
        const marks: Record<string, { score: number | null; absent: boolean; excused: boolean; comment: string | null }> = {};
        const items: MarkItem[] = [];
        for (const a of assessments) {
          const m = a.marks.find((x) => x.studentId === s.id);
          if (!m) continue;
          marks[a.id] = { score: numberOf(m.score), absent: m.absent, excused: m.excused, comment: m.comment };
          items.push({ score: numberOf(m.score), max: a.maxScore, weight: a.weight, absent: m.absent, excused: m.excused });
        }
        const pct = subjectPercent(items);
        return { id: s.id, name: `${s.firstName} ${s.lastName}`, code: s.code, marks, percent: pct === null ? null : round1(pct), band: pct === null ? null : bandOf(pct, bands) };
      }),
    };
  }

  /** The exam timetable: midterms and finals with times and rooms. Without dates it covers the current school year. */
  async exams(schoolId: string, q: { gradeId?: string; classId?: string; from?: string; to?: string }, today: string) {
    const bounds: Prisma.AssessmentWhereInput = {};
    if (q.from || q.to) {
      bounds.date = { ...(q.from ? { gte: dbDate(q.from) } : {}), ...(q.to ? { lte: dbDate(q.to) } : {}) };
    } else {
      const t = await this.calendar.termOf(schoolId, today);
      if (t) bounds.yearId = t.yearId;
    }
    const rows = await this.prisma.assessment.findMany({
      where: { schoolId, kind: { in: EXAM_KINDS }, ...bounds, ...(q.classId ? { classId: q.classId } : {}), ...(q.gradeId ? { class: { gradeId: q.gradeId } } : {}) },
      select: { id: true, kind: true, title: true, date: true, startTime: true, endTime: true, class: { select: { id: true, name: true, grade: { select: { id: true, name: true } } } }, subject: { select: { id: true, name: true, nameAr: true } }, room: { select: { id: true, name: true } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { class: { name: 'asc' } }],
      take: 500,
    });
    return rows.map((r) => ({ ...r, date: isoDate(r.date) }));
  }
}

@RequiresModule('academics')
@Controller('academics')
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService, private readonly prisma: PrismaService) {}

  private async today(schoolId: string) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
    return localParts(new Date(), school.timezone).date;
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @Get('teaching')
  teaching(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string) {
    return this.assessments.teaching(user, schoolId);
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN, Role.SOCIAL_WORKER)
  @Get('assessments')
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query() q: { classId?: string; subjectId?: string; term?: string; yearId?: string }) {
    return this.assessments.list(user, schoolId, q);
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @Post('assessments')
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: CreateAssessmentDto) {
    return this.assessments.create(user, schoolId, dto);
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @Patch('assessments/:id')
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateAssessmentDto) {
    return this.assessments.update(user, schoolId, id, dto);
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @Delete('assessments/:id')
  remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.assessments.remove(user, schoolId, id);
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN, Role.SOCIAL_WORKER)
  @Get('assessments/:id/marks')
  marks(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.assessments.marks(user, schoolId, id);
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @Put('assessments/:id/marks')
  saveMarks(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: SaveMarksDto) {
    return this.assessments.saveMarks(user, schoolId, id, dto);
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @Post('assessments/:id/publish')
  publish(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.assessments.publish(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post('assessments/:id/unpublish')
  unpublish(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.assessments.unpublish(user, schoolId, id);
  }

  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN, Role.SOCIAL_WORKER)
  @Get('gradebook')
  async gradebook(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query() q: { classId?: string; subjectId?: string; term?: string; yearId?: string }) {
    return this.assessments.gradebook(user, schoolId, q, await this.today(schoolId));
  }

  @Roles(...STAFF)
  @Get('exams')
  async exams(@SchoolId() schoolId: string, @Query() q: { gradeId?: string; classId?: string; from?: string; to?: string }) {
    return this.assessments.exams(schoolId, q, await this.today(schoolId));
  }
}
