import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { AttendanceStatus, Prisma, ReportCard, ReportCardStatus, Role } from '@prisma/client';
import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresFeature, RequiresModule, Roles, SchoolId } from '../auth/auth.decorators';
import { isoDate } from '../common/dates';
import { localParts } from '../common/time';
import { titled } from '../messaging/shared';
import { NotificationsService } from '../notifications/notifications';
import { SchoolCalendar } from '../setup/calendar';
import { AcademicsAccess } from './access';
import { Band, bandOf, familyOf, gpaOf, mean, ReportSnapshot, round1 } from './grades';
import { percentsFor, ScoreService } from './scores';

const MAX_COMMENT = 600;

export class GenerateDto {
  @IsString() classId: string;
  @IsString() yearId: string;
  @IsInt() @Min(1) @Max(2) term: number;
}

export class CommentsDto {
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @ValidateIf((d) => d.comment !== null) @IsString() @MaxLength(MAX_COMMENT) comment?: string | null;
  @IsOptional() @ValidateIf((d) => d.classTeacherComment !== null) @IsString() @MaxLength(MAX_COMMENT) classTeacherComment?: string | null;
  @IsOptional() @ValidateIf((d) => d.principalComment !== null) @IsString() @MaxLength(MAX_COMMENT) principalComment?: string | null;
}

export class PublishDto {
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2) term?: number;
  @IsOptional() @IsString() yearId?: string;
}

type Counts = ReportSnapshot['attendance'];

/**
 * What one school day counts as, from the student's periods that day.
 * Absent only when absent in every period; otherwise the "worst" of what is left.
 */
export function dayStatus(statuses: AttendanceStatus[]): keyof Omit<Counts, 'days'> {
  if (statuses.every((s) => s === 'ABSENT')) return 'absent';
  if (statuses.every((s) => s === 'ABSENT' || s === 'EXCUSED')) return 'excused';
  if (statuses.every((s) => s === 'ON_TRIP')) return 'onTrip';
  if (statuses.includes('LATE')) return 'late';
  return 'present';
}

/** The first and last day of a term in a school year; `null` when the year has no such term. */
export function termRange(year: { startsOn: Date; endsOn: Date; term2StartsOn: Date | null }, term: number): { from: string; to: string } | null {
  const dayBefore = (d: Date) => isoDate(new Date(d.getTime() - 86400_000));
  if (term === 1) return { from: isoDate(year.startsOn), to: year.term2StartsOn ? dayBefore(year.term2StartsOn) : isoDate(year.endsOn) };
  return year.term2StartsOn ? { from: isoDate(year.term2StartsOn), to: isoDate(year.endsOn) } : null;
}

type Student = { id: string; firstName: string; lastName: string; nameAr: string | null; code: string; gender: string | null };

