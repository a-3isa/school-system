'use client';
import { FormEvent, useState } from 'react';
import { patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { Badge, Card, ErrorNote, Field, PageHead, toast } from '@/components/ui';

const ROLES: Record<string, string> = { SCHOOL_ADMIN: 'Admin', TEACHER: 'Teacher', TRANSPORT: 'Transport', NURSE: 'Nurse', CANTEEN: 'Canteen', ACCOUNTANT: 'Accountant' };

export default function StaffPage() {
  const staff = useApi<any[]>('/staff');
  const act = useAction();
  const [form, setForm] = useState({ name: '', role: 'TEACHER', email: '', phone: '', password: '' });

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/staff', { ...form, phone: form.phone || undefined }))) {
      toast(`${form.name} can now sign in.`);
      setForm({ name: '', role: form.role, email: '', phone: '', password: '' });
      await staff.reload();
    }
  }

  const toggle = async (u: any) => {
    if (await act.run(() => patch(`/staff/${u.id}`, { active: !u.active }))) await staff.reload();
  };

  return (
    <>
      <PageHead eyebrow="People" title="Staff" sub="Everyone who signs in to the dashboard. Drivers and bus supervisors aren’t users; they’re contacts on a bus." />
      <ErrorNote error={staff.error ?? act.error} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <Card title="Accounts" pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Sign-in</th><th>Status</th><th /></tr></thead>
              <tbody>
                {staff.data?.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{ROLES[u.role] ?? u.role}</td>
                    <td className="small">{u.email}{u.phone ? ` · ${u.phone}` : ''}</td>
                    <td>{u.active ? <Badge tone="ok">Active</Badge> : <Badge>Off</Badge>}</td>
                    <td><button className="btn small" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Activate'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Add staff">
          <form className="stack" onSubmit={add}>
            <Field label="Name" id="n"><input id="n" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Role" id="r">
              <select id="r" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Email" id="e"><input id="e" className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Mobile (optional)" id="p"><input id="p" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Password (8+ characters)" id="pw"><input id="pw" className="input" type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <button className="btn primary" type="submit" disabled={act.busy}>Add</button>
          </form>
        </Card>
      </div>
    </>
  );
}
