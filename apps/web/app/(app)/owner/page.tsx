'use client';
import { FormEvent, useState } from 'react';
import { patch, post, put } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, Field, PageHead, Pill, Section, Switch, toast, Tone } from '@/components/ui';

const PLANS = ['ESSENTIALS', 'SMART', 'COMPLETE'];
const PLAN_TONE: Record<string, Tone> = { ESSENTIALS: 'E', SMART: 'P', COMPLETE: 'T' };
const BLANK = { name: '', nameAr: '', plan: 'ESSENTIALS', adminName: '', adminEmail: '', adminPassword: '' };

export default function OwnerPage() {
  const { t } = useI18n();
  const schools = useApi<any[]>('/owner/schools');
  const [selected, setSelected] = useState<string | null>(null);
  const modules = useApi<any[]>(selected ? `/owner/schools/${selected}/modules` : null);
  const act = useAction();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const planName = (p: string) => t.owner.plans[p as keyof typeof t.owner.plans] ?? p;

  async function create(e: FormEvent) {
    e.preventDefault();
    const body = { name: form.name, nameAr: form.nameAr || undefined, plan: form.plan, admin: { name: form.adminName, email: form.adminEmail, password: form.adminPassword } };
    if (await act.run(() => post('/owner/schools', body))) {
      toast(t.owner.created(form.name));
      setForm(BLANK);
      setCreating(false);
      await schools.reload();
    }
  }

  const toggle = async (key: string, enabled: boolean) => {
    const ok = await act.run(async () => {
      const res = await put(`/owner/schools/${selected}/modules/${key}`, { enabled });
      modules.setData(res.modules);
      if (res.alsoEnabled?.length) toast(t.owner.alsoOn(res.alsoEnabled.join(', ')));
    });
    if (ok) await schools.reload();
  };

  const setStraps = async (on: boolean) => {
    if (await act.run(async () => modules.setData(await patch(`/owner/schools/${selected}/modules/attendance/features`, { features: { automatic: on } })))) {
      toast(on ? t.owner.strapsOn : t.owner.strapsOff);
    }
  };

  const setPlan = async (plan: string) => {
    if (await act.run(async () => modules.setData(await put(`/owner/schools/${selected}/plan`, { plan })))) {
      toast(t.owner.planChanged(planName(plan)));
      await schools.reload();
    }
  };

  const current = schools.data?.find((s) => s.id === selected);

  return (
    <>
      <PageHead
        sub={schools.data ? t.owner.sub(schools.data.length) : undefined}
        title={t.nav.schools}
        actions={<button type="button" className="btn primary" onClick={() => setCreating(true)}>{t.owner.create}</button>}
      />
      <ErrorNote error={act.error ?? schools.error} />
      {creating && (
        <form className="form" onSubmit={create}>
          <div className="form-title">{t.owner.create}</div>
          <Field label={t.owner.schoolName} id="sn"><input id="sn" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t.owner.nameAr} id="sa"><input id="sa" className="input" dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></Field>
          <Field label={t.owner.plan} id="sp">
            <select id="sp" className="input" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              {PLANS.map((p) => <option key={p} value={p}>{planName(p)}</option>)}
            </select>
          </Field>
          <Field label={t.owner.adminName} id="an"><input id="an" className="input" required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} /></Field>
          <Field label={t.owner.adminEmail} id="ae"><input id="ae" className="input" type="email" dir="ltr" required placeholder="admin@school.edu.eg" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></Field>
          <Field label={t.staff.password} id="ap" help={t.staff.passwordHelp}><input id="ap" className="input" type="password" minLength={8} required value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} /></Field>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={act.busy}>{t.owner.createBtn}</button>
            <button className="btn" type="button" onClick={() => setCreating(false)}>{t.common.cancel}</button>
          </div>
        </form>
      )}
      <div className={current ? 'cols wide-narrow' : 'stack'}>
        <div className="panel scroll">
          {schools.data?.length ? (
            <table style={{ minWidth: 560 }}>
              <thead><tr><th>{t.owner.school}</th><th>{t.owner.plan}</th><th>{t.owner.modules}</th><th /></tr></thead>
              <tbody>
                {schools.data.map((s) => (
                  <tr key={s.id} style={selected === s.id ? { background: 'var(--accent-wash)' } : undefined}>
                    <td className="strong">{s.name}<span className="sub">{t.setup.nStudents(s.students)}</span></td>
                    <td><Pill tone={PLAN_TONE[s.plan]}>{planName(s.plan)}</Pill></td>
                    <td className="num">{s.modules.length}</td>
                    <td><button type="button" className="btn small" aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}>{t.owner.manage}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{schools.loading ? t.common.loading : t.owner.noSchools}</Empty>
          )}
        </div>
        {current && (
          <Section title={current.name} aside={<button type="button" className="btn link" onClick={() => setSelected(null)}>{t.common.close}</button>}>
            <div className="panel">
              <div className="settings-row">
                <span><b>{t.owner.plan}</b><span>{t.owner.planHelp}</span></span>
                <select className="input" aria-label={t.owner.plan} style={{ width: 160 }} value={current.plan} onChange={(e) => setPlan(e.target.value)}>
                  {PLANS.map((p) => <option key={p} value={p}>{planName(p)}</option>)}
                </select>
              </div>
              {modules.data?.map((m) => (
                <div key={m.key}>
                  <div className="settings-row">
                    <span><b>{m.name}</b></span>
                    {m.key === 'core' ? <Pill tone="N">{t.modules.alwaysOn}</Pill> : <Switch on={m.enabled} label={m.name} disabled={act.busy} onChange={(v) => toggle(m.key, v)} />}
                  </div>
                  {m.key === 'attendance' && m.enabled && (
                    <div className="settings-row" style={{ paddingInlineStart: 36 }}>
                      <span><b>{t.owner.straps}</b><span>{t.owner.strapsHelp}</span></span>
                      <Switch on={!!m.features.automatic} label={t.owner.straps} disabled={act.busy} onChange={setStraps} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
