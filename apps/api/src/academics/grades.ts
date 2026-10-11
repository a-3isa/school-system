import { SchoolSystem } from '@prisma/client';

/** A step on the scale: a percentage from `min` up earns this label (and, for American schools, a GPA point). */
export interface Band {
  min: number;
  label: string;
  labelAr: string;
  gpa?: number;
}

export type BandFamily = 'NATIONAL' | 'BRITISH' | 'AMERICAN';

const same = (label: string, min: number, gpa?: number): Band => ({ min, label, labelAr: label, ...(gpa !== undefined ? { gpa } : {}) });

export const DEFAULT_BANDS: Record<BandFamily, Band[]> = {
  NATIONAL: [
    { min: 85, label: 'Excellent', labelAr: 'ممتاز' },
    { min: 75, label: 'Very good', labelAr: 'جيد جدًا' },
    { min: 65, label: 'Good', labelAr: 'جيد' },
    { min: 50, label: 'Pass', labelAr: 'مقبول' },
    { min: 0, label: 'Below pass', labelAr: 'دون المستوى' },
  ],
  BRITISH: [same('A*', 90), same('A', 80), same('B', 70), same('C', 60), same('D', 50), same('E', 40), same('F', 30), same('G', 20), same('U', 0)],
  AMERICAN: [
    same('A', 93, 4.0), same('A−', 90, 3.7), same('B+', 87, 3.3), same('B', 83, 3.0), same('B−', 80, 2.7), same('C+', 77, 2.3),
    same('C', 73, 2.0), same('C−', 70, 1.7), same('D+', 67, 1.3), same('D', 63, 1.0), same('D−', 60, 0.7), same('F', 0, 0),
  ],
};

/** The scale a school system uses unless the school has changed it: British and American have their own, the rest use the national one. */
export function familyOf(system: SchoolSystem | null): BandFamily {
  return system === 'BRITISH' ? 'BRITISH' : system === 'AMERICAN' ? 'AMERICAN' : 'NATIONAL';
}

/** The bands for a class's system: the school's own when it has set them, else the defaults. A class with no system counts as OTHER. */
export function bandsFor(system: SchoolSystem | null, overrides: Record<string, Band[]> | null | undefined): Band[] {
  const custom = overrides?.[system ?? 'OTHER'];
  const bands = custom?.length ? custom : DEFAULT_BANDS[familyOf(system)];
  return [...bands].sort((a, b) => b.min - a.min);
}

/** The band a percentage falls in. Bands are searched from the highest `min` down; a percentage below every band takes the lowest. */
export function bandOf(pct: number, bands: Band[]): Band {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => pct >= b.min) ?? sorted[sorted.length - 1];
}

export interface MarkItem {
  score: number | null;
  max: number;
  weight: number;
  absent: boolean;
  excused: boolean;
}

/**
 * A subject's percentage for a term: Σ(weight × score ÷ max) ÷ Σ(weight) × 100.
 * An excused absence is left out; an absence without an excuse counts as 0; an
 * assessment with no mark yet is left out. `null` when nothing counts.
 * Not rounded: round only for display.
 */
export function subjectPercent(items: MarkItem[]): number | null {
  let earned = 0;
  let weights = 0;
  for (const m of items) {
    if (m.absent && m.excused) continue;
    const score = m.absent ? 0 : m.score;
    if (score === null) continue;
    earned += m.weight * (score / m.max);
    weights += m.weight;
  }
  return weights === 0 ? null : (earned / weights) * 100;
}

/** The plain average of the subjects that have a percentage; `null` when none has. Not rounded. */
export function mean(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
}

/** One decimal place, for showing and for the report-card snapshot. */
export const round1 = (n: number) => Math.round(n * 10) / 10;

/** The overall percentage: the plain average of the subject percentages, to one decimal. */
export function overall(subjects: (number | null)[]): number | null {
  const m = mean(subjects);
  return m === null ? null : round1(m);
}

/** The average GPA of the subjects' bands, for American schools; `null` when no band carries a GPA. */
export function gpaOf(bands: (Band | null)[]): number | null {
  const points = bands.map((b) => b?.gpa).filter((g): g is number => typeof g === 'number');
  return points.length ? Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100 : null;
}

/** What a report card says, frozen when it is published (decision T5). */
export interface ReportSnapshot {
  student: { id: string; name: string; nameAr: string | null; code: string; gender: string | null };
  class: { name: string; gradeName: string; system: string | null };
  year: { name: string };
  term: 1 | 2;
  subjects: { subjectId: string; name: string; percent: number | null; band: Band | null; comment: string | null; teacher: string | null }[];
  overall: { percent: number | null; band: Band | null; gpa?: number | null };
  attendance: { present: number; late: number; absent: number; excused: number; onTrip: number; days: number };
  classTeacherComment: string | null;
  classTeacher: string | null;
  principalComment: string | null;
  principalName: string | null;
  school: { name: string; nameAr: string | null };
  issuedAt: string;
}

/** Checks a school's own bands: lowest first is 0, every `min` below the one above, labels filled in. Returns the sorted bands, or a message. */
export function checkBands(bands: unknown): { ok: true; bands: Band[] } | { ok: false; message: string } {
  if (!Array.isArray(bands) || bands.length < 2 || bands.length > 20) return { ok: false, message: 'A scale needs between 2 and 20 grades.' };
  const out: Band[] = [];
  for (const b of bands) {
    if (!b || typeof b.min !== 'number' || !Number.isFinite(b.min) || b.min < 0 || b.min > 100) return { ok: false, message: 'Each grade starts at a percentage between 0 and 100.' };
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    const labelAr = typeof b.labelAr === 'string' ? b.labelAr.trim() : '';
    if (!label || !labelAr || label.length > 30 || labelAr.length > 30) return { ok: false, message: 'Each grade needs a name in English and in Arabic.' };
    if (b.gpa !== undefined && b.gpa !== null && (typeof b.gpa !== 'number' || b.gpa < 0 || b.gpa > 5)) return { ok: false, message: 'A grade point must be between 0 and 5.' };
    out.push({ min: b.min, label, labelAr, ...(typeof b.gpa === 'number' ? { gpa: b.gpa } : {}) });
  }
  out.sort((a, b) => b.min - a.min);
  if (out[out.length - 1].min !== 0) return { ok: false, message: 'The lowest grade must start at 0%.' };
  for (let i = 1; i < out.length; i++) if (out[i].min >= out[i - 1].min) return { ok: false, message: 'Each grade must start at a different percentage.' };
  return { ok: true, bands: out };
}
