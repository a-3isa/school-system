'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { todayCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Lesson, LessonRow } from '@/components/Lessons';
import { Empty, ErrorNote, Field, PageHead } from '@/components/ui';

function TakeAttendance() {
  const { t } = useI18n();
  const [date, setDate] = useState(useSearchParams().get('date') ?? todayCairo());
  const lessons = useApi<Lesson[]>(`/attendance/my-lessons?date=${date}`);

  return (
    <>
      <PageHead
        sub={date === todayCairo() ? t.take.subToday : t.take.subDay}
        title={t.nav.take}
        actions={
          <Field label={t.common.date} id="day">
            <input id="day" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value || todayCairo())} />
          </Field>
        }
      />
      <ErrorNote error={lessons.error} />
      <div className="panel">
        {lessons.data?.length ? (
          lessons.data.map((l) => <LessonRow key={`${l.classId}:${l.periodId}`} l={l} date={date} />)
        ) : (
          <Empty>{lessons.loading ? t.common.loading : t.take.none}</Empty>
        )}
      </div>
    </>
  );
}

export default function AttendanceHome() {
  return (
    <Suspense>
      <TakeAttendance />
    </Suspense>
  );
}
