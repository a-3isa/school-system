'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { put, timeCairo, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { Badge, Card, ErrorNote, PageHead, STATUS_LABEL, STATUS_TONE, toast } from '@/components/ui';

const CHOICES = [
  { status: 'PRESENT', short: 'P' },
  { status: 'LATE', short: 'L' },
  { status: 'ABSENT', short: 'A' },
  { status: 'EXCUSED', short: 'E' },
] as const;

const REASONS = ['Strap forgotten', 'Strap not working', 'Gateway offline', 'Correction'];

interface Draft {
  status: string | null;
  reason: string;
}

function Roster() {
  const { classId, periodId } = useParams<{ classId: string; periodId: string }>();
  const date = useSearchParams().get('date') ?? todayCairo();
  const roster = useApi(`/attendance/classes/${classId}/periods/${periodId}?date=${date}`);
  const save = useAction();
  const [draft, setDraft] = useState<Record<string, Draft>>({});

  useEffect(() => {
    if (!roster.data) return;
    setDraft(Object.fromEntries(roster.data.students.map((s: any) => [s.id, { status: s.status, reason: s.source === 'MANUAL' ? s.reason ?? '' : '' }])));
  }, [roster.data]);

  const automatic = roster.data?.mode === 'AUTOMATIC';
  const changed = useMemo(() => {
    if (!roster.data) return [];
    return roster.data.students.filter((s: any) => draft[s.id] && (draft[s.id].status !== s.status || (s.source === 'MANUAL' && (draft[s.id].reason || '') !== (s.reason ?? ''))) && draft[s.id].status);
  }, [draft, roster.data]);
  const missingReason = automatic && changed.some((s: any) => !draft[s.id].reason.trim());

  const setAll = (status: string) =>
    setDraft((d) => Object.fromEntries(Object.entries(d).map(([id, v]) => [id, v.status ? v : { ...v, status }])));

  async function submit() {
    const ok = await save.run(async () => {
      const data = await put(`/attendance/classes/${classId}/periods/${periodId}`, {
        date,
        marks: changed.map((s: any) => ({ studentId: s.id, status: draft[s.id].status, ...(draft[s.id].reason.trim() ? { reason: draft[s.id].reason.trim() } : {}) })),
      });
      roster.setData(data);
    });
    if (ok) toast(`Saved ${changed.length} mark${changed.length === 1 ? '' : 's'}.`);
  }

  if (!roster.data) return <ErrorNote error={roster.error} />;
  const r = roster.data;
  const unmarked = r.students.filter((s: any) => !draft[s.id]?.status).length;

  return (
    <>
      <PageHead
        eyebrow={`${date} · Period ${r.period.number} · ${r.period.startTime}–${r.period.endTime}`}
        title={`${r.class.name}${r.lesson ? ` · ${r.lesson.subject}` : ''}`}
        sub={r.lesson ? `${r.lesson.room.name}${r.lesson.teacher ? ` · ${r.lesson.teacher.name}` : ''}` : 'No lesson in the timetable for this period.'}
        actions={
          r.canEdit && (
            <>
              <button className="btn" type="button" onClick={() => setAll('PRESENT')} disabled={!unmarked}>Mark the rest present</button>
              <button className="btn primary" type="button" onClick={submit} disabled={!changed.length || save.busy || missingReason}>
                {save.busy ? 'Saving…' : changed.length ? `Save ${changed.length}` : 'Saved'}
              </button>
            </>
          )
        }
      />
      {!r.canEdit && <div className="notice warn">{r.readOnlyReason}</div>}
      {automatic && r.canEdit && <div className="notice">Automatic attendance is on. Only change a student when their strap didn’t work, and choose a reason.</div>}
      <ErrorNote error={save.error} />
      <Card pad={false}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Student</th><th>Status</th><th>Recorded</th>{automatic && <th>Reason</th>}</tr>
            </thead>
            <tbody>
              {r.students.map((s: any) => {
                const d = draft[s.id] ?? { status: null, reason: '' };
                return (
                  <tr key={s.id}>
                    <td>
                      <div>{s.name}</div>
                      <div className="muted small">{s.code}</div>
                    </td>
                    <td>
                      <div className="seg" role="group" aria-label={`Status for ${s.name}`}>
                        {CHOICES.map((c) => (
                          <button
                            key={c.status}
                            type="button"
                            className={`s-${c.status}`}
                            aria-pressed={d.status === c.status}
                            title={STATUS_LABEL[c.status]}
                            disabled={!r.canEdit}
                            onClick={() => setDraft({ ...draft, [s.id]: { ...d, status: c.status } })}
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
                          onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, reason: e.target.value } })}
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

export default function RosterPage() {
  return (
    <Suspense>
      <Roster />
    </Suspense>
  );
}
