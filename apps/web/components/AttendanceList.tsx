'use client';
import { useEffect, useMemo, useState } from 'react';
import { put, timeCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { ErrorNote, PageHead, toast } from './ui';

const CHOICES = [
  { status: 'PRESENT', label: 'Present' },
  { status: 'LATE', label: 'Late' },
  { status: 'ABSENT', label: 'Absent' },
  { status: 'EXCUSED', label: 'Excused' },
] as const;

const REFRESH_MS = 15_000;

/**
 * The one attendance screen, for teachers and admins alike, with or without
 * straps; only where the starting values come from differs.
 * - With straps: each child starts as the strap says (in the room = present,
 *   or as the lesson was decided). Change a child the strap got wrong (a
 *   forgotten strap) and save.
 * - Without straps: everyone starts as present; tap the absent ones and save.
 */
export function AttendanceList({ classId, periodId, date, eyebrow }: { classId: string; periodId: string; date: string; eyebrow?: string }) {
  const roster = useApi(`/attendance/classes/${classId}/periods/${periodId}?date=${date}`);
  const save = useAction();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const auto = roster.data?.mode === 'AUTOMATIC';
  // The straps say who is here only during the lesson, while the room's gateway is working.
  const live = auto && roster.data?.lessonState === 'now' && roster.data?.gatewayWorking;
  const fromStrap = (s: any) => !s.status && live && !!s.live;

  // With straps the list follows the room live; the teacher's taps are kept.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void roster.reload(), REFRESH_MS);
    return () => clearInterval(t);
  }, [live, roster.reload]);

  /** What a child shows before anyone touches them: what's saved, what the strap says, or present. */
  const start = (s: any): string => s.status ?? (fromStrap(s) ? (s.live.inRoom ? 'PRESENT' : 'ABSENT') : 'PRESENT');
  const shown = (s: any) => chosen[s.id] ?? start(s);

  const toSave = useMemo(() => {
    if (!roster.data) return [];
    return roster.data.students.filter((s: any) => {
      if (s.status) return shown(s) !== s.status; // already saved: only changes
      if (fromStrap(s)) return chosen[s.id] !== undefined && chosen[s.id] !== start(s); // the strap decides the rest
      return true; // nothing saved and no strap: the list is the register
    });
  }, [roster.data, chosen, live]);

  /** With straps a manual mark needs a reason; nobody has to pick one. */
  const reasonFor = (s: any, status: string) => {
    if (!auto) return undefined;
    if (s.status) return 'Correction';
    if (!fromStrap(s)) return 'Gateway not working';
    if (status === 'ABSENT') return 'Correction';
    return s.live?.hasStrap === false ? 'No strap' : 'Strap forgotten';
  };

  async function submit() {
    const ok = await save.run(async () => {
      const marks = toSave.map((s: any) => {
        const status = shown(s);
        const reason = reasonFor(s, status);
        return { studentId: s.id, status, ...(reason ? { reason } : {}) };
      });
      roster.setData(await put(`/attendance/classes/${classId}/periods/${periodId}`, { date, marks }));
      setChosen({});
    });
    if (ok) toast('Saved.');
  }

  if (!roster.data) return <ErrorNote error={roster.error} />;
  const r = roster.data;
  const students = live ? [...r.students].sort((a: any, b: any) => Number(shown(a) === 'PRESENT') - Number(shown(b) === 'PRESENT')) : r.students;
  const absent = r.students.filter((s: any) => shown(s) === 'ABSENT').length;

  return (
    <>
      <PageHead
        eyebrow={eyebrow ?? `${date} · Period ${r.period.number} · ${r.period.startTime}–${r.period.endTime}`}
        title={`${r.class.name}${r.lesson ? ` · ${r.lesson.subject}` : ''}`}
        sub={r.lesson ? r.lesson.room.name : undefined}
        actions={
          r.canEdit && (
            <button className="btn primary big" type="button" onClick={submit} disabled={!toSave.length || save.busy}>
              {save.busy ? 'Saving…' : toSave.length ? `Save (${toSave.length})` : 'Saved'}
            </button>
          )
        }
      />
      {!r.canEdit && <div className="notice warn">{r.readOnlyReason}</div>}
      <div className="class-summary">
        <b>{r.students.length - absent}</b> present · <b>{absent}</b> absent
        <span className="muted">{live ? ' · from the straps, updated every 15 seconds. Tap Present for a child who forgot their strap, then Save.' : ' · tap anyone who isn’t present, then Save.'}</span>
      </div>
      <ErrorNote error={save.error} />
      <ul className="class-list">
        {students.map((s: any) => {
          const now = shown(s);
          const l = s.live;
          const note = s.status && s.source === 'MANUAL' && s.markedBy
            ? `Saved by ${s.markedBy}`
            : live && l
              ? l.inRoom
                ? 'In the room'
                : !l.hasStrap
                  ? 'No strap'
                  : l.lastPlace
                    ? `Not in the room · last heard ${l.lastPlace}, ${timeCairo(l.lastHeardAt)}${l.parentsToldAt ? ` · parents told ${timeCairo(l.parentsToldAt)}` : ''}`
                    : 'Strap not heard today'
              : null;
          return (
            <li key={s.id} className={`class-row s-${now}`}>
              <div>
                <div className="class-name">{s.name}</div>
                {note && <div className="muted small">{note}</div>}
              </div>
              <div className="seg big" role="group" aria-label={`Attendance for ${s.name}`}>
                {CHOICES.map((c) => (
                  <button
                    key={c.status}
                    type="button"
                    className={`s-${c.status}`}
                    aria-pressed={now === c.status}
                    disabled={!r.canEdit}
                    onClick={() => setChosen({ ...chosen, [s.id]: c.status })}
                  >
                    {c.label}
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
