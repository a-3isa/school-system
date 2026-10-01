'use client';
import { FormEvent, useEffect, useState } from 'react';
import { del, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Card, Empty, ErrorNote, Field, PageHead, toast } from '@/components/ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function TimetablePage() {
  const { me } = useSession();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  // A teacher sees their own week across all their classes.
  const isTeacher = me.role === 'TEACHER';
  const classes = useApi<any[]>(isTeacher ? null : '/classes');
  const [classId, setClassId] = useState('');
  useEffect(() => {
    if (!classId && classes.data?.length) setClassId(classes.data[0].id);
  }, [classes.data, classId]);
  const entries = useApi<any[]>(isTeacher ? '/timetable' : classId ? `/timetable?classId=${classId}` : null);
  const periods = useApi<any[]>('/periods');
  const rooms = useApi<any[]>('/rooms');
  const subjects = useApi<any[]>('/subjects');
  const teachers = useApi<any[]>(isAdmin ? '/staff?role=TEACHER' : null);
  const school = useApi('/school');
  const act = useAction();
  const [form, setForm] = useState({ dayOfWeek: 0, periodId: '', roomId: '', subjectId: '', teacherId: '' });

  const days: number[] = school.data?.schoolDays ?? [0, 1, 2, 3, 4];
  const at = (d: number, p: string) => entries.data?.find((e) => e.dayOfWeek === d && e.periodId === p);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/timetable', { ...form, classId, dayOfWeek: Number(form.dayOfWeek), teacherId: form.teacherId || undefined }))) {
      toast('Lesson added.');
      await entries.reload();
    }
  }

  return (
    <>
      <PageHead
        eyebrow={isTeacher ? me.name : 'School setup'}
        title={isTeacher ? 'My timetable' : 'Timetable'}
        sub={isTeacher ? 'Your lessons this week: class, subject and room.' : 'Which class is in which room each period. Automatic attendance uses it to know whose straps a room gateway should hear.'}
        actions={
          !isTeacher && <Field label="Class" id="cls">
            <select id="cls" className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        }
      />
      <ErrorNote error={act.error ?? entries.error} />
      <Card pad={false}>
        {periods.data?.length ? (
          <div className="table-wrap" style={{ padding: 16 }}>
            <div className="tt" style={{ gridTemplateColumns: `90px repeat(${days.length}, minmax(0, 1fr))` }}>
              <div />
              {days.map((d) => <div key={d} className="tt-head">{DAYS[d]}</div>)}
              {periods.data.map((p) => (
                <FragmentRow key={p.id}>
                  <div className="small muted num">{p.number} · {p.startTime}</div>
                  {days.map((d) => {
                    const e = at(d, p.id);
                    return (
                      <div key={d} className="tt-cell">
                        {e ? (
                          <>
                            <b>{isTeacher ? `${e.class?.name} · ${e.subject.name}` : e.subject.name}</b>
                            <span className="muted">{e.room.name}{!isTeacher && e.teacher ? ` · ${e.teacher.name}` : ''}</span>
                            {isAdmin && (
                              <div><button className="btn small" style={{ marginTop: 4 }} onClick={async () => { if (await act.run(() => del(`/timetable/${e.id}`))) await entries.reload(); }}>Remove</button></div>
                            )}
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </FragmentRow>
              ))}
            </div>
          </div>
        ) : (
          <Empty>Add periods first (Classes, rooms &amp; periods).</Empty>
        )}
      </Card>
      {isAdmin && classId && (
        <Card title="Add a lesson">
          <form className="form-row" onSubmit={add}>
            <Field label="Day" id="d">
              <select id="d" className="input" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>
                {days.map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
              </select>
            </Field>
            <Field label="Period" id="p">
              <select id="p" className="input" required value={form.periodId} onChange={(e) => setForm({ ...form, periodId: e.target.value })}>
                <option value="">Choose</option>
                {periods.data?.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.startTime}</option>)}
              </select>
            </Field>
            <Field label="Subject" id="s">
              <select id="s" className="input" required value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
                <option value="">Choose</option>
                {subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Room" id="r">
              <select id="r" className="input" required value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
                <option value="">Choose</option>
                {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Teacher" id="t">
              <select id="t" className="input" value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>
                <option value="">None</option>
                {teachers.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <button className="btn primary" type="submit" disabled={act.busy}>Add lesson</button>
          </form>
        </Card>
      )}
    </>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
