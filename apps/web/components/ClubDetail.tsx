'use client';
import { useEffect, useState } from 'react';
import { post, put, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Places } from './ClassPicker';
import { Empty, ErrorNote, Note, PageHead, Tabs, Tag, toast } from './ui';

/** The club's meeting days in a short form: "Sun, Tue" / «الأحد، الثلاثاء». */
export function useDaysLine() {
  const { t, lang } = useI18n();
  return (days: number[]) => [...days].sort().map((d) => (lang === 'ar' ? t.days[d] : t.days[d].slice(0, 3))).join(lang === 'ar' ? '، ' : ', ');
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The latest day up to today on which a club meets, so attendance opens on a day that makes sense. */
function lastMeeting(days: number[]): string {
  const today = todayCairo();
  for (let i = 0; i < 14; i++) {
    const d = new Date(new Date(`${today}T00:00:00Z`).getTime() - i * 86400_000).toISOString().slice(0, 10);
    if (days.includes(weekdayOf(d))) return d;
  }
  return today;
}

function Members({ club, paidOn, isAdmin, onChanged }: { club: any; paidOn: boolean; isAdmin: boolean; onChanged: () => void }) {
  const { t, x, lang } = useI18n();
  const roster = useApi<any>(`/activities/${club.id}/roster`);
  const act = useAction();
  const [q, setQ] = useState('');
  const found = useApi<any[]>(isAdmin && q.trim().length >= 2 ? `/students?active=true&q=${encodeURIComponent(q.trim())}` : null);
  const taken = new Set([...(roster.data?.enrolled ?? []), ...(roster.data?.waitlist ?? [])].map((r: any) => r.studentId));
  const nameOf = (r: any) => x(lang === 'ar' && r.nameAr ? r.nameAr : r.name);
  const showPaid = paidOn && club.fee != null;

  async function after(message: string) {
    toast(message);
    await roster.reload();
    onChanged();
  }
  async function withdraw(r: any) {
    if (!confirm(t.act.withdrawConfirm(r.name))) return;
    if (await act.run(() => post(`/activities/${club.id}/students/${r.studentId}/withdraw`))) await after(t.act.withdrawn);
  }
  async function setPaid(r: any, paid: boolean) {
    if (await act.run(() => post(`/activities/${club.id}/students/${r.studentId}/paid`, { paid }))) await roster.reload();
  }
  async function enrol(s: any) {
    let over = false;
    if (await act.run(async () => { over = (await post(`/activities/${club.id}/enrol`, { studentId: s.id })).overCapacity; })) {
      setQ('');
      await after(over ? t.act.overCapacity : t.act.added(`${s.firstName} ${s.lastName}`));
    }
  }

  const row = (r: any, position?: number) => (
    <article key={r.studentId} className="list-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <span className="stack" style={{ flex: '1 1 220px', gap: 2 }}>
        <b>{position ? <span className="muted">{t.act.position(position)} · </span> : null}{nameOf(r)}</b>
        <span className="small muted">{[r.class && x(r.class), <bdi key="c" dir="ltr">{r.code}</bdi>].reduce<any[]>((a, b, i) => (b && i ? [...a, ' · ', b] : [...a, b]), [])}</span>
      </span>
      <span className="small muted" style={{ flex: '1 1 200px' }}>
        {r.parents.map((p: any, i: number) => <span key={i}>{i ? ' · ' : ''}{p.name}{p.phone ? <> <bdi dir="ltr">{p.phone}</bdi></> : null}</span>)}
      </span>
      {!position && r.attendanceRate != null && <span className="small muted">{t.act.attendedPct(r.attendanceRate)}</span>}
      {!position && showPaid && isAdmin && (
        <button type="button" className="chip-toggle" aria-pressed={!!r.paidAt} disabled={act.busy} onClick={() => void setPaid(r, !r.paidAt)}>{r.paidAt ? `✓ ${t.act.paid}` : t.act.notPaid}</button>
      )}
      <button type="button" className="btn small" disabled={act.busy} onClick={() => void withdraw(r)}>{t.act.withdraw}</button>
    </article>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      <ErrorNote error={(act.error ?? roster.error) && x((act.error ?? roster.error)!)} />
      {isAdmin && (
        <div className="stack" style={{ gap: 6 }}>
          <input type="search" className="input" aria-label={t.act.addStudent} placeholder={`${t.act.addStudent}: ${t.students.search}`} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 420 }} />
          {q.trim().length >= 2 && found.data && (
            <div className="panel">
              {found.data.filter((s) => !taken.has(s.id)).slice(0, 8).map((s) => (
                <button key={s.id} type="button" className="list-row" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'start', font: 'inherit', color: 'inherit' }} disabled={act.busy} onClick={() => void enrol(s)}>
                  <span><b>{x(lang === 'ar' && s.nameAr ? s.nameAr : `${s.firstName} ${s.lastName}`)}</b> <span className="small muted">{s.class?.name && x(s.class.name)}</span></span>
                  <span className="btn small">{t.common.add}</span>
                </button>
              ))}
              {!found.data.filter((s) => !taken.has(s.id)).length && <Empty>{t.act.noMatch}</Empty>}
            </div>
          )}
        </div>
      )}
      <section className="panel">
        {roster.data?.enrolled.length ? roster.data.enrolled.map((r: any) => row(r)) : <Empty>{roster.loading ? t.common.loading : t.act.noMembers}</Empty>}
      </section>
      {roster.data?.waitlist.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, margin: 0 }}>{t.act.waitlist}</h2>
          <section className="panel">{roster.data.waitlist.map((r: any) => row(r, r.position))}</section>
        </>
      )}
    </div>
  );
}