@Injectable()
export class ReportCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly calendar: SchoolCalendar,
    private readonly access: AcademicsAccess,
    private readonly scores: ScoreService,
  ) {}

  // ---- what a card is made of -------------------------------------------------

  /** The class, the subjects it has and the published marks of a term: loaded once for every student of the class. */
  private async context(schoolId: string, classId: string, yearId: string, term: number) {
    const [school, cls, year] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { id: true, name: true, nameAr: true, timezone: true, schoolDays: true, principalName: true } }),
      this.prisma.class.findFirst({ where: { id: classId, schoolId }, include: { grade: { select: { name: true } }, homeroomTeacher: { select: { name: true, honorific: true } } } }),
      this.prisma.academicYear.findFirst({ where: { id: yearId, schoolId } }),
    ]);
    if (!cls) throw new NotFoundException('Class not found.');
    if (!year) throw new NotFoundException('Academic year not found.');
    const [lessons, assessments, bands] = await Promise.all([
      this.prisma.timetableEntry.findMany({ where: { schoolId, classId }, select: { subjectId: true, subject: { select: { name: true, nameAr: true } }, teacher: { select: { id: true, name: true, honorific: true } } } }),
      this.scores.assessments(schoolId, classId, yearId, term, { publishedOnly: true }),
      this.scores.bandsOf(schoolId, cls.system),
    ]);
    const subjects = new Map<string, { id: string; name: string; nameAr: string | null; teachers: Map<string, { n: number; name: string }> }>();
    for (const l of lessons) {
      const s = subjects.get(l.subjectId) ?? { id: l.subjectId, name: l.subject.name, nameAr: l.subject.nameAr, teachers: new Map() };
      if (l.teacher) s.teachers.set(l.teacher.id, { n: (s.teachers.get(l.teacher.id)?.n ?? 0) + 1, name: titled(l.teacher) });
      subjects.set(l.subjectId, s);
    }
    const assessed = await this.prisma.subject.findMany({ where: { id: { in: [...new Set(assessments.map((a) => a.subjectId))] } }, select: { id: true, name: true, nameAr: true } });
    for (const a of assessed) if (!subjects.has(a.id)) subjects.set(a.id, { id: a.id, name: a.name, nameAr: a.nameAr, teachers: new Map() });
    const list = [...subjects.values()]
      .map((s) => ({ id: s.id, name: s.name, nameAr: s.nameAr, teacher: [...s.teachers.values()].sort((a, b) => b.n - a.n)[0]?.name ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { school, cls, year, subjects: list, assessments, bands, term };
  }

  private async attendance(ctx: Awaited<ReturnType<ReportCardsService['context']>>, studentIds: string[], now: Date): Promise<Map<string, Counts>> {
    const range = termRange(ctx.year, ctx.term);
    const today = localParts(now, ctx.school.timezone).date;
    const out = new Map<string, Counts>(studentIds.map((id) => [id, { present: 0, late: 0, absent: 0, excused: 0, onTrip: 0, days: 0 }]));
    if (!range || range.from > today) return out;
    const to = range.to < today ? range.to : today;
    const [days, records] = await Promise.all([
      this.calendar.openDays(ctx.school, range.from, to),
      this.prisma.attendanceRecord.findMany({ where: { schoolId: ctx.school.id, studentId: { in: studentIds }, date: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, select: { studentId: true, date: true, status: true } }),
    ]);
    const byDay = new Map<string, AttendanceStatus[]>();
    for (const r of records) {
      const key = `${r.studentId}|${isoDate(r.date)}`;
      byDay.set(key, [...(byDay.get(key) ?? []), r.status]);
    }
    for (const [key, statuses] of byDay) out.get(key.split('|')[0])![dayStatus(statuses)]++;
    for (const c of out.values()) c.days = days.length;
    return out;
  }

  private snapshotOf(ctx: Awaited<ReturnType<ReportCardsService['context']>>, card: Pick<ReportCard, 'subjectComments' | 'classTeacherComment' | 'principalComment'>, student: Student, counts: Counts, now: Date): ReportSnapshot {
    const percents = percentsFor(student.id, ctx.assessments);
    const comments = (card.subjectComments ?? {}) as Record<string, string>;
    const subjects = ctx.subjects.map((s) => {
      const p = percents.get(s.id) ?? null;
      return { subjectId: s.id, name: s.name, nameAr: s.nameAr, percent: p === null ? null : round1(p), band: p === null ? null : bandOf(p, ctx.bands), comment: comments[s.id] || null, teacher: s.teacher, exact: p };
    });
    const avg = mean(subjects.map((s) => s.exact));
    const total: ReportSnapshot['overall'] = { percent: avg === null ? null : round1(avg), band: avg === null ? null : bandOf(avg, ctx.bands) };
    if (familyOf(ctx.cls.system) === 'AMERICAN') total.gpa = gpaOf(subjects.map((s) => s.band));
    return {
      student: { id: student.id, name: `${student.firstName} ${student.lastName}`, nameAr: student.nameAr, code: student.code, gender: student.gender },
      class: { name: ctx.cls.name, gradeName: ctx.cls.grade.name, system: ctx.cls.system },
      year: { name: ctx.year.name },
      term: ctx.term as 1 | 2,
      subjects: subjects.map(({ exact: _exact, ...s }) => s),
      overall: total,
      attendance: counts,
      classTeacherComment: card.classTeacherComment || null,
      classTeacher: ctx.cls.homeroomTeacher ? titled(ctx.cls.homeroomTeacher) : null,
      principalComment: card.principalComment || null,
      principalName: ctx.school.principalName,
      school: { name: ctx.school.name, nameAr: ctx.school.nameAr },
      issuedAt: now.toISOString(),
    };
  }

  // ---- access ---------------------------------------------------------------

  private async load(schoolId: string, id: string) {
    const card = await this.prisma.reportCard.findFirst({ where: { id, schoolId }, include: { student: { select: { id: true, firstName: true, lastName: true, nameAr: true, code: true, gender: true } } } });
    if (!card) throw new NotFoundException('Report card not found.');
    return card;
  }

  private async assertMayRead(user: AuthUser, schoolId: string, classId: string) {
    if (!(await this.access.mayRead(user, schoolId, classId))) throw new ForbiddenException('You can see only the classes you teach.');
  }

  // ---- staff ----------------------------------------------------------------

  async generate(user: AuthUser, schoolId: string, dto: GenerateDto) {
    if (!(await this.access.isHomeroom(user, schoolId, dto.classId))) throw new ForbiddenException('Only the class teacher can prepare report cards.');
    const [cls, year] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: dto.classId, schoolId }, select: { id: true } }),
      this.prisma.academicYear.findFirst({ where: { id: dto.yearId, schoolId } }),
    ]);
    if (!cls) throw new NotFoundException('Class not found.');
    if (!year) throw new NotFoundException('Academic year not found.');
    if (!termRange(year, dto.term)) throw new BadRequestException('This school year has only one term.');
    const students = await this.prisma.student.findMany({ where: { schoolId, classId: dto.classId, active: true }, select: { id: true } });
    const { count } = await this.prisma.reportCard.createMany({
      data: students.map((s) => ({ schoolId, studentId: s.id, yearId: dto.yearId, term: dto.term, classId: dto.classId })),
      skipDuplicates: true,
    });
    await this.audit.log(user, 'reportcard.generate', 'class', dto.classId, { term: dto.term, created: count });
    return { created: count, total: students.length };
  }

  async list(user: AuthUser, schoolId: string, q: { classId?: string; term?: string; yearId?: string }, today: string, now = new Date()) {
    if (!q.classId) throw new BadRequestException('Choose a class.');
    await this.assertMayRead(user, schoolId, q.classId);
    const current = await this.calendar.termOf(schoolId, today);
    const yearId = q.yearId ?? current?.yearId;
    const term = q.term ? Number(q.term) : current?.term ?? 1;
    if (term !== 1 && term !== 2) throw new BadRequestException('Choose term 1 or 2.');
    if (!yearId) return { year: null, term, cards: [] };
    const ctx = await this.context(schoolId, q.classId, yearId, term);
    const cards = await this.prisma.reportCard.findMany({
      where: { schoolId, classId: q.classId, yearId, term, student: { active: true } },
      include: { student: { select: { id: true, firstName: true, lastName: true, nameAr: true, code: true, gender: true } } },
      orderBy: [{ student: { firstName: 'asc' } }, { student: { lastName: 'asc' } }],
    });
    return {
      year: { id: ctx.year.id, name: ctx.year.name },
      term,
      cards: cards.map((c) => {
        const live = c.status === 'PUBLISHED' && c.snapshot ? (c.snapshot as unknown as ReportSnapshot) : this.snapshotOf(ctx, c, c.student, { present: 0, late: 0, absent: 0, excused: 0, onTrip: 0, days: 0 }, now);
        const comments = (c.subjectComments ?? {}) as Record<string, string>;
        // A subject with no teacher has nobody to wait for, so it isn’t counted as a missing comment.
        return {
          id: c.id, studentId: c.studentId, name: `${c.student.firstName} ${c.student.lastName}`, nameAr: c.student.nameAr, code: c.student.code, status: c.status, publishedAt: c.publishedAt,
          percent: live.overall.percent, band: live.overall.band,
          missing: { subjects: live.subjects.filter((s) => s.teacher && !comments[s.subjectId]).length, classTeacher: !c.classTeacherComment, principal: !c.principalComment },
        };
      }),
    };
  }

  async get(user: AuthUser, schoolId: string, id: string, now = new Date()) {
    const card = await this.load(schoolId, id);
    await this.assertMayRead(user, schoolId, card.classId);
    let snapshot: ReportSnapshot;
    if (card.status === 'PUBLISHED' && card.snapshot) {
      snapshot = card.snapshot as unknown as ReportSnapshot;
    } else {
      const ctx = await this.context(schoolId, card.classId, card.yearId, card.term);
      const counts = (await this.attendance(ctx, [card.studentId], now)).get(card.studentId)!;
      snapshot = this.snapshotOf(ctx, card, card.student, counts, now);
    }
    const teaching = user.role === Role.TEACHER ? new Set((await this.access.pairs(schoolId, user.id)).filter((p) => p.classId === card.classId).map((p) => p.subjectId)) : null;
    const draft = card.status === 'DRAFT';
    return {
      id: card.id, status: card.status, studentId: card.studentId, classId: card.classId, yearId: card.yearId, term: card.term, publishedAt: card.publishedAt,
      snapshot,
      comments: { subjects: card.subjectComments ?? {}, classTeacher: card.classTeacherComment, principal: card.principalComment },
      canEdit: {
        subjects: draft ? snapshot.subjects.filter((s) => !teaching || teaching.has(s.subjectId)).map((s) => s.subjectId) : [],
        classTeacher: draft && (await this.access.isHomeroom(user, schoolId, card.classId)),
        principal: draft && user.role === Role.SCHOOL_ADMIN,
      },
    };
  }

  async comments(user: AuthUser, schoolId: string, id: string, dto: CommentsDto) {
    const card = await this.load(schoolId, id);
    if (card.status === 'PUBLISHED') throw new BadRequestException('This report card is published. Unpublish it to change it.');
    const clean = (v: string | null | undefined) => v?.trim() || null;
    const sent = [dto.subjectId !== undefined || dto.comment !== undefined, dto.classTeacherComment !== undefined, dto.principalComment !== undefined].filter(Boolean).length;
    if (sent !== 1) throw new BadRequestException('Send a subject comment, the class teacher’s comment or the principal’s comment.');

    if (dto.classTeacherComment !== undefined) {
      if (!(await this.access.isHomeroom(user, schoolId, card.classId))) throw new ForbiddenException('Only the class teacher can write this comment.');
      await this.prisma.reportCard.update({ where: { id }, data: { classTeacherComment: clean(dto.classTeacherComment) } });
    } else if (dto.principalComment !== undefined) {
      if (user.role !== Role.SCHOOL_ADMIN) throw new ForbiddenException('Only Student Affairs can write the principal’s comment.');
      await this.prisma.reportCard.update({ where: { id }, data: { principalComment: clean(dto.principalComment) } });
    } else {
      if (!dto.subjectId || dto.comment === undefined) throw new BadRequestException('Choose the subject and write the comment.');
      if (!(await this.access.teaches(user, schoolId, card.classId, dto.subjectId))) throw new ForbiddenException('You can only comment on subjects you teach.');
      const subject = await this.prisma.subject.findFirst({ where: { id: dto.subjectId, schoolId }, select: { id: true } });
      if (!subject) throw new NotFoundException('Subject not found.');
      const subjects = { ...((card.subjectComments ?? {}) as Record<string, string>) };
      const text = clean(dto.comment);
      if (text) subjects[dto.subjectId] = text;
      else delete subjects[dto.subjectId];
      await this.prisma.reportCard.update({ where: { id }, data: { subjectComments: subjects } });
    }
    await this.audit.log(user, 'reportcard.comment', 'student', card.studentId, { reportCardId: id, field: dto.classTeacherComment !== undefined ? 'classTeacher' : dto.principalComment !== undefined ? 'principal' : 'subject' });
    return this.get(user, schoolId, id);
  }

  async publish(user: AuthUser, schoolId: string, dto: PublishDto, now = new Date()) {
    const where: Prisma.ReportCardWhereInput = { schoolId, status: ReportCardStatus.DRAFT };
    if (dto.ids?.length) where.id = { in: dto.ids };
    else if (dto.classId && dto.term && dto.yearId) Object.assign(where, { classId: dto.classId, term: dto.term, yearId: dto.yearId, student: { active: true } });
    else throw new BadRequestException('Choose which report cards to publish.');
    const cards = await this.prisma.reportCard.findMany({ where, include: { student: { select: { id: true, firstName: true, lastName: true, nameAr: true, code: true, gender: true } } } });

    const groups = new Map<string, typeof cards>();
    for (const c of cards) groups.set(`${c.classId}|${c.yearId}|${c.term}`, [...(groups.get(`${c.classId}|${c.yearId}|${c.term}`) ?? []), c]);
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const told: { card: (typeof cards)[number]; year: string }[] = [];
    for (const [key, group] of groups) {
      const [classId, yearId, term] = key.split('|');
      const ctx = await this.context(schoolId, classId, yearId, Number(term));
      const counts = await this.attendance(ctx, group.map((c) => c.studentId), now);
      for (const c of group) {
        const snapshot = this.snapshotOf(ctx, c, c.student, counts.get(c.studentId)!, now);
        writes.push(this.prisma.reportCard.update({ where: { id: c.id }, data: { status: ReportCardStatus.PUBLISHED, snapshot: snapshot as unknown as Prisma.InputJsonValue, publishedAt: now, publishedById: user.id } }));
        told.push({ card: c, year: ctx.year.name });
      }
    }
    await this.prisma.$transaction(writes);

    const guardians = await this.prisma.studentGuardian.findMany({ where: { studentId: { in: cards.map((c) => c.studentId) }, restricted: false, user: { active: true } }, select: { userId: true, studentId: true } });
    await this.notifications.notify(
      guardians.flatMap((g) => {
        const t = told.find((x) => x.card.studentId === g.studentId);
        return t
          ? [{
              schoolId, userId: g.userId, type: 'reportCard.published',
              title: `${t.card.student.firstName}’s report card for term ${t.card.term} is ready`, body: `Term ${t.card.term} · ${t.year}`,
              data: { studentId: g.studentId, reportCardId: t.card.id, term: t.card.term, year: t.year },
            }]
          : [];
      }),
    );
    await this.audit.log(user, 'reportcard.publish', 'school', schoolId, { count: cards.length });
    return { published: cards.length };
  }

  async unpublish(user: AuthUser, schoolId: string, id: string) {
    const card = await this.load(schoolId, id);
    await this.prisma.reportCard.update({ where: { id }, data: { status: ReportCardStatus.DRAFT, publishedAt: null, publishedById: null } }); // the snapshot stays until the next publish
    await this.audit.log(user, 'reportcard.unpublish', 'student', card.studentId, { reportCardId: id });
    return { status: 'DRAFT' };
  }
}

@RequiresModule('academics')
@RequiresFeature('academics', 'reportCards')
@Controller('academics/report-cards')
export class ReportCardsController {
  constructor(private readonly cards: ReportCardsService, private readonly prisma: PrismaService) {}

  private async today(schoolId: string) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
    return localParts(new Date(), school.timezone).date;
  }

  @Roles(Role.SCHOOL_ADMIN, Role.SOCIAL_WORKER, Role.TEACHER)
  @Get()
  async list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query() q: { classId?: string; term?: string; yearId?: string }) {
    return this.cards.list(user, schoolId, q, await this.today(schoolId));
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: GenerateDto) {
    return this.cards.generate(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post('publish')
  publish(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: PublishDto) {
    return this.cards.publish(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.SOCIAL_WORKER, Role.TEACHER)
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.cards.get(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Patch(':id/comments')
  comments(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: CommentsDto) {
    return this.cards.comments(user, schoolId, id, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/unpublish')
  unpublish(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.cards.unpublish(user, schoolId, id);
  }
}
