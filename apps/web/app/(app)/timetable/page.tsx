'use client';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { del, post, put, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { CopyWeekModal } from '@/components/CopyWeekModal';
import { Empty, ErrorNote, PageHead, Section, Tabs, Tag, toast } from '@/components/ui';

/**
 * Each class's week. The periods are the school's, the same for every class; what a class decides is where
 * its subjects sit. A class has the subjects of its year group, each with one teacher the school gave it, so
 * placing a lesson means choosing the subject: the teacher comes with it. (A subject with no teacher yet gets
 * one the first time it is placed, or below under "Teachers of this class".)
 */
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
  const teachers = useApi<any[]>(isAdmin ? '/staff?role=TEACHER' : null);
  // This class's subjects with their teachers; every lesson in the school (who is busy when); and who teaches each subject in each class.
  const classSubjects = useApi<any[]>(isAdmin && classId ? `/classes/${classId}/subjects` : null);
  const everyLesson = useApi<any[]>(isAdmin ? '/timetable' : null);
  const taught = useApi<any[]>(isAdmin ? '/curriculum/teachers' : null);
  const school = useApi('/school');
  const act = useAction();
  /** The empty cell being filled in, as "day:periodId", and why the last add failed there. */
  const [picking, setPicking] = useState<string | null>(null);
  const [pick, setPick] = useState({ subjectId: '', roomId: '', teacherId: '' });
  const [cellError, setCellError] = useState<{ key: string; message: string } | null>(null);
  const [copying, setCopying] = useState(false);

  const days: number[] = school.data?.schoolDays ?? [0, 1, 2, 3, 4];
  const today = new Date(`${todayCairo()}T00:00:00Z`).getUTCDay();
  const sortedPeriods = [...(periods.data ?? [])].sort((a, b) => a.number - b.number);
  const at = (d: number, p: string) => entries.data?.find((e) => e.dayOfWeek === d && e.periodId === p);
  const current = classes.data?.find((c) => c.id === classId);
  const reloadAll = () => Promise.all([entries.reload(), everyLesson.reload(), classSubjects.reload(), taught.reload()]);

  const classSubject = (subjectId: string) => classSubjects.data?.find((s) => s.subjectId === subjectId);
  /** The class a teacher is in at that time, if they are in one. */
  const busyWith = (teacherId: string, day: number, periodId: string): string | null => (everyLesson.data ?? []).find((e) => e.teacherId === teacherId && e.dayOfWeek === day && e.periodId === periodId)?.class?.name ?? null;
  /**
   * The teachers to choose from for a subject: those who already teach it in some class first (often several,
   * one for each class), then everyone else. Anyone already in another class at that time can't be chosen.
   */
  function teacherOptions(subjectId: string, day?: number, periodId?: string) {
    const known = new Set((taught.data ?? []).filter((a) => a.subjectId === subjectId).map((a) => a.teacherId as string));
    const option = (tc: any) => {
      const busy = day !== undefined && periodId ? busyWith(tc.id, day, periodId) : null;
      return <option key={tc.id} value={tc.id} disabled={!!busy}>{staff(tc)}{busy ? ` · ${t.subj.busyWith(busy)}` : ''}</option>;
    };
    const mine = (teachers.data ?? []).filter((tc) => known.has(tc.id));
    const rest = (teachers.data ?? []).filter((tc) => !known.has(tc.id));
    const name = classSubject(subjectId);
    return (
      <>
        {mine.length > 0 && <optgroup label={t.subj.teachThis(name ? subject(name) : '')}>{mine.map(option)}</optgroup>}
        {rest.length > 0 && <optgroup label={mine.length ? t.subj.otherTeachers : t.subj.allTeachers}>{rest.map(option)}</optgroup>}
      </>
    );
  }

  async function assign(row: any, teacherId: string) {
    const who = teachers.data?.find((tc) => tc.id === teacherId);
    if (await act.run(async () => { await put('/timetable/assign', { classId, subjectId: row.subjectId, teacherId: teacherId || null }); })) {
      toast(who ? t.subj.assigned(subject(row), staff(who)) : t.subj.unassigned(subject(row)));
      await reloadAll();
    }
  }

  function startPick(key: string) {
    setPicking(key);
    setCellError(null);
    setPick({ subjectId: '', roomId: '', teacherId: '' });
  }

  async function add(d: number, periodId: string) {
    const key = `${d}:${periodId}`;
    const chosen = classSubject(pick.subjectId);
    try {
      // The teacher is named only when the subject has none yet: otherwise the lesson takes the subject's.
      await post('/timetable', { classId, dayOfWeek: d, periodId, subjectId: pick.subjectId, roomId: pick.roomId, ...(chosen && !chosen.teacher ? { teacherId: pick.teacherId } : {}) });
      setPicking(null);
      await reloadAll();
    } catch (e) {
      // A clash (teacher or room already busy) is shown right in the cell.
      setCellError({ key, message: (e as Error).message });
    }
  }

  return (
    <>
      <PageHead
        sub={isTeacher ? t.tt.subMine : t.tt.sub}
        title={isTeacher ? t.tt.mine : t.nav.timetable}
        actions={isAdmin && current && entries.data?.length ? <button type="button" className="btn" onClick={() => setCopying(true)}>{t.tt.copyWeek}</button> : undefined}
      />
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
                  const chosen = classSubject(pick.subjectId);
                  const busy = chosen?.teacher ? busyWith(chosen.teacher.id, d, p.id) : null;
                  return (
                    <div key={d} className={`c${d === today ? ' today' : ''}`}>
                      {e ? (
                        <div className="lessoncell">
                          <b>{x(isTeacher ? `${e.class?.name} · ${subject(e.subject)}` : subject(e.subject))}</b>
                          <span>{e.room.name}</span>
                          {!isTeacher && e.teacher && <span>{staff(e.teacher)}</span>}
                          {isAdmin && (
                            <button type="button" className="icon-btn" aria-label={t.tt.remove} title={t.tt.remove} onClick={async () => { if (await act.run(() => del(`/timetable/${e.id}`))) await reloadAll(); }}>✕</button>
                          )}
                        </div>
                      ) : isAdmin && picking === key ? (
                        <form className="pickcell" onSubmit={(ev) => { ev.preventDefault(); void add(d, p.id); }}>
                          <select required autoFocus aria-label={t.tt.subject} value={pick.subjectId} onChange={(ev) => setPick({ ...pick, subjectId: ev.target.value, teacherId: '' })}>
                            <option value="">{t.tt.subject}</option>
                            {classSubjects.data?.map((s) => <option key={s.subjectId} value={s.subjectId}>{subject(s)}{s.teacher ? ` · ${staff(s.teacher)}` : ` · ${t.subj.noTeacher}`}</option>)}
                          </select>
                          <select required aria-label={t.tt.room} value={pick.roomId} onChange={(ev) => setPick({ ...pick, roomId: ev.target.value })}>
                            <option value="">{t.tt.room}</option>
                            {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          {chosen?.teacher && <span className="small muted">{t.subj.takenBy(staff(chosen.teacher))}</span>}
                          {chosen && !chosen.teacher && (
                            <select required aria-label={t.tt.teacher} value={pick.teacherId} onChange={(ev) => setPick({ ...pick, teacherId: ev.target.value })}>
                              <option value="">{t.subj.chooseTeacher}</option>
                              {teacherOptions(pick.subjectId, d, p.id)}
                            </select>
                          )}
                          {busy && chosen?.teacher && <span className="cell-error" role="alert">✕ {x(t.subj.teacherBusy(staff(chosen.teacher), busy))}</span>}
                          {cellError?.key === key && <span className="cell-error" role="alert">✕ {x(cellError.message)}</span>}
                          <span className="row">
                            <button type="submit" className="btn primary" disabled={!!busy}>{t.common.add}</button>
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
      {isAdmin && current && (
        <CopyWeekModal
          open={copying}
          onClose={() => setCopying(false)}
          from={current}
          classes={classes.data ?? []}
          rooms={rooms.data ?? []}
          everyLesson={everyLesson.data ?? []}
          lessons={entries.data ?? []}
          onCopied={reloadAll}
          onOpenClass={(id) => { setClassId(id); setPicking(null); }}
        />
      )}
      {isAdmin && classId && classSubjects.data && (
        <Section title={t.subj.teachersTitle} aside={t.subj.teachersSub}>
          <div className="panel">
            {classSubjects.data.length ? (
              classSubjects.data.map((r) => (
                <div key={r.subjectId} className="settings-row">
                  <span>
                    <b>{x(subject(r))}</b>
                    <span>{t.subj.placed(r.lessons, r.lessonsPerWeek)}</span>
                    {!r.teacher && <span style={{ alignSelf: 'flex-start' }} title={t.subj.noTeacherNote}><Tag tone="L">! {t.subj.noTeacher}</Tag></span>}
                  </span>
                  <select className="input" aria-label={`${subject(r)}: ${t.tt.teacher}`} value={r.teacher?.id ?? ''} disabled={act.busy} onChange={(ev) => void assign(r, ev.target.value)} style={{ maxWidth: 260 }}>
                    <option value="">{t.subj.noTeacher}</option>
                    {teacherOptions(r.subjectId)}
                  </select>
                </div>
              ))
            ) : (
              <Empty title={t.subj.noClassSubjects}>
                {t.subj.noClassSubjectsSub} <Link href="/setup">{t.nav.structure}</Link>
              </Empty>
            )}
          </div>
        </Section>
      )}
    </>
  );
}
