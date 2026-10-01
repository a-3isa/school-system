'use client';
import { useEffect } from 'react';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Card, ErrorNote, PageHead } from '@/components/ui';
import { AttendanceList } from '@/components/AttendanceList';

/** Where a teacher lands: the class in front of them right now. */
export default function MyClassNowPage() {
  const { me } = useSession();
  const current = useApi<{ date: string; now: any; next: any }>('/attendance/now');

  // Move on to the next lesson by itself when the bell goes.
  useEffect(() => {
    const t = setInterval(() => void current.reload(), 60_000);
    return () => clearInterval(t);
  }, [current.reload]);

  if (current.error) return <ErrorNote error={current.error} />;
  if (!current.data) return null;
  const { now, next, date } = current.data;

  if (now) {
    return (
      <AttendanceList
        key={`${now.classId}:${now.periodId}`}
        classId={now.classId}
        periodId={now.periodId}
        date={date}
        eyebrow={`Your class now · Period ${now.period} · ${now.startTime}–${now.endTime}`}
      />
    );
  }

  return (
    <>
      <PageHead eyebrow="Your class now" title="No lesson right now" sub={`Signed in as ${me.name}.`} />
      <Card>
        {next ? (
          <span>
            Next: <b>{next.className} · {next.subject}</b> in {next.room}, period {next.period} at {next.startTime}. This page opens it when it starts.
          </span>
        ) : (
          <span className="muted">No more lessons for you today.</span>
        )}
      </Card>
    </>
  );
}
