'use client';
import { Fragment, useEffect, useState } from 'react';
import { del, post, put, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, PageHead, Section, Tabs, Tag, toast } from '@/components/ui';

export default function TimetablePage() {
  const { me } = useSession();
  const { t, x, staff, subject } = useI18n();
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
  // Every lesson in the school: who already teaches a subject, and who is busy at a given time.
  const everyLesson = useApi<any[]>(isAdmin ? '/timetable' : null);
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

  /** The subjects this class has lessons in, with how many lessons and who teaches them (one teacher, none, or several). */
  const subjectRows = [...new Map((entries.data ?? []).map((e) => [e.subject.id, e.subject])).values()]
    .map((s) => {
      const lessons = (entries.data ?? []).filter((e) => e.subject.id === s.id);
      const ids = new Set(lessons.map((e) => e.teacherId ?? ''));
      return { subject: s, lessons: lessons.length, teacherId: ids.size === 1 ? [...ids][0] : '__several' };
    })
    .sort((a, b) => a.subject.name.localeCompare(b.subject.name));
  const assignedTo = (subjectId: string) => subjectRows.find((r) => r.subject.id === subjectId)?.teacherId || '';
  const teachersOfSubject = (subjectId: string) => new Set((everyLesson.data ?? []).filter((e) => e.subjectId === subjectId && e.teacherId).map((e) => e.teacherId as string));
  /** The class a teacher is in at that time, if they are in one. */
  const busyWith = (teacherId: string, day: number, periodId: string): string | null => (everyLesson.data ?? []).find((e) => e.teacherId === teacherId && e.dayOfWeek === day && e.periodId === periodId)?.class?.name ?? null;
  /**
   * The teachers to choose from for a subject: those who already teach it first (often there are several,
   * one for each class), then everyone else. Anyone already in another class at that time can't be chosen.
   */
  function teacherOptions(subjectId: string, day?: number, periodId?: string) {
    const known = teachersOfSubject(subjectId);
    const sub = subjects.data?.find((s) => s.id === subjectId) ?? subjectRows.find((r) => r.subject.id === subjectId)?.subject;
    const option = (tc: any) => {
      const busy = day !== undefined && periodId ? busyWith(tc.id, day, periodId) : null;
      return <option key={tc.id} value={tc.id} disabled={!!busy}>{staff(tc)}{busy ? ` · ${t.subj.busyWith(busy)}` : ''}</option>;
    };
    const mine = (teachers.data ?? []).filter((tc) => known.has(tc.id));
    const rest = (teachers.data ?? []).filter((tc) => !known.has(tc.id));
    return (
      <>
        {mine.length > 0 && <optgroup label={t.subj.teachThis(subject(sub))}>{mine.map(option)}</optgroup>}
        {rest.length > 0 && <optgroup label={mine.length ? t.subj.otherTeachers : t.subj.allTeachers}>{rest.map(option)}</optgroup>}
      </>
    );
  }

  async function assign(row: (typeof subjectRows)[number], teacherId: string) {
    if (teacherId === '__several') return;
    const who = teachers.data?.find((tc) => tc.id === teacherId);
    if (await act.run(async () => { await put('/timetable/assign', { classId, subjectId: row.subject.id, teacherId: teacherId || null }); })) {
      toast(who ? t.subj.assigned(subject(row.subject), staff(who)) : t.subj.unassigned(subject(row.subject)));
      await Promise.all([entries.reload(), everyLesson.reload()]);
    }
  }

  function startPick(key: string) {
    setPicking(key);
    setCellError(null);
    setPick({ subjectId: '', roomId: '', teacherId: '' });
  }

  async function add(d: number, periodId: string) {
    const key = `${d}:${periodId}`;
    try {
      await post('/timetable', { classId, dayOfWeek: d, periodId, subjectId: pick.subjectId, roomId: pick.roomId, teacherId: pick.teacherId });
      setPicking(null);
      await Promise.all([entries.reload(), everyLesson.reload()]);
    } catch (e) {
      // A clash (teacher or room already busy) is shown right in the cell.
      setCellError({ key, message: (e as Error).message });
    }
  }

  return (
    <>
      <PageHead sub={isTeacher ? t.tt.subMine : t.tt.sub} title={isTeacher ? t.tt.mine : t.nav.timetable} />
      {!isTeacher && <Tabs label={t.common.class} value={classId} onChange={(v) => { setClassId(v); setPicking(null); }} items={(classes.data ?? []).map((c): [string, string] => [c.id, c.name])} />}
      <ErrorNote error={(act.error ?? entries.error) && x((act.error ?? entries.error)!)} />
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
                          <b>{x(isTeacher ? `${e.class?.name} · ${subject(e.subject)}` : subject(e.subject))}</b>
                          <span>{e.room.name}</span>
                          {!isTeacher && e.teacher && <span>{staff(e.teacher)}</span>}
                          {isAdmin && (
                            <button type="button" className="icon-btn" aria-label={t.tt.remove} title={t.tt.remove} onClick={async () => { if (await act.run(() => del(`/timetable/${e.id}`))) await Promise.all([entries.reload(), everyLesson.reload()]); }}>✕</button>
                          )}
                        </div>
                      ) : isAdmin && picking === key ? (
                        <form className="pickcell" onSubmit={(ev) => { ev.preventDefault(); void add(d, p.id); }}>
                          <select required autoFocus aria-label={t.tt.subject} value={pick.subjectId} onChange={(ev) => {
                              // The class's teacher for this subject is suggested, unless they are busy then.
                              const suggested = assignedTo(ev.target.value);
                              setPick({ ...pick, subjectId: ev.target.value, teacherId: suggested && !busyWith(suggested, d, p.id) ? suggested : '' });
                            }}>
                            <option value="">{t.tt.subject}</option>
                            {subjects.data?.map((s) => <option key={s.id} value={s.id}>{subject(s)}</option>)}
                          </select>
                          <select required aria-label={t.tt.room} value={pick.roomId} onChange={(ev) => setPick({ ...pick, roomId: ev.target.value })}>
                            <option value="">{t.tt.room}</option>
                            {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          <select required disabled={!pick.subjectId} aria-label={t.tt.teacher} title={pick.subjectId ? undefined : t.subj.chooseSubjectFirst} value={pick.teacherId} onChange={(ev) => setPick({ ...pick, teacherId: ev.target.value })}>
                            <option value="">{pick.subjectId ? t.tt.teacher : t.subj.chooseSubjectFirst}</option>
                            {pick.subjectId && teacherOptions(pick.subjectId, d, p.id)}
                          </select>
                          {cellError?.key === key && <span className="cell-error" role="alert">✕ {x(cellError.message)}</span>}
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
      {isAdmin && classId && (
        <Section title={t.subj.teachersTitle} aside={t.subj.teachersSub}>
          <div className="panel">
            {subjectRows.length ? (
              subjectRows.map((r) => (
                <div key={r.subject.id} className="settings-row">
                  <span>
                    <b>{x(subject(r.subject))}</b>
                    <span>{t.subj.lessonsN(r.lessons)}</span>
                    {r.teacherId === '' && <span style={{ alignSelf: 'flex-start' }} title={t.subj.noTeacherNote}><Tag tone="L">! {t.subj.noTeacher}</Tag></span>}
                  </span>
                  <select className="input" aria-label={`${subject(r.subject)}: ${t.tt.teacher}`} value={r.teacherId} disabled={act.busy} onChange={(ev) => void assign(r, ev.target.value)} style={{ maxWidth: 260 }}>
                    <option value="">{t.subj.noTeacher}</option>
                    {r.teacherId === '__several' && <option value="__several" disabled>{t.subj.several}</option>}
                    {teacherOptions(r.subject.id)}
                  </select>
                </div>
              ))
            ) : (
              <Empty>{t.subj.noLessons}</Empty>
            )}
          </div>
        </Section>
      )}
    </>
  );
}
