'use client';
import { useState } from 'react';
import { post, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { Badge, Card, Empty, ErrorNote, Field, PageHead, toast, Tone } from '@/components/ui';

const TYPE: Record<string, { label: string; tone: Tone }> = {
  NOT_IN_CLASS: { label: 'Not in class', tone: 'warn' },
  LEFT_LESSON: { label: 'Left the lesson', tone: 'warn' },
  LEFT_EARLY: { label: 'Left school early', tone: 'alert' },
  STRAP_NOT_SEEN: { label: 'Strap not seen', tone: 'info' },
  LOW_BATTERY: { label: 'Low battery', tone: 'info' },
  GATEWAY_OFFLINE: { label: 'Mark manually', tone: 'alert' },
};

export default function ExceptionsPage() {
  const [date, setDate] = useState(todayCairo());
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | ''>('OPEN');
  const list = useApi<any[]>(`/attendance/exceptions?date=${date}${status ? `&status=${status}` : ''}`);
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function resolve(id: string) {
    if (await act.run(() => post(`/attendance/exceptions/${id}/resolve`, { note: notes[id] || undefined }))) {
      toast('Resolved.');
      await list.reload();
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Attendance"
        title="Exceptions"
        sub="Things the straps and gateways couldn’t settle on their own. Staff can resolve today’s; earlier days need an admin."
        actions={
          <div className="form-row">
            <Field label="Day" id="day">
              <input id="day" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Show" id="status">
              <select id="status" className="input" value={status} onChange={(e) => setStatus(e.target.value as any)}>
                <option value="OPEN">Open</option>
                <option value="RESOLVED">Resolved</option>
                <option value="">All</option>
              </select>
            </Field>
          </div>
        }
      />
      <ErrorNote error={list.error ?? act.error} />
      <Card pad={false}>
        {list.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Type</th><th>What happened</th><th>Student</th><th>Note</th><th /></tr>
              </thead>
              <tbody>
                {list.data.map((e) => (
                  <tr key={e.id}>
                    <td><Badge tone={TYPE[e.type]?.tone}>{TYPE[e.type]?.label ?? e.type}</Badge></td>
                    <td>{e.message}</td>
                    <td>{e.student ? `${e.student.firstName} ${e.student.lastName}${e.student.class ? ` · ${e.student.class.name}` : ''}` : '—'}</td>
                    <td>
                      {e.status === 'OPEN' ? (
                        <input
                          className="input"
                          aria-label="Note"
                          placeholder="e.g. was at the clinic"
                          value={notes[e.id] ?? ''}
                          onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })}
                        />
                      ) : (
                        <span className="muted">{e.note ?? '—'}</span>
                      )}
                    </td>
                    <td>{e.status === 'OPEN' ? <button className="btn small" onClick={() => resolve(e.id)} disabled={act.busy}>Resolve</button> : <Badge tone="ok">Resolved</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{list.loading ? 'Loading…' : 'Nothing here.'}</Empty>
        )}
      </Card>
    </>
  );
}
