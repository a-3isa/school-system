'use client';
import { FormEvent, ReactNode, useState } from 'react';
import { del, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Dict } from '@/lib/strings';
import { Empty, ErrorNote, PageHead, toast } from '@/components/ui';

const ROOM_KINDS = ['CLASSROOM', 'LAB', 'LIBRARY', 'SPORTS', 'OTHER'] as const;

/** A small list with a remove button on each row and an add form underneath. */
function Editor({ title, rows, onAdd, children }: { title: string; rows: { key: string; a: ReactNode; b?: ReactNode; remove?: () => void }[]; onAdd: (e: FormEvent) => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="editor">
      <div className="editor-head"><b>{title}</b><span className="num">{rows.length}</span></div>
      {rows.map((r) => (
        <div key={r.key} className="editor-row">
          <span><span>{r.a}</span>{r.b && <small>{r.b}</small>}</span>
          {r.remove && <button type="button" className="icon-btn" aria-label={t.common.remove} title={t.common.remove} onClick={r.remove}>✕</button>}
        </div>
      ))}
      {!rows.length && <Empty>{t.setup.none}</Empty>}
      <form className="editor-add" onSubmit={onAdd}>
        {children}
        <button className="btn" type="submit">{t.common.add}</button>
      </form>
    </div>
  );
}

export default function SetupPage() {
  const { t, x } = useI18n();
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

  const submit = (fn: () => Promise<unknown>, done: () => void) => async (e: FormEvent) => {
    e.preventDefault();
    if (await act.run(fn)) {
      toast(t.setup.added);
      done();
    }
  };
  const remove = (path: string, reload: () => Promise<void>) => async () => {
    if (await act.run(() => del(path))) await reload();
  };
  const kind = (k: string) => t.setup.roomKinds[k as keyof Dict['setup']['roomKinds']] ?? k;

  return (
    <>
      <PageHead sub={t.setup.sub} title={t.nav.structure} />
      <ErrorNote error={act.error} />
      <div className="editors">
        <Editor
          title={t.setup.classes}
          rows={(classes.data ?? []).map((c) => ({ key: c.id, a: <bdi dir="ltr">{c.name}</bdi>, b: x([c.grade.name, t.setup.nStudents(c._count.students), c.homeroomTeacher?.name].filter(Boolean).join(' · ')), remove: remove(`/classes/${c.id}`, classes.reload) }))}
          onAdd={submit(() => post('/classes', { ...cls, homeroomTeacherId: cls.homeroomTeacherId || undefined }), () => { setCls({ ...cls, name: '' }); void classes.reload(); })}
        >
          <input className="input" required aria-label={t.setup.newClass} placeholder={t.setup.newClass} value={cls.name} onChange={(e) => setCls({ ...cls, name: e.target.value })} />
          <select className="input" required aria-label={t.setup.grade} value={cls.gradeId} onChange={(e) => setCls({ ...cls, gradeId: e.target.value })}>
            <option value="">{t.setup.grade}</option>
            {grades.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select className="input" aria-label={t.setup.homeroom} value={cls.homeroomTeacherId} onChange={(e) => setCls({ ...cls, homeroomTeacherId: e.target.value })}>
            <option value="">{t.setup.homeroom}</option>
            {teachers.data?.map((tc) => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
          </select>
        </Editor>

        <Editor
          title={t.setup.rooms}
          rows={(rooms.data ?? []).map((r) => ({ key: r.id, a: r.name, b: kind(r.kind), remove: remove(`/rooms/${r.id}`, rooms.reload) }))}
          onAdd={submit(() => post('/rooms', room), () => { setRoom({ ...room, name: '' }); void rooms.reload(); })}
        >
          <input className="input" required aria-label={t.setup.newRoom} placeholder={t.setup.newRoom} value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} />
          <select className="input" aria-label={t.setup.kind} value={room.kind} onChange={(e) => setRoom({ ...room, kind: e.target.value })}>
            {ROOM_KINDS.map((k) => <option key={k} value={k}>{kind(k)}</option>)}
          </select>
        </Editor>

        <Editor
          title={t.setup.periods}
          rows={(periods.data ?? []).map((p) => ({ key: p.id, a: t.today.periodN(p.number), b: <bdi dir="ltr">{p.startTime}–{p.endTime}</bdi>, remove: remove(`/periods/${p.id}`, periods.reload) }))}
          onAdd={submit(() => post('/periods', period), () => { setPeriod({ number: period.number + 1, startTime: period.endTime, endTime: period.endTime }); void periods.reload(); })}
        >
          <input className="input num" type="number" min={1} aria-label={t.setup.number} value={period.number} onChange={(e) => setPeriod({ ...period, number: Number(e.target.value) })} style={{ flex: '0 0 64px' }} />
          <input className="input num" type="time" required aria-label={t.setup.starts} value={period.startTime} onChange={(e) => setPeriod({ ...period, startTime: e.target.value })} />
          <input className="input num" type="time" required aria-label={t.setup.ends} value={period.endTime} onChange={(e) => setPeriod({ ...period, endTime: e.target.value })} />
        </Editor>

        <Editor
          title={t.setup.grades}
          rows={(grades.data ?? []).map((g) => ({ key: g.id, a: g.name, remove: remove(`/grades/${g.id}`, grades.reload) }))}
          onAdd={submit(() => post('/grades', grade), () => { setGrade({ name: '', order: grade.order + 1 }); void grades.reload(); })}
        >
          <input className="input" required aria-label={t.setup.newGrade} placeholder={t.setup.newGrade} value={grade.name} onChange={(e) => setGrade({ ...grade, name: e.target.value })} />
          <input className="input num" type="number" aria-label={t.setup.order} value={grade.order} onChange={(e) => setGrade({ ...grade, order: Number(e.target.value) })} style={{ flex: '0 0 64px' }} />
        </Editor>

        <Editor
          title={t.setup.subjects}
          rows={(subjects.data ?? []).map((s) => ({ key: s.id, a: s.name }))}
          onAdd={submit(() => post('/subjects', { name: subject }), () => { setSubject(''); void subjects.reload(); })}
        >
          <input className="input" required aria-label={t.setup.newSubject} placeholder={t.setup.newSubject} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Editor>
      </div>
    </>
  );
}