function ClubAttendance({ club }: { club: any }) {
  const { t, x, lang } = useI18n();
  const [date, setDate] = useState(() => lastMeeting(club.days));
  const day = useApi<any>(`/activities/${club.id}/attendance?date=${date}`);
  const act = useAction();
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setMarks(Object.fromEntries((day.data?.students ?? []).filter((s: any) => s.present !== null).map((s: any) => [s.studentId, s.present])));
  }, [day.data]);
  const meets = club.days.includes(weekdayOf(date));
  const students: any[] = day.data?.students ?? [];

  async function save() {
    if (await act.run(() => put(`/activities/${club.id}/attendance`, { date, present: marks }))) {
      toast(t.act.attendanceSaved);
      await day.reload();
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="toolbar">
        <label className="field">
          {t.common.date}
          <input type="date" className="input" value={date} max={todayCairo()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <span className="small muted" style={{ alignSelf: 'center' }}>{t.act.meetsOn(daysLineOf(club.days, t, lang))}</span>
      </div>
      <ErrorNote error={(act.error ?? day.error) && x((act.error ?? day.error)!)} />
      {!meets && <Note tone="warn">{t.act.notMeetDay}</Note>}
      {meets && (
        <section className="panel">
          {students.length ? (
            <>
              {students.map((s) => (
                <article key={s.studentId} className="list-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span className="stack" style={{ flex: '1 1 200px', gap: 2 }}>
                    <b>{x(lang === 'ar' && s.nameAr ? s.nameAr : s.name)}</b>
                    <span className="small muted">{s.class && x(s.class)}</span>
                  </span>
                  <span className="chips">
                    <button type="button" className="chip-toggle" aria-pressed={marks[s.studentId] === true} onClick={() => setMarks({ ...marks, [s.studentId]: true })}>✓ {t.act.present}</button>
                    <button type="button" className="chip-toggle" aria-pressed={marks[s.studentId] === false} onClick={() => setMarks({ ...marks, [s.studentId]: false })}>✕ {t.act.absent}</button>
                  </span>
                  {marks[s.studentId] === undefined && <Tag>{t.act.notMarked}</Tag>}
                </article>
              ))}
              <div className="form-actions" style={{ padding: '14px 18px' }}>
                <button type="button" className="btn primary" disabled={act.busy || !Object.keys(marks).length} onClick={() => void save()}>{t.act.saveAttendance}</button>
                <button type="button" className="btn" onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.studentId, true])))}>{t.act.allPresent}</button>
              </div>
            </>
          ) : (
            <Empty>{day.loading ? t.common.loading : t.act.noMembers}</Empty>
          )}
        </section>
      )}
    </div>
  );
}

/** The days line, from the translations at hand. */
function daysLineOf(days: number[], t: any, lang: string) {
  return [...days].sort().map((d) => (lang === 'ar' ? t.days[d] : t.days[d].slice(0, 3))).join(lang === 'ar' ? '، ' : ', ');
}

/** One club: who is in it and who is waiting, and the register of its sessions. */
export function ClubDetail({ club, paidOn, isAdmin, onBack, onEdit, onChanged, onArchived }: {
  club: any;
  paidOn: boolean;
  isAdmin: boolean;
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onArchived: () => void;
}) {
  const { t, x, staff, lang } = useI18n();
  const daysLine = useDaysLine();
  const [tab, setTab] = useState<'members' | 'attendance'>('members');
  const act = useAction();
  const name = x(lang === 'ar' && club.nameAr ? club.nameAr : club.name);

  async function archive() {
    if (!confirm(t.act.archiveConfirm(club.name))) return;
    if (await act.run(() => post(`/activities/${club.id}/archive`))) {
      toast(t.act.archived);
      onArchived();
    }
  }

  return (
    <>
      <PageHead
        crumb={<button type="button" className="btn link" onClick={onBack}>{t.act.allClubs}</button>}
        sub={<>{daysLine(club.days)} · <bdi dir="ltr">{club.startTime}–{club.endTime}</bdi>{club.room ? ` · ${x(club.room.name)}` : ''}{club.supervisor ? ` · ${staff(club.supervisor)}` : ''}</>}
        title={name}
        actions={isAdmin ? (
          <>
            <button type="button" className="btn" onClick={onEdit}>{t.act.editClub}</button>
            <button type="button" className="btn" disabled={act.busy} onClick={() => void archive()}>{t.act.archive}</button>
          </>
        ) : undefined}
      />
      <ErrorNote error={act.error && x(act.error)} />
      {club.description && <p style={{ margin: 0, maxWidth: 680 }}>{club.description}</p>}
      <div className="row wrap" style={{ gap: 16 }}>
        <Places n={club.enrolled} capacity={club.capacity} />
        {club.waitlisted > 0 && <span className="small muted">{t.act.waitlistN(club.waitlisted)}</span>}
        {club.fee != null && <Tag>{t.act.feeEgp(club.fee)}</Tag>}
        {!club.signupOpen && <Tag tone="L">{t.act.signupClosed}</Tag>}
      </div>
      {club.canManage ? (
        <>
          <Tabs label={name} value={tab} onChange={setTab} items={[['members', t.act.members], ['attendance', t.act.attendance]]} />
          {tab === 'members' ? <Members club={club} paidOn={paidOn} isAdmin={isAdmin} onChanged={onChanged} /> : <ClubAttendance club={club} />}
        </>
      ) : null}
    </>
  );
}
