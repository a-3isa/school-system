'use client';
import { useEffect, useMemo, useState } from 'react';
import { put, timeCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { ErrorNote, PageHead, toast } from './ui';

const CHOICES = [
  { status: 'PRESENT', label: 'Present' },
  { status: 'LATE', label: 'Late' },
  { status: 'ABSENT', label: 'Absent' },
] as const;

const REFRESH_MS = 15_000;

/**
 * The teacher's one screen: the class in front of them. It is the same with
 * or without straps; only where the starting values come from differs.
 * - With straps: each child starts as the strap says (in the room = present).
 *   The teacher only changes a child whose strap was forgotten, and saves.
 * - Without straps: everyone starts as present; the teacher taps the absent
 *   ones and saves.
 */
export function ClassNow({ classId, periodId, date, eyebrow }: { classId: string; periodId: string; date: string; eyebrow: string }) {
  const roster = useApi(`/attendance/classes/${classId}/periods/${periodId}?date=${date}`);
  const save = useAction();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const straps = roster.data?.mode === 'AUTOMATIC';

  // With straps the list follows the room live; the teacher's taps are kept.
  useEffect(() => {
    if (!straps) return;
    const t = setInterval(() => void roster.reload(), REFRESH_MS);
    return () => clearInterval(t);
  }, [straps, roster.reload]);

  /** What a child shows before the teacher touches them. */
  const start = (s: any): string => s.status ?? (straps ? (s.live?.inRoom ? 'PRESENT' : 'ABSENT') : 'PRESENT');
  const shown = (s: any) => chosen[s.id] ?? start(s);

  const toSave = useMemo(() => {
    if (!roster.data) return [];
    return roster.data.students.filter((s: any) =>
      // With straps only the teacher's changes are saved (the rest is decided from the straps);
      // without straps the whole list is the attendance.
      straps ? chosen[s.id] !== undefined && chosen[s.id] !== start(s) : shown(s) !== s.status,
    );
  }, [roster.data, chosen, straps]);

  async function submit() {
    const ok = await save.run(async () => {
      const marks = toSave.map((s: any) => {
        const status = shown(s);
        // With straps a change needs a reason; the teacher doesn't have to pick one.
        const reason = !straps ? undefined : status === 'ABSENT' ? 'Correction by the teacher' : s.live?.hasStrap === false ? 'No strap' : 'Strap forgotten';
        return { studentId: s.id, status, ...(reason ? { reason } : {}) };
      });
      roster.setData(await put(`/attendance/classes/${classId}/periods/${periodId}`, { date, marks }));
      setChosen({});
    });
    if (ok) toast('Saved.');
  }

  if (!roster.data) return <ErrorNote error={roster.error} />;
  const r = roster.data;
  const students = straps ? [...r.students].sort((a: any, b: any) => Number(shown(a) === 'PRESENT') - Number(shown(b) === 'PRESENT')) : r.students;
  const absent = r.students.filter((s: any) => shown(s) === 'ABSENT').length;

  return (
    <>
      <PageHead
        eyebrow={eyebrow}
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
        <span className="muted">{straps ? ' · from the straps, updated every 15 seconds. Tap Present for a child who forgot their strap.' : ' · everyone starts as present. Tap the absent ones, then Save.'}</span>
      </div>
      <ErrorNote error={save.error} />
      <ul className="class-list">
        {students.map((s: any) => {
          const now = shown(s);
          const l = s.live;
          const note = s.status && s.source === 'MANUAL' && s.markedBy
            ? `Saved by ${s.markedBy}`
            : straps && l
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
