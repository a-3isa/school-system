'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { todayCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Lesson, LessonRow } from '@/components/Lessons';
import { Empty, ErrorNote, Field, PageHead, Tabs } from '@/components/ui';

function TakeAttendance() {
  const { t } = useI18n();
  const [date, setDate] = useState(useSearchParams().get('date') ?? todayCairo());
  const lessons = useApi<Lesson[]>(`/attendance/my-lessons?date=${date}`);
  // A school has many classes and each has several lessons a day: narrow the list to one class, or to what still needs marking.
  const [classId, setClassId] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const all = lessons.data ?? [];
  const classes = [...new Map(all.map((l) => [l.classId, l.className])).entries()];
  const shown = all.filter((l) => (!classId || l.classId === classId) && (!onlyOpen || (l.students > 0 && l.marked < l.students)));

  return (
    <>
      <PageHead
        sub={date === todayCairo() ? t.take.subToday : t.take.subDay}
        title={t.nav.take}
      />
      <ErrorNote error={lessons.error} />
      <div className="toolbar">
        <Field label={t.common.date} id="day">
          <input id="day" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value || todayCairo())} />
        </Field>
        {classes.length > 1 && <Tabs label={t.common.class} value={classId} onChange={setClassId} items={[['', t.common.allClasses], ...classes.map(([id, name]): [string, string] => [id, name])]} />}
        {(classes.length > 1 || all.length > 6) && <label className="check" style={{ minHeight: 44 }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {t.take.onlyOpen}</label>}
      </div>
      <div className="panel">
        {shown.length ? (
          shown.map((l) => <LessonRow key={`${l.classId}:${l.periodId}`} l={l} date={date} />)
        ) : (
          <Empty>{lessons.loading ? t.common.loading : all.length ? t.take.noneOpen : t.take.none}</Empty>
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
