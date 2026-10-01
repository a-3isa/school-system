'use client';
import { useApi, useEvery } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ErrorNote } from '@/components/ui';
import { AttendanceList } from '@/components/AttendanceList';

/** Where a teacher lands, and their only screen: the class in front of them right now. */
export default function MyClassNowPage() {
  const { t, x } = useI18n();
  const current = useApi<{ date: string; now: any; next: any }>('/attendance/now');

  // Move on to the next lesson by itself when the bell goes.
  useEvery(60_000, current.reload);

  if (current.error) return <ErrorNote error={current.error} />;
  if (!current.data) return null;
  const { now, next, date } = current.data;

  if (now) {
    return <AttendanceList key={`${now.classId}:${now.periodId}`} classId={now.classId} periodId={now.periodId} date={date} />;
  }

  return (
    <section className="between-lessons">
      <span>{t.att.betweenLessons}</span>
      <h1>{x(next ? t.att.nextLesson(next.className, next.subject, next.room, next.startTime) : t.att.noMoreLessons)}</h1>
      {next && <span className="num">{x(`${t.att.period(next.period)} · ${next.startTime}–${next.endTime}`)}</span>}
    </section>
  );
}
