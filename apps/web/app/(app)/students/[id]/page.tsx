'use client';
import { FormEvent, useState } from 'react';
import { useParams } from 'next/navigation';
import { del, patch, post, timeCairo, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Badge, Card, Empty, ErrorNote, Field, PageHead, STATUS_LABEL, STATUS_TONE, toast } from '@/components/ui';

const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const student = useApi(`/students/${id}`);
  const today = todayCairo();
  const history = useApi<any[]>(me.modules.includes('attendance') ? `/attendance/students/${id}?from=${shift(today, -13)}&to=${today}` : null);
  const visits = useApi<any[]>(me.modules.includes('attendance') ? `/locations/students/${id}?date=${today}` : null);
  const act = useAction();
  const [form, setForm] = useState({ relation: 'MOTHER', name: '', phone: '', email: '', password: '' });

  async function addParent(e: FormEvent) {
    e.preventDefault();
    const body = { relation: form.relation, name: form.name, phone: form.phone, ...(form.email ? { email: form.email } : {}), ...(form.password ? { password: form.password } : {}) };
    if (await act.run(async () => student.setData(await post(`/students/${id}/guardians`, body)))) {
      toast('Parent added.');
      setForm({ relation: 'FATHER', name: '', phone: '', email: '', password: '' });
    }
  }

  const restrict = (parentId: string, restricted: boolean) =>
    act.run(async () => student.setData(await patch(`/students/${id}/guardians/${parentId}`, { restricted })));
  const remove = (parentId: string) => act.run(async () => student.setData(await del(`/students/${id}/guardians/${parentId}`)));

  if (!student.data) return <ErrorNote error={student.error} />;
  const s = student.data;

  return (
    <>
      <PageHead eyebrow={`Student · ${s.code}`} title={`${s.firstName} ${s.lastName}`} sub={s.class ? `Class ${s.class.name}` : 'Not in a class yet'} />
      <ErrorNote error={act.error} />
      <div className="grid g2">
        <Card title="Parents" action={<span className="muted small">{s.guardians.length} of 2</span>}>
          {s.guardians.length ? (
            s.guardians.map((g: any) => (
              <div key={g.userId} className="row between">
                <div>
                  <div>{g.user.name} <span className="muted small">· {g.relation === 'MOTHER' ? 'Mother' : 'Father'}</span></div>
                  <div className="muted small">{g.user.phone}{g.user.email ? ` · ${g.user.email}` : ''}</div>
                </div>
                {isAdmin && (
                  <div className="row">
                    {g.restricted ? <Badge tone="warn">Restricted</Badge> : null}
                    <button className="btn small" onClick={() => restrict(g.userId, !g.restricted)}>{g.restricted ? 'Allow' : 'Restrict'}</button>
                    <button className="btn small danger" onClick={() => remove(g.userId)}>Remove</button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <span className="muted">No parents linked yet.</span>
          )}
          {isAdmin && s.guardians.length < 2 && (
            <form className="stack" onSubmit={addParent} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div className="form-row">
                <Field label="Relation" id="rel">
                  <select id="rel" className="input" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>
                    <option value="MOTHER">Mother</option>
                    <option value="FATHER">Father</option>
                  </select>
                </Field>
                <Field label="Name" id="pn"><input id="pn" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              </div>
              <div className="form-row">
                <Field label="Mobile (WhatsApp)" id="pp"><input id="pp" className="input" required placeholder="+2010…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field label="Email (optional)" id="pe"><input id="pe" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              </div>
              <Field label="Temporary password (optional)" id="pw"><input id="pw" className="input" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
              <button className="btn primary" type="submit" disabled={act.busy}>Add parent</button>
              <span className="muted small">A parent who already has a child here is linked to the same account by phone number.</span>
            </form>
          )}
        </Card>
        {visits.data && (
          <Card title="Where today" action={<span className="muted small">from the strap</span>}>
            {visits.data.length ? (
              <ul className="visits">
                {visits.data.map((v, i) => (
                  <li key={i}>
                    <span className="num">{timeCairo(v.from)}–{timeCairo(v.to)}</span>
                    <span>{v.place?.name ?? 'Unknown place'}</span>
                    {v.place?.kind === 'GATE' && <Badge>Gate</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted small">The strap hasn’t been heard today.</span>
            )}
          </Card>
        )}
        <Card title="Attendance · last two weeks" pad={false}>
          {history.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Day</th><th>Period</th><th>Status</th><th>How</th></tr>
                </thead>
                <tbody>
                  {history.data.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{r.date.slice(0, 10)}</td>
                      <td className="num">{r.period.number}</td>
                      <td><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                      <td className="muted small">{r.source === 'AUTOMATIC' ? 'Strap' : r.reason ?? 'Manual'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No attendance recorded yet.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
