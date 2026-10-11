import { Injectable } from '@nestjs/common';
import { Prisma, SchoolSystem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Band, bandOf, bandsFor, MarkItem, round1, subjectPercent } from './grades';

type AssessmentWithMarks = Prisma.AssessmentGetPayload<{ include: { marks: true } }>;

export const numberOf = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/** The percentage of one student in each subject, from the assessments they have a mark in. Not rounded. */
export function percentsFor(studentId: string, assessments: AssessmentWithMarks[]): Map<string, number | null> {
  const bySubject = new Map<string, MarkItem[]>();
  for (const a of assessments) {
    const m = a.marks.find((x) => x.studentId === studentId);
    if (!m) continue; // not marked: leaves the assessment out
    const items = bySubject.get(a.subjectId) ?? [];
    items.push({ score: numberOf(m.score), max: a.maxScore, weight: a.weight, absent: m.absent, excused: m.excused });
    bySubject.set(a.subjectId, items);
  }
  const out = new Map<string, number | null>();
  for (const a of assessments) if (!out.has(a.subjectId)) out.set(a.subjectId, subjectPercent(bySubject.get(a.subjectId) ?? []));
  return out;
}

/** A percentage with its band, as the screens show them: one decimal, band found from the unrounded value. */
export function shown(pct: number | null, bands: Band[]) {
  return pct === null ? { percent: null, band: null } : { percent: round1(pct), band: bandOf(pct, bands) };
}

@Injectable()
export class ScoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** The school's own bands by system (empty until it edits any). */
  async overrides(schoolId: string): Promise<Record<string, Band[]>> {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { gradeBands: true } });
    return (school.gradeBands ?? {}) as unknown as Record<string, Band[]>;
  }

  async bandsOf(schoolId: string, system: SchoolSystem | null): Promise<Band[]> {
    return bandsFor(system, await this.overrides(schoolId));
  }

  /** One class's assessments in a term, with every student's mark. `publishedOnly` leaves out what the teacher hasn't published. */
  async assessments(schoolId: string, classId: string, yearId: string, term: number, opts: { publishedOnly?: boolean; subjectId?: string } = {}) {
    return this.prisma.assessment.findMany({
      where: { schoolId, classId, yearId, term, ...(opts.subjectId ? { subjectId: opts.subjectId } : {}), ...(opts.publishedOnly ? { publishedAt: { not: null } } : {}) },
      include: { marks: true },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
