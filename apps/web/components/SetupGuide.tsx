'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Section, Tag } from './ui';

interface Counts {
  years: number;
  grades: number;
  classes: number;
  subjects: number;
  gradeSubjects: number;
  periods: number;
  rooms: number;
  teachers: number;
  classSubjects: number;
  withoutTeacher: number;
  lessons: number;
  students: number;
}

/** The steps of setting up a school in the order that works: each one needs the ones before it. */
const STEPS = [
  { key: 'structure', href: '/setup#classes', done: (c: Counts) => c.grades > 0 && c.classes > 0 },
  { key: 'year', href: '/setup#year', done: (c: Counts) => c.years > 0 },
  { key: 'subjects', href: '/setup#subjects', done: (c: Counts) => c.subjects > 0 && c.gradeSubjects > 0 },
  { key: 'rooms', href: '/setup#rooms', done: (c: Counts) => c.rooms > 0 && c.periods > 0 },
  { key: 'staff', href: '/staff', done: (c: Counts) => c.teachers > 0 },
  { key: 'teachers', href: '/timetable', done: (c: Counts) => c.classSubjects > 0 && c.withoutTeacher === 0 },
  { key: 'timetable', href: '/timetable', done: (c: Counts) => c.lessons > 0 },
  { key: 'students', href: '/students/new', done: (c: Counts) => c.students > 0 },
] as const;

/**
 * "Getting your school ready", on Today for Student Affairs until every step is done. A new school has a
 * long chain to get through and nothing on an empty screen says where to begin: this does, with the next
 * step first and a button that goes straight to the right place.
 */
export function SetupGuide() {
  const { t } = useI18n();
  const progress = useApi<Counts>('/school/setup');
  const counts = progress.data;
  if (!counts) return null;
  const steps = STEPS.map((s) => ({ ...s, finished: s.done(counts) }));
  const doneN = steps.filter((s) => s.finished).length;
  if (doneN === steps.length) return null;
  const next = steps.find((s) => !s.finished)!;

  return (
    <Section title={t.guide.title} aside={t.guide.sub(doneN, steps.length)}>
      <div className="panel guide">
        <span className="meter" role="progressbar" aria-label={t.guide.title} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneN}>
          <span style={{ width: `${Math.round((doneN / steps.length) * 100)}%` }} />
        </span>
        <ol>
          {steps.map((s, i) => {
            const text = t.guide.steps[s.key];
            const isNext = s === next;
            return (
              <li key={s.key} className={s.finished ? 'done' : isNext ? 'next' : ''}>
                <span className="guide-mark" aria-hidden="true">{s.finished ? '✓' : i + 1}</span>
                <span className="guide-text">
                  <b>{text.title}</b>
                  {!s.finished && <span>{text.hint}</span>}
                </span>
                {s.finished ? <Tag tone="P">✓ {t.guide.done}</Tag> : <Link className={`btn${isNext ? ' primary' : ''}`} href={s.href}>{isNext ? t.guide.start : t.guide.open}</Link>}
              </li>
            );
          })}
        </ol>
      </div>
    </Section>
  );
}
