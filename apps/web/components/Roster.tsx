'use client';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { put, timeCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { Badge, Card, ErrorNote, PageHead, STATUS_LABEL, STATUS_TONE, toast } from './ui';

const CHOICES = [
  { status: 'PRESENT', short: 'P' },
  { status: 'LATE', short: 'L' },
  { status: 'ABSENT', short: 'A' },
  { status: 'EXCUSED', short: 'E' },
] as const;

const REASONS = ['Strap forgotten', 'Strap not working', 'Gateway offline', 'Correction'];
const LIVE_REFRESH_MS = 15_000;

interface Draft {
  status: string | null;
  reason: string;
  dirty: boolean;
}

/** What the strap says right now, before the lesson is decided at its end. */
function liveStatus(s: any, lessonState: string | null) {
  if (lessonState !== 'now' || s.status || !s.live) return null;
  return s.live.inRoom ? 'PRESENT' : 'ABSENT';
}

function LiveCell({ s }: { s: any }) {
  const l = s.live;
  if (!l) return <span className="muted">—</span>;
  if (l.inRoom) return <Badge tone="ok">In the room</Badge>;
  if (!l.hasStrap) return <Badge>No strap</Badge>;
  if (l.lastPlace) {
    return (
      <div className="stack" style={{ gap: 2 }}>
        <span><Badge tone="warn">Not in the room</Badge></span>
        <span className="muted small">Last heard: {l.lastPlace}, {timeCairo(l.lastHeardAt)}</span>
        {l.parentsToldAt && <span className="muted small">Parents told at {timeCairo(l.parentsToldAt)}</span>}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span><Badge tone="alert">Not heard today</Badge></span>
      <span className="muted small">Strap forgotten, or not at school</span>
    </div>
  );
}

/**
 * The class list for one lesson. While the lesson is on and attendance is
 * automatic, each child shows what the room's gateway hears now; the teacher
 * only touches the ones the strap got wrong (a forgotten strap).
 */
export function Roster({ classId, periodId, date, eyebrow, empty }: { classId: string; periodId: string; date: string; eyebrow?: string; empty?: ReactNode }) {
  const roster = useApi(`/attendance/classes/${classId}/periods/${periodId}?date=${date}`);
  const save = useAction();
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const lessonState: string | null = roster.data?.lessonState ?? null;

  // Keep the list live during the lesson, without losing unsaved changes.
  useEffect(() => {
    if (lessonState !== 'now') return;
    const t = setInterval(() => void roster.reload(), LIVE_REFRESH_MS);
    return () => clearInterval(t);
  }, [lessonState, roster.reload]);

  useEffect(() => {
    if (!roster.data) return;
    setDraft((prev) =>
      Object.fromEntries(
        roster.data.students.map((s: any) => [
          s.id,
          prev[s.id]?.dirty ? prev[s.id] : { status: s.status, reason: s.source === 'MANUAL' ? s.reason ?? '' : '', dirty: false },
        ]),
      ),
    );
  }, [roster.data]);

  const automatic = roster.data?.mode === 'AUTOMATIC';
  const shown = (s: any) => draft[s.id]?.status ?? liveStatus(s, lessonState);
  const changed = useMemo(() => {
    if (!roster.data) return [];
    return roster.data.students.filter((s: any) => {
      const d = draft[s.id];
      if (!d?.dirty || !d.status) return false;
      return d.status !== (s.status ?? liveStatus(s, lessonState)) || (s.source === 'MANUAL' && d.reason !== (s.reason ?? ''));
    });
  }, [draft, roster.data, lessonState]);
  const missingReason = automatic && changed.some((s: any) => !draft[s.id].reason.trim());

  const choose = (s: any, status: string) => {
    const d = draft[s.id] ?? { status: null, reason: '', dirty: false };
    // With straps, a change is almost always a forgotten strap: say so for the teacher.
    const reason = automatic && !d.reason ? (s.live && !s.live.hasStrap ? 'Strap not working' : 'Strap forgotten') : d.reason;
    setDraft({ ...draft, [s.id]: { status, reason, dirty: true } });
  };

  const setAll = (status: string) =>
    setDraft((d) => Object.fromEntries(Object.entries(d).map(([id, v]) => [id, v.status ? v : { ...v, status, dirty: true }])));

  async function submit() {
    const ok = await save.run(async () => {
      const data = await put(`/attendance/classes/${classId}/periods/${periodId}`, {
        date,
        marks: changed.map((s: any) => ({ studentId: s.id, status: draft[s.id].status, ...(draft[s.id].reason.trim() ? { reason: draft[s.id].reason.trim() } : {}) })),
      });
      setDraft({});
      roster.setData(data);
    });
    if (ok) toast(`Saved ${changed.length} mark${changed.length === 1 ? '' : 's'}.`);
  }

  if (!roster.data) return roster.error ? <ErrorNote error={roster.error} /> : <>{empty}</>;
  const r = roster.data;
  const live = automatic && lessonState === 'now';
  const unmarked = r.students.filter((s: any) => !draft[s.id]?.status).length;
  // During the lesson, the children the strap can't place come first.
  const students = live ? [...r.students].sort((a: any, b: any) => Number(!!a.live?.inRoom) - Number(!!b.live?.inRoom)) : r.students;
  const inRoom = r.students.filter((s: any) => s.live?.inRoom).length;

  return (
    <>
      <PageHead
        eyebrow={eyebrow ?? `${date} · Period ${r.period.number} · ${r.period.startTime}–${r.period.endTime}`}
        title={`${r.class.name}${r.lesson ? ` · ${r.lesson.subject}` : ''}`}
        sub={r.lesson ? `${r.lesson.room.name}${r.lesson.teacher ? ` · ${r.lesson.teacher.name}` : ''}` : 'No lesson in the timetable for this period.'}
        actions={
          r.canEdit && (
            <>
              {!live && <button className="btn" type="button" onClick={() => setAll('PRESENT')} disabled={!unmarked}>Mark the rest present</button>}
              <button className="btn primary" type="button" onClick={submit} disabled={!changed.length || save.busy || missingReason}>
                {save.busy ? 'Saving…' : changed.length ? `Save ${changed.length}` : 'Saved'}
              </button>
            </>
          )
        }
      />
      {!r.canEdit && <div className="notice warn">{r.readOnlyReason}</div>}
      {live && (
        <div className="notice">
          <b>{inRoom} of {r.students.length}</b> are in the room now (from the straps, updated every 15 seconds). If a child in front of you shows as not in the room, their strap is
          missing: tap <b>P</b> and save. Parents of a child who came to school but isn’t in the room are told 10 minutes after the lesson starts.
        </div>
      )}
      {automatic && !live && r.canEdit && <div className="notice">Automatic attendance is on. Only change a student when their strap didn’t work, and choose a reason.</div>}
      <ErrorNote error={save.error} />
      <Card pad={false}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Student</th>{live && <th>Now</th>}<th>Status</th><th>Recorded</th>{automatic && <th>Reason</th>}</tr>
            </thead>
            <tbody>
              {students.map((s: any) => {
                const d = draft[s.id] ?? { status: null, reason: '', dirty: false };
                const current = shown(s);
                return (
                  <tr key={s.id}>
                    <td>
                      <div>{s.name}</div>
                      <div className="muted small">{s.code}</div>
                    </td>
                    {live && <td><LiveCell s={s} /></td>}
                    <td>
                      <div className="seg" role="group" aria-label={`Status for ${s.name}`}>
                        {CHOICES.map((c) => (
                          <button
                            key={c.status}
                            type="button"
                            className={`s-${c.status}`}
                            aria-pressed={current === c.status}
                            title={STATUS_LABEL[c.status]}
                            disabled={!r.canEdit}
                            onClick={() => choose(s, c.status)}
                          >
                            {c.short}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="small">
                      {s.status ? (
                        <div className="stack" style={{ gap: 2 }}>
                          <span><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></span>
                          <span className="muted">
                            {s.source === 'AUTOMATIC' ? `Strap · first seen ${timeCairo(s.firstSeenAt)}` : `By ${s.markedBy ?? 'staff'}${s.reason ? ` · ${s.reason}` : ''}`}
                          </span>
                        </div>
                      ) : live ? (
                        <span className="muted">Decided when the lesson ends</span>
                      ) : (
                        <span className="muted">Not marked</span>
                      )}
                    </td>
                    {automatic && (
                      <td>
                        <select
                          className="input"
                          aria-label={`Reason for ${s.name}`}
                          value={d.reason}
                          disabled={!r.canEdit}
                          onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, reason: e.target.value, dirty: true } })}
                        >
                          <option value="">—</option>
                          {REASONS.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {missingReason && <div className="notice warn">Choose a reason for every student you changed.</div>}
    </>
  );
}
