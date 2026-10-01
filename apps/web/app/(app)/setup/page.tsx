'use client';
import { FormEvent, useState } from 'react';
import { del, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { Card, Empty, ErrorNote, Field, PageHead, toast } from '@/components/ui';

export default function SetupPage() {
  const grades = useApi<any[]>('/grades');
  const classes = useApi<any[]>('/classes');
  const rooms = useApi<any[]>('/rooms');
  const subjects = useApi<any[]>('/subjects');
  const periods = useApi<any[]>('/periods');
  const teachers = useApi<any[]>('/staff?role=TEACHER');
  const act = useAction();

  const [grade, setGrade] = useState({ name: '', order: 1 });
  const [cls, setCls] = useState({ name: '', gradeId: '', homeroomTeacherId: '' });
  const [room, setRoom] = useState({ name: '', kind: 'CLASSROOM' });
  const [subject, setSubject] = useState('');
  const [period, setPeriod] = useState({ number: 1, startTime: '08:00', endTime: '08:45' });

  const submit = (fn: () => Promise<unknown>, done: () => void, msg: string) => async (e: FormEvent) => {
    e.preventDefault();
    if (await act.run(fn)) {
      toast(msg);
      done();
    }
  };
  const remove = async (path: string, reload: () => Promise<void>) => {
    if (await act.run(() => del(path))) await reload();
  };

  return (
    <>
      <PageHead eyebrow="School setup" title="Classes, rooms & periods" sub="The structure everything else hangs on. Periods are the school’s bell schedule." />
      <ErrorNote error={act.error} />
      <div className="grid g2">
        <Card title="Grades">
          {grades.data?.map((g) => (
            <div key={g.id} className="row between"><span>{g.name}</span><button className="btn small" onClick={() => remove(`/grades/${g.id}`, grades.reload)}>Delete</button></div>
          ))}
          <form className="form-row" onSubmit={submit(() => post('/grades', grade), () => { setGrade({ name: '', order: grade.order + 1 }); void grades.reload(); }, 'Grade added.')}>
            <Field label="Name" id="gn"><input id="gn" className="input" required placeholder="Grade 4" value={grade.name} onChange={(e) => setGrade({ ...grade, name: e.target.value })} /></Field>
            <Field label="Order" id="go"><input id="go" className="input" type="number" value={grade.order} onChange={(e) => setGrade({ ...grade, order: Number(e.target.value) })} /></Field>
            <button className="btn primary" type="submit">Add</button>
          </form>
        </Card>

        <Card title="Classes">
          {classes.data?.length ? classes.data.map((c) => (
            <div key={c.id} className="row between">
              <span>{c.name} <span className="muted small">· {c.grade.name} · {c._count.students} students{c.homeroomTeacher ? ` · ${c.homeroomTeacher.name}` : ''}</span></span>
              <button className="btn small" onClick={() => remove(`/classes/${c.id}`, classes.reload)}>Delete</button>
            </div>
          )) : <Empty>No classes yet.</Empty>}
          <form className="form-row" onSubmit={submit(() => post('/classes', { ...cls, homeroomTeacherId: cls.homeroomTeacherId || undefined }), () => { setCls({ ...cls, name: '' }); void classes.reload(); }, 'Class added.')}>
            <Field label="Name" id="cn"><input id="cn" className="input" required placeholder="4-A" value={cls.name} onChange={(e) => setCls({ ...cls, name: e.target.value })} /></Field>
            <Field label="Grade" id="cg">
              <select id="cg" className="input" required value={cls.gradeId} onChange={(e) => setCls({ ...cls, gradeId: e.target.value })}>
                <option value="">Choose</option>
                {grades.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Homeroom teacher" id="ct">
              <select id="ct" className="input" value={cls.homeroomTeacherId} onChange={(e) => setCls({ ...cls, homeroomTeacherId: e.target.value })}>
                <option value="">None</option>
                {teachers.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <button className="btn primary" type="submit">Add</button>
          </form>
        </Card>

        <Card title="Rooms">
          {rooms.data?.map((r) => (
            <div key={r.id} className="row between"><span>{r.name} <span className="muted small">· {r.kind.toLowerCase()}</span></span><button className="btn small" onClick={() => remove(`/rooms/${r.id}`, rooms.reload)}>Delete</button></div>
          ))}
          <form className="form-row" onSubmit={submit(() => post('/rooms', room), () => { setRoom({ ...room, name: '' }); void rooms.reload(); }, 'Room added.')}>
            <Field label="Name" id="rn"><input id="rn" className="input" required placeholder="Room 204" value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} /></Field>
            <Field label="Kind" id="rk">
              <select id="rk" className="input" value={room.kind} onChange={(e) => setRoom({ ...room, kind: e.target.value })}>
                {['CLASSROOM', 'LAB', 'LIBRARY', 'SPORTS', 'OTHER'].map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}
              </select>
            </Field>
            <button className="btn primary" type="submit">Add</button>
          </form>
        </Card>

        <Card title="Periods (bell schedule)">
          {periods.data?.map((p) => (
            <div key={p.id} className="row between num"><span>Period {p.number} · {p.startTime}–{p.endTime}</span><button className="btn small" onClick={() => remove(`/periods/${p.id}`, periods.reload)}>Delete</button></div>
          ))}
          <form className="form-row" onSubmit={submit(() => post('/periods', period), () => { setPeriod({ number: period.number + 1, startTime: period.endTime, endTime: period.endTime }); void periods.reload(); }, 'Period added.')}>
            <Field label="Number" id="pn"><input id="pn" className="input" type="number" min={1} value={period.number} onChange={(e) => setPeriod({ ...period, number: Number(e.target.value) })} /></Field>
            <Field label="Starts" id="ps"><input id="ps" className="input" type="time" required value={period.startTime} onChange={(e) => setPeriod({ ...period, startTime: e.target.value })} /></Field>
            <Field label="Ends" id="pe"><input id="pe" className="input" type="time" required value={period.endTime} onChange={(e) => setPeriod({ ...period, endTime: e.target.value })} /></Field>
            <button className="btn primary" type="submit">Add</button>
          </form>
        </Card>

        <Card title="Subjects">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{subjects.data?.map((s) => <span key={s.id} className="badge">{s.name}</span>)}</div>
          <form className="form-row" onSubmit={submit(() => post('/subjects', { name: subject }), () => { setSubject(''); void subjects.reload(); }, 'Subject added.')}>
            <Field label="Name" id="sn"><input id="sn" className="input" required placeholder="Math" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <button className="btn primary" type="submit">Add</button>
          </form>
        </Card>
      </div>
    </>
  );
}
