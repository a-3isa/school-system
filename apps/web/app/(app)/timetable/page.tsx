'use client';
import { Fragment, useEffect, useState } from 'react';
import { del, post, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, PageHead, Tabs } from '@/components/ui';

export default function TimetablePage() {
  const { me } = useSession();
  const { t, x, staff } = useI18n();
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
  const rooms = useApi<any[]>(isAdmin ? '/rooms' : null);
  const subjects = useApi<any[]>(isAdmin ? '/subjects' : null);
  const teachers = useApi<any[]>(isAdmin ? '/staff?role=TEACHER' : null);
  const school = useApi('/school');
  const act = useAction();
  /** The empty cell being filled in, as "day:periodId", and why the last add failed there. */
  const [picking, setPicking] = useState<string | null>(null);
  const [pick, setPick] = useState({ subjectId: '', roomId: '', teacherId: '' });
  const [cellError, setCellError] = useState<{ key: string; message: string } | null>(null);

  const days: number[] = school.data?.schoolDays ?? [0, 1, 2, 3, 4];
  const today = new Date(`${todayCairo()}T00:00:00Z`).getUTCDay();
  const sortedPeriods = [...(periods.data ?? [])].sort((a, b) => a.number - b.number);
  const at = (d: number, p: string) => entries.data?.find((e) => e.dayOfWeek === d && e.periodId === p);

  function startPick(key: string) {
    setPicking(key);
    setCellError(null);
    setPick({ subjectId: '', roomId: '', teacherId: '' });
  }

  async function add(d: number, periodId: string) {
    const key = `${d}:${periodId}`;
    try {
      await post('/timetable', { classId, dayOfWeek: d, periodId, subjectId: pick.subjectId, roomId: pick.roomId, teacherId: pick.teacherId || undefined });
      setPicking(null);
      await entries.reload();
    } catch (e) {
      // A clash (teacher or room already busy) is shown right in the cell.
      setCellError({ key, message: (e as Error).message });
    }
  }

  return (
    <>
      <PageHead sub={isTeacher ? t.tt.subMine : t.tt.sub} title={isTeacher ? t.tt.mine : t.nav.timetable} />
      {!isTeacher && <Tabs label={t.common.class} value={classId} onChange={(v) => { setClassId(v); setPicking(null); }} items={(classes.data ?? []).map((c): [string, string] => [c.id, c.name])} />}
      <ErrorNote error={act.error ?? entries.error} />
      <div className="panel scroll">
        {sortedPeriods.length ? (
          <div className="tt" style={{ gridTemplateColumns: `92px repeat(${days.length}, minmax(150px, 1fr))` }}>
            <span className="h" />
            {days.map((d) => <span key={d} className={`h${d === today ? ' today' : ''}`}>{d === today ? `${t.days[d]} · ${t.tt.today}` : t.days[d]}</span>)}
            {sortedPeriods.map((p) => (
              <Fragment key={p.id}>
                <span className="p"><b>{t.lessons.p(p.number)}</b><span className="ltr">{p.startTime}–{p.endTime}</span></span>
                {days.map((d) => {
                  const e = at(d, p.id);
                  const key = `${d}:${p.id}`;
                  return (
                    <div key={d} className={`c${d === today ? ' today' : ''}`}>
                      {e ? (
                        <div className="lessoncell">
                          <b>{x(isTeacher ? `${e.class?.name} · ${e.subject.name}` : e.subject.name)}</b>
                          <span>{e.room.name}</span>
                          {!isTeacher && e.teacher && <span>{staff(e.teacher)}</span>}
                          {isAdmin && (
                            <button type="button" className="icon-btn" aria-label={t.tt.remove} title={t.tt.remove} onClick={async () => { if (await act.run(() => del(`/timetable/${e.id}`))) await entries.reload(); }}>✕</button>
                          )}
                        </div>
                      ) : isAdmin && picking === key ? (
                        <form className="pickcell" onSubmit={(ev) => { ev.preventDefault(); void add(d, p.id); }}>
                          <select required autoFocus aria-label={t.tt.subject} value={pick.subjectId} onChange={(ev) => setPick({ ...pick, subjectId: ev.target.value })}>
                            <option value="">{t.tt.subject}</option>
                            {subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <select required aria-label={t.tt.room} value={pick.roomId} onChange={(ev) => setPick({ ...pick, roomId: ev.target.value })}>
                            <option value="">{t.tt.room}</option>
                            {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          <select aria-label={t.tt.teacher} value={pick.teacherId} onChange={(ev) => setPick({ ...pick, teacherId: ev.target.value })}>
                            <option value="">{t.tt.teacher}</option>
                            {teachers.data?.map((tc) => <option key={tc.id} value={tc.id}>{staff(tc)}</option>)}
                          </select>
                          {cellError?.key === key && <span className="cell-error" role="alert">✕ {cellError.message}</span>}
                          <span className="row">
                            <button type="submit" className="btn primary">{t.common.add}</button>
                            <button type="button" className="btn" onClick={() => setPicking(null)}>{t.common.cancel}</button>
                          </span>
                        </form>
                      ) : isAdmin ? (
                        <button type="button" className="addcell" onClick={() => startPick(key)}>+ {t.tt.addLesson}</button>
                      ) : null}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        ) : (
          <Empty>{t.tt.addPeriodsFirst}</Empty>
        )}
      </div>
    </>
  );
}
