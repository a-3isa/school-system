'use client';
import { FormEvent, useState } from 'react';
import { patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { HONORIFICS, useI18n } from '@/lib/i18n';
import { Dict } from '@/lib/strings';
import { ErrorNote, Field, PageHead, Switch, toast } from '@/components/ui';

const ROLES = ['SCHOOL_ADMIN', 'TEACHER', 'SOCIAL_WORKER', 'NURSE', 'TRANSPORT', 'CANTEEN', 'ACCOUNTANT'] as const;
const BLANK = { honorific: '', name: '', role: 'TEACHER', email: '', phone: '', password: '' };

export default function StaffPage() {
  const { t, lang, staff: staffName } = useI18n();
  const titles = Object.entries(HONORIFICS[lang]);
  const staff = useApi<any[]>('/staff');
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const roleName = (r: string) => t.roles[r as keyof Dict['roles']] ?? r;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/staff', { ...form, honorific: form.honorific || undefined, phone: form.phone || undefined }))) {
      toast(t.staff.added(staffName({ name: form.name, honorific: form.honorific })));
      setForm({ ...BLANK, role: form.role });
      setAdding(false);
      await staff.reload();
    }
  }

  const setTitle = async (u: any, honorific: string) => {
    if (await act.run(() => patch(`/staff/${u.id}`, { honorific: honorific || null }))) await staff.reload();
  };

  const toggle = async (u: any) => {
    if (await act.run(() => patch(`/staff/${u.id}`, { active: !u.active }))) await staff.reload();
  };

  return (
    <>
      <PageHead sub={t.staff.sub} title={t.nav.staff} actions={<button type="button" className="btn primary" onClick={() => setAdding(true)}>{t.staff.add}</button>} />
      {adding && (
        <form className="form" onSubmit={add}>
          <div className="form-title">{t.staff.add}</div>
          {act.error && <div className="full"><ErrorNote error={act.error} /></div>}
          <Field label={t.staff.title} id="h">
            <select id="h" className="input" value={form.honorific} onChange={(e) => setForm({ ...form, honorific: e.target.value })}>
              <option value="">{t.staff.noTitle}</option>
              {titles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label={t.student.fullName} id="n"><input id="n" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t.common.email} id="e"><input id="e" className="input" type="email" dir="ltr" required placeholder="name@school.edu.eg" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label={t.staff.role} id="r">
            <select id="r" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
            </select>
          </Field>
          <Field label={t.student.mobileOptional} id="p"><input id="p" className="input num" dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label={t.staff.password} id="pw" help={t.staff.passwordHelp}><input id="pw" className="input" type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={act.busy}>{t.staff.add}</button>
            <button className="btn" type="button" onClick={() => setAdding(false)}>{t.common.cancel}</button>
          </div>
        </form>
      )}
      {!adding && <ErrorNote error={staff.error ?? act.error} />}
      <div className="panel scroll">
        <table style={{ minWidth: 640 }}>
          <thead><tr><th>{t.staff.title}</th><th>{t.common.name}</th><th>{t.staff.role}</th><th>{t.common.email}</th><th>{t.staff.active}</th></tr></thead>
          <tbody>
            {staff.data?.map((u) => (
              <tr key={u.id}>
                <td>
                  <select className="input small-select" aria-label={t.staff.titleFor(u.name)} value={u.honorific ?? ''} disabled={act.busy} onChange={(e) => setTitle(u, e.target.value)}>
                    <option value="">—</option>
                    {titles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="strong">{u.name}</td>
                <td>{roleName(u.role)}</td>
                <td className="small muted"><bdi dir="ltr">{u.email}</bdi>{u.phone && <span className="sub num"><bdi dir="ltr">{u.phone}</bdi></span>}</td>
                <td><Switch on={u.active} label={t.staff.activeFor(staffName(u))} disabled={act.busy} onChange={() => toggle(u)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
