'use client';
import { FormEvent, useState } from 'react';
import { post, put } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { Badge, Card, Empty, ErrorNote, Field, PageHead, Switch, toast } from '@/components/ui';

const PLANS = ['ESSENTIALS', 'SMART', 'COMPLETE'];
const planName = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();

export default function OwnerPage() {
  const schools = useApi<any[]>('/owner/schools');
  const [selected, setSelected] = useState<string | null>(null);
  const modules = useApi<any[]>(selected ? `/owner/schools/${selected}/modules` : null);
  const act = useAction();
  const [form, setForm] = useState({ name: '', nameAr: '', plan: 'ESSENTIALS', adminName: '', adminEmail: '', adminPassword: '' });

  async function create(e: FormEvent) {
    e.preventDefault();
    const body = { name: form.name, nameAr: form.nameAr || undefined, plan: form.plan, admin: { name: form.adminName, email: form.adminEmail, password: form.adminPassword } };
    if (await act.run(() => post('/owner/schools', body))) {
      toast(`${form.name} created. ${form.adminName} can sign in now.`);
      setForm({ name: '', nameAr: '', plan: 'ESSENTIALS', adminName: '', adminEmail: '', adminPassword: '' });
      await schools.reload();
    }
  }

  const toggle = async (key: string, enabled: boolean) => {
    const ok = await act.run(async () => {
      const res = await put(`/owner/schools/${selected}/modules/${key}`, { enabled });
      modules.setData(res.modules);
      if (res.alsoEnabled?.length) toast(`Also switched on: ${res.alsoEnabled.join(', ')}.`);
    });
    if (ok) await schools.reload();
  };

  const setPlan = async (plan: string) => {
    if (await act.run(async () => modules.setData(await put(`/owner/schools/${selected}/plan`, { plan })))) {
      toast(`Plan changed to ${planName(plan)}.`);
      await schools.reload();
    }
  };

  const current = schools.data?.find((s) => s.id === selected);

  return (
    <>
      <PageHead eyebrow="Owner console" title="Schools" sub="Create schools, choose their plan and switch modules on or off." />
      <ErrorNote error={act.error ?? schools.error} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
        <Card title="Schools" pad={false}>
          {schools.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>School</th><th>Plan</th><th>Modules</th><th>Students</th><th /></tr></thead>
                <tbody>
                  {schools.data.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td><Badge tone="dark">{planName(s.plan)}</Badge></td>
                      <td className="num">{s.modules.length}</td>
                      <td className="num">{s.students}</td>
                      <td><button className="btn small" onClick={() => setSelected(s.id)} aria-pressed={selected === s.id}>Manage</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No schools yet.</Empty>
          )}
        </Card>
        {current ? (
          <Card title={current.name} action={<button className="btn small" onClick={() => setSelected(null)}>Close</button>}>
            <Field label="Plan" id="plan">
              <select id="plan" className="input" value={current.plan} onChange={(e) => setPlan(e.target.value)}>
                {PLANS.map((p) => <option key={p} value={p}>{planName(p)}</option>)}
              </select>
            </Field>
            <span className="muted small">Changing the plan resets modules to that plan’s set.</span>
            {modules.data?.map((m) => (
              <div key={m.key} className="row between">
                <span>{m.name}</span>
                {m.key === 'core' ? <Badge tone="dark">Always on</Badge> : <Switch on={m.enabled} label={m.name} disabled={act.busy} onChange={(v) => toggle(m.key, v)} />}
              </div>
            ))}
          </Card>
        ) : (
          <Card title="New school">
            <form className="stack" onSubmit={create}>
              <Field label="School name" id="sn"><input id="sn" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Name in Arabic (optional)" id="sa"><input id="sa" className="input" dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></Field>
              <Field label="Plan" id="sp">
                <select id="sp" className="input" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                  {PLANS.map((p) => <option key={p} value={p}>{planName(p)}</option>)}
                </select>
              </Field>
              <Field label="School admin’s name" id="an"><input id="an" className="input" required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} /></Field>
              <Field label="Admin email" id="ae"><input id="ae" className="input" type="email" required value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></Field>
              <Field label="Admin password (8+ characters)" id="ap"><input id="ap" className="input" type="password" minLength={8} required value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} /></Field>
              <button className="btn primary" type="submit" disabled={act.busy}>Create school</button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
