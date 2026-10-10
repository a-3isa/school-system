'use client';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { minutes, nowCairo, put, timeCairo, todayCairo } from '@/lib/api';
import { useAction, useApi, useEvery } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ABSENCE_TONE, EXCUSE_TONE } from './Lessons';
import { ErrorNote, LiveStamp, Note, Status, STATUS_GLYPH, Tag, toast } from './ui';

const CHOICES: Status[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
const REFRESH_MS = 15_000;

/**
 * The one attendance screen, for teachers and admins alike, with or without
 * straps; only where the starting values come from differs.
 * - With straps: each child starts as the strap says (in the room = present,
 *   or as the lesson was decided). Change a child the strap got wrong (a
 *   forgotten strap) and save.
 * - Without straps: everyone starts as present; tap the absent ones and save.
 */
export function AttendanceList({ classId, periodId, date, crumb }: { classId: string; periodId: string; date: string; crumb?: boolean }) {
  const { t, x, staff } = useI18n();
  const roster = useApi(`/attendance/classes/${classId}/periods/${periodId}?date=${date}`);
  const isToday = date === todayCairo();
  const periods = useApi<any[]>(isToday ? '/periods' : null);
  const save = useAction();
  const [chosen, setChosen] = useState<Record<string, Status>>({});
  /** The row order shown last; kept once the teacher has tapped anyone, so nothing jumps under their finger. */
  const order = useRef<string[]>([]);
  const touchedOnce = useRef(false);
  const auto = roster.data?.mode === 'AUTOMATIC';
  // The straps say who is here only during the lesson, while the room's gateway is working.
  const live = auto && roster.data?.lessonState === 'now' && roster.data?.gatewayWorking;
  const fromStrap = (s: any) => !s.status && live && !!s.live;

  // With straps the list follows the room live; the teacher's taps are kept.
  useEvery(REFRESH_MS, roster.reload, !!live);

  /** What a child shows before anyone touches them: what's saved, what the strap says, or present. */
  const start = (s: any): Status => s.status ?? (fromStrap(s) ? (s.live.inRoom ? 'PRESENT' : 'ABSENT') : 'PRESENT');
  const shown = (s: any): Status => chosen[s.id] ?? start(s);

  const toSave = useMemo(() => {
    if (!roster.data) return [];
    return roster.data.students.filter((s: any) => {
      if (s.status) return shown(s) !== s.status; // already saved: only changes
      if (fromStrap(s)) return chosen[s.id] !== undefined && chosen[s.id] !== start(s); // the strap decides the rest
      return true; // nothing saved and no strap: the list is the register
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster.data, chosen, live]);

  /** With straps a manual mark needs a reason; nobody has to pick one. Stored as written. */
  const reasonFor = (s: any, status: Status) => {
    if (!auto) return undefined;
    if (s.status) return 'Correction';
    if (!fromStrap(s)) return 'Gateway not working';
    if (status === 'ABSENT') return 'Correction';
    return s.live?.hasStrap === false ? 'No strap' : 'Strap forgotten';
  };

  async function submit() {
    const n = toSave.length;
    const ok = await save.run(async () => {
      const marks = toSave.map((s: any) => {
        const status = shown(s);
        const reason = reasonFor(s, status);
        return { studentId: s.id, status, ...(reason ? { reason } : {}) };
      });
      roster.setData(await put(`/attendance/classes/${classId}/periods/${periodId}`, { date, marks }));
      setChosen({});
    });
    if (ok) toast(t.att.savedToast(n));
  }

  if (!roster.data) return <ErrorNote error={roster.error} />;
  const r = roster.data;
  // Children the strap doesn't hear come first, so the teacher sees them at once,
  // until the teacher touches a row; from then on the order stays put.
  const sorted: any[] = live ? [...r.students].sort((a: any, b: any) => Number(start(a) !== 'ABSENT') - Number(start(b) !== 'ABSENT')) : r.students;
  const touched = touchedOnce.current || Object.keys(chosen).length > 0;
  const kept = order.current;
  const students: any[] = touched && kept.length
    ? [...r.students].sort((a: any, b: any) => (kept.indexOf(a.id) + 1 || Infinity) - (kept.indexOf(b.id) + 1 || Infinity))
    : sorted;
  order.current = students.map((s: any) => s.id);
  const count = (st: Status) => r.students.filter((s: any) => shown(s) === st).length;
  const summary = [
    t.att.countPresent(count('PRESENT')),
    count('LATE') ? t.att.countLate(count('LATE')) : null,
    count('ABSENT') ? t.att.countAbsent(count('ABSENT')) : null,
    count('EXCUSED') ? t.att.countExcused(count('EXCUSED')) : null,
  ].filter(Boolean).join(' · ');
  const allSaved = r.students.length > 0 && r.students.every((s: any) => s.status);
  const summarySub = live ? t.att.subStraps : auto && r.lessonState === 'now' ? t.att.subGatewayDown : allSaved ? t.att.subSaved : t.att.subNoStraps;
  const title = [r.class.name, r.lesson?.subject, r.lesson?.room?.name].filter(Boolean).join(' · ');
  const when = `${isToday ? '' : `${date} · `}${t.att.period(r.period.number)} · ${r.period.startTime}–${r.period.endTime}`;

  return (
    <>
      <header className="lesson-head">
        {crumb && (
          <nav className="crumb">
            <Link href={`/attendance?date=${date}`}>{t.nav.take}</Link>
            <span>/</span>
            <b>{x(`${r.class.name} · ${r.lesson?.subject ?? ''} · ${t.att.period(r.period.number)}`)}</b>
          </nav>
        )}
        <div className="lesson-title">
          <div className="head-text">
            <span className="when">{x(when)}</span>
            <h1>{x(title)}</h1>
          </div>
          {r.canEdit && (
            <button className="save" type="button" onClick={submit} disabled={!toSave.length || save.busy} aria-live="polite">
              {save.busy ? t.common.saving : toSave.length ? t.att.saveN(toSave.length) : `✓ ${t.att.saved}`}
            </button>
          )}
        </div>
        {isToday && periods.data && <DayRuler periods={periods.data} current={r.period.id} />}
      </header>

      {!r.canEdit && <Note tone="warn">{date < todayCairo() ? t.att.readOnlyPast : r.readOnlyReason}</Note>}

      <section className="summary">
        <div className="summary-line">
          <b>{summary}</b>
          {live && <LiveStamp at={roster.loadedAt} />}
        </div>
        {r.canEdit && <p>{summarySub}</p>}
      </section>

      <ErrorNote error={save.error} />
      <ul className="roster">
        {students.map((s: any) => {
          const now = shown(s);
          const changed = chosen[s.id] !== undefined && chosen[s.id] !== start(s);
          const l = s.live;
          let state: { cls: string; text: string } | null = null;
          if (live && l) {
            if (l.inRoom) state = { cls: 'in', text: t.att.inRoom };
            else if (!l.hasStrap) state = { cls: 'nostrap', text: t.att.noStrap };
            else if (l.lastPlace) {
              const told = l.parentsToldAt ? ` · ${t.att.parentsTold(timeCairo(l.parentsToldAt))}` : '';
              state = { cls: 'out', text: `${t.att.notInRoom} · ${t.att.lastHeard(l.lastPlace, timeCairo(l.lastHeardAt))}${told}` };
            } else state = { cls: 'notheard', text: t.att.strapNotHeard };
          }
          const savedBy = !changed && s.status && s.source === 'MANUAL' && s.markedBy ? t.att.savedBy(staff({ name: s.markedBy, honorific: s.markedByHonorific })) : null;
          return (
            <li key={s.id} className={now === 'ABSENT' ? 'absent' : changed ? 'changed' : undefined}>
              <div className="who">
                <b>{s.name}</b>
                {state && <span className={`state ${state.cls}`}><i aria-hidden="true" />{x(state.text)}</span>}
                {!changed && s.status === 'ABSENT' && (
                  <Tag tone={ABSENCE_TONE[s.excuse ? (s.excuse.status === 'REJECTED' ? 'REJECTED' : 'PENDING') : 'NO_EXCUSE']}>
                    {t.absences.status[s.excuse ? (s.excuse.status === 'REJECTED' ? 'REJECTED' : 'PENDING') : 'NO_EXCUSE']}
                  </Tag>
                )}
                {!changed && s.status === 'EXCUSED' && s.excuse?.status === 'APPROVED' && <Tag tone={EXCUSE_TONE.APPROVED}>{t.excuses.reason[s.excuse.reason] ?? s.excuse.reason}</Tag>}
                {changed && <span className="unsaved">{t.att.unsaved}</span>}
                {savedBy && <span className="saved-by">{savedBy}</span>}
              </div>
              <div className="marks" role="radiogroup" aria-label={s.name}>
                {CHOICES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    className={`mark s-${c}`}
                    aria-checked={now === c}
                    disabled={!r.canEdit}
                    onClick={() => { touchedOnce.current = true; setChosen({ ...chosen, [s.id]: c }); }}
                  >
                    <span className="glyph" aria-hidden="true">{STATUS_GLYPH[c]}</span>
                    {t.status[c]}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The school day as a strip: lessons so far, this one (with a line at now), and those to come. */
function DayRuler({ periods, current }: { periods: any[]; current: string }) {
  const sorted = [...periods].sort((a, b) => a.number - b.number);
  const now = minutes(nowCairo());
  const segs: { key: string; flex: number; cls: string; label: string; tick?: number }[] = [];
  sorted.forEach((p, i) => {
    const s = minutes(p.startTime);
    const e = minutes(p.endTime);
    const prevEnd = i ? minutes(sorted[i - 1].endTime) : s;
    if (s > prevEnd) segs.push({ key: `b${i}`, flex: s - prevEnd, cls: 'break', label: '' });
    const cls = p.id === current ? 'now' : e <= now ? 'done' : 'next';
    const tick = p.id === current && now >= s && now < e ? ((now - s) / (e - s)) * 100 : undefined;
    segs.push({ key: p.id, flex: Math.max(e - s, 1), cls, label: p.startTime, tick });
  });
  return (
    <div className="ruler" aria-hidden="true">
      {segs.map((g) => (
        <div key={g.key} className={g.cls} style={{ flex: g.flex }}>
          <div className="bar">{g.tick !== undefined && <div className="tick" style={{ insetInlineStart: `${g.tick}%` }} />}</div>
          <span>{g.label}</span>
        </div>
      ))}
    </div>
  );
}
