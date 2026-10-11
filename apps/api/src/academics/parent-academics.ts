import { BadRequestException, Controller, Get, Injectable, NotFoundException, Param, Query } from '@nestjs/common';
import { ReportCardStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, AuthUser, RequiresFeature, RequiresModule, Roles } from '../auth/auth.decorators';
import { dbDate, isoDate } from '../common/dates';
import { localParts } from '../common/time';
import { ownChild } from '../messaging/shared';
import { SchoolCalendar } from '../setup/calendar';
import { bandOf, familyOf, gpaOf, MarkItem, mean, ReportSnapshot, round1, subjectPercent } from './grades';
import { EXAM_KINDS } from './assessments';
import { numberOf, ScoreService, shown } from './scores';

@Injectable()
export class ParentAcademicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: SchoolCalendar,
    private readonly scores: ScoreService,
  ) {}

  /** The year and term to show: today's, or the last one the school had when it is the holidays. */
  private async current(schoolId: string, today: string) {
    const now = await this.calendar.termOf(schoolId, today);
    if (now) return { yearId: now.yearId, yearName: now.yearName, term: now.term };
    const last = await this.prisma.academicYear.findFirst({ where: { schoolId, startsOn: { lte: dbDate(today) } }, orderBy: { startsOn: 'desc' } });
    return last ? { yearId: last.id, yearName: last.name, term: (last.term2StartsOn ? 2 : 1) as 1 | 2 } : null;
  }

  private async schoolToday(schoolId: string) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
    return localParts(new Date(), school.timezone).date;
  }

  /** Published marks only, by subject, for one term. */
  async grades(user: AuthUser, childId: string, termParam?: string) {
    const child = await ownChild(this.prisma, user.id, childId);
    const term = termParam ? Number(termParam) : undefined;
    if (term !== undefined && term !== 1 && term !== 2) throw new BadRequestException('Choose term 1 or 2.');
    const cur = await this.current(child.schoolId, await this.schoolToday(child.schoolId));
    const cls = child.classId ? await this.prisma.class.findUnique({ where: { id: child.classId }, select: { system: true } }) : null;
    if (!cur) return { year: null, term: term ?? 1, subjects: [], overall: { percent: null, band: null } };
    const useTerm = term ?? cur.term;
    const bands = await this.scores.bandsOf(child.schoolId, cls?.system ?? null);

    const marks = await this.prisma.mark.findMany({
      where: { studentId: child.id, assessment: { yearId: cur.yearId, term: useTerm, publishedAt: { not: null } } },
      include: { assessment: { include: { subject: { select: { id: true, name: true } } } } },
      orderBy: { assessment: { date: 'asc' } },
    });
    const bySubject = new Map<string, { id: string; name: string; items: MarkItem[]; assessments: unknown[] }>();
    for (const m of marks) {
      const a = m.assessment;
      const s = bySubject.get(a.subjectId) ?? { id: a.subjectId, name: a.subject.name, items: [], assessments: [] };
      s.items.push({ score: numberOf(m.score), max: a.maxScore, weight: a.weight, absent: m.absent, excused: m.excused });
      s.assessments.push({ id: a.id, title: a.title, kind: a.kind, date: isoDate(a.date), score: numberOf(m.score), maxScore: a.maxScore, absent: m.absent, excused: m.excused, comment: m.comment });
      bySubject.set(a.subjectId, s);
    }
    const subjects = [...bySubject.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => {
        const pct = subjectPercent(s.items);
        return { subjectId: s.id, name: s.name, ...shown(pct, bands), exact: pct, assessments: s.assessments };
      });
    const avg = mean(subjects.map((s) => s.exact));
    const overall: { percent: number | null; band: unknown; gpa?: number | null } = shown(avg, bands);
    if (familyOf(cls?.system ?? null) === 'AMERICAN') overall.gpa = gpaOf(subjects.map((s) => s.band));
    return { year: { id: cur.yearId, name: cur.yearName }, term: useTerm, subjects: subjects.map(({ exact: _exact, ...s }) => s), overall };
  }

  /** Each published assessment in the year as score ÷ max, for the progress line. */
  async trend(user: AuthUser, childId: string, subjectId?: string) {
    if (!subjectId) throw new BadRequestException('Choose a subject.');
    const child = await ownChild(this.prisma, user.id, childId);
    const cur = await this.current(child.schoolId, await this.schoolToday(child.schoolId));
    if (!cur) return [];
    const marks = await this.prisma.mark.findMany({
      where: { studentId: child.id, absent: false, score: { not: null }, assessment: { yearId: cur.yearId, subjectId, publishedAt: { not: null } } },
      include: { assessment: { select: { date: true, maxScore: true } } },
      orderBy: { assessment: { date: 'asc' } },
    });
    return marks.map((m) => ({ date: isoDate(m.assessment.date), percent: round1((numberOf(m.score)! / m.assessment.maxScore) * 100) }));
  }

  /** The class's exams from today on. A schedule isn't a mark, so published or not makes no difference. */
  async exams(user: AuthUser, childId: string) {
    const child = await ownChild(this.prisma, user.id, childId);
    if (!child.classId) return [];
    const today = await this.schoolToday(child.schoolId);
    const rows = await this.prisma.assessment.findMany({
      where: { schoolId: child.schoolId, classId: child.classId, kind: { in: EXAM_KINDS }, date: { gte: dbDate(today) } },
      select: { id: true, title: true, kind: true, date: true, startTime: true, endTime: true, subject: { select: { name: true } }, room: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map((r) => ({ id: r.id, subject: r.subject.name, title: r.title, kind: r.kind, date: isoDate(r.date), startTime: r.startTime, endTime: r.endTime, room: r.room?.name ?? null }));
  }

  async reportCards(user: AuthUser, childId: string) {
    const child = await ownChild(this.prisma, user.id, childId);
    const cards = await this.prisma.reportCard.findMany({ where: { studentId: child.id, status: ReportCardStatus.PUBLISHED }, orderBy: { publishedAt: 'desc' } });
    return cards.map((c) => {
      const snap = c.snapshot as unknown as ReportSnapshot | null;
      return { id: c.id, year: snap?.year.name ?? null, term: c.term, publishedAt: c.publishedAt, overall: snap?.overall ?? null };
    });
  }

  async reportCard(user: AuthUser, childId: string, id: string) {
    const child = await ownChild(this.prisma, user.id, childId);
    const card = await this.prisma.reportCard.findFirst({ where: { id, studentId: child.id, status: ReportCardStatus.PUBLISHED } });
    if (!card?.snapshot) throw new NotFoundException('Report card not found.');
    return { id: card.id, term: card.term, publishedAt: card.publishedAt, snapshot: card.snapshot };
  }
}

@RequiresModule('academics')
@Roles(Role.PARENT)
@Controller('parent/children/:id')
export class ParentAcademicsController {
  constructor(private readonly parent: ParentAcademicsService) {}

  @Get('grades')
  grades(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('term') term?: string) {
    return this.parent.grades(user, id, term);
  }

  @Get('grades/trend')
  trend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('subjectId') subjectId?: string) {
    return this.parent.trend(user, id, subjectId);
  }

  @Get('exams')
  exams(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.parent.exams(user, id);
  }

  @RequiresFeature('academics', 'reportCards')
  @Get('report-cards')
  reportCards(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.parent.reportCards(user, id);
  }

  @RequiresFeature('academics', 'reportCards')
  @Get('report-cards/:rcId')
  reportCard(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('rcId') rcId: string) {
    return this.parent.reportCard(user, id, rcId);
  }
}
