'use client';
import { FormEvent, useEffect, useState } from 'react';
import { del, patch, upload } from '@/lib/api';
import { Crest } from '@/components/Crest';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { has, useSession } from '@/lib/session';
import { BandsEditor } from '@/components/BandsEditor';
import { ErrorNote, PageHead, Pill, Section, Switch, toast } from '@/components/ui';
import { TimeInput } from '@/components/TimeInput';

/** Saturday first, as Egyptian school weeks are read. */
const WEEK = [6, 0, 1, 2, 3, 4, 5];

/** Features that come with the subscription: only the platform owner switches them (see the API's registry). */
const SUBSCRIPTION: Record<string, string[]> = { messaging: ['chat', 'polls', 'meetings'] };

export default function ModulesPage() {
  const { me, refresh } = useSession();
  const [crestVersion, setCrestVersion] = useState(0);
  const { t } = useI18n();
  const modules = useApi<any[]>('/modules');
  const school = useApi('/school');
  const act = useAction();
  const [settings, setSettings] = useState({ absenceNoticeTime: '08:15', chatFrom: '08:00', chatTo: '15:00', principalName: '', schoolDays: [0, 1, 2, 3, 4] as number[] });

  useEffect(() => {
    if (school.data) setSettings({ absenceNoticeTime: school.data.absenceNoticeTime, chatFrom: school.data.chatFrom, chatTo: school.data.chatTo, principalName: school.data.principalName ?? '', schoolDays: school.data.schoolDays });
  }, [school.data]);

  const setFeature = async (key: string, feature: string, on: boolean) => {
    if (await act.run(async () => modules.setData(await patch(`/modules/${key}/features`, { features: { [feature]: on } })))) toast(t.common.saved);
  };

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    if (await act.run(async () => school.setData(await patch('/school', settings)))) {
      toast(t.modules.settingsSaved);
      await refresh();
    }
  }

  const automaticAllowed = modules.data?.find((m) => m.key === 'attendance')?.features.automatic;
  const feature = (f: string) => t.modules.features[f as keyof typeof t.modules.features] ?? f;
  const toggleDay = (d: number) =>
    setSettings({ ...settings, schoolDays: settings.schoolDays.includes(d) ? settings.schoolDays.filter((x) => x !== d) : [...settings.schoolDays, d].sort() });

  return (
    <>
      <PageHead sub={t.modules.sub} title={t.nav.modules} />
      <ErrorNote error={act.error} />
      <div className="panel">
        <div className="settings-row">
          <span className="crest-row">
            <span className="crest-lg"><Crest name={me.schoolName ?? ''} hasLogo={me.schoolLogo} version={crestVersion} /></span>
            <span className="crest-text"><b>{t.modules.crest}</b><span>{t.modules.crestHelp}</span></span>
          </span>
          <span className="row" style={{ gap: 8 }}>
            <label className="btn small">
              {me.schoolLogo ? t.modules.crestReplace : t.modules.crestUpload}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f && (await act.run(() => upload('/school/logo', f, {}, 'PUT')))) { await refresh(); setCrestVersion((v) => v + 1); toast(t.modules.crestSaved); }
              }} />
            </label>
            {me.schoolLogo && <button type="button" className="btn small" onClick={async () => { if (await act.run(() => del('/school/logo'))) { await refresh(); toast(t.modules.crestSaved); } }}>{t.modules.crestRemove}</button>}
          </span>
        </div>
      </div>
      <form className="panel" onSubmit={saveSettings}>
        <div className="settings-row">
          <span><b>{t.modules.auto}</b><span>{automaticAllowed ? t.modules.autoOn : t.modules.autoOff}</span></span>
          {automaticAllowed ? <Pill tone="P" glyph="✓">{t.modules.inSub}</Pill> : <Pill tone="E" glyph="–">{t.modules.notInSub}</Pill>}
        </div>
        <div className="settings-row">
          <span><b>{t.modules.days}</b><span>{t.modules.daysHelp}</span></span>
          <div className="chips" role="group" aria-label={t.modules.days}>
            {WEEK.map((d) => (
              <button key={d} type="button" className="chip-toggle" aria-pressed={settings.schoolDays.includes(d)} onClick={() => toggleDay(d)}>{t.days[d]}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span><b>{t.modules.absTime}</b><span>{t.modules.absTimeHelp}</span></span>
          <TimeInput className="input num" aria-label={t.modules.absTime} style={{ width: 140 }} value={settings.absenceNoticeTime} onChange={(v) => setSettings({ ...settings, absenceNoticeTime: v })} />
        </div>
        {has(me, 'messaging', 'chat') && (
          <div className="settings-row">
            <span><b>{t.modules.chatHours}</b><span>{t.modules.chatHoursHelp}</span></span>
            <span className="row" style={{ gap: 8 }}>
              <TimeInput className="input num" aria-label={t.modules.chatFrom} style={{ width: 120 }} value={settings.chatFrom} onChange={(v) => setSettings({ ...settings, chatFrom: v })} />
              <span aria-hidden="true">–</span>
              <TimeInput className="input num" aria-label={t.modules.chatTo} style={{ width: 120 }} value={settings.chatTo} onChange={(v) => setSettings({ ...settings, chatTo: v })} />
            </span>
          </div>
        )}
        {has(me, 'academics', 'reportCards') && (
          <div className="settings-row">
            <span><b>{t.acad.principalName}</b><span>{t.acad.principalHelp}</span></span>
            <input className="input" aria-label={t.acad.principalName} maxLength={100} style={{ width: 260 }} value={settings.principalName} onChange={(e) => setSettings({ ...settings, principalName: e.target.value })} />
          </div>
        )}
        <div className="settings-row">
          <span />
          <button className="btn primary" type="submit" disabled={act.busy}>{t.modules.saveSettings}</button>
        </div>
      </form>
      {me.role === 'SCHOOL_ADMIN' && has(me, 'academics') && <BandsEditor />}
      {modules.data?.map((m) => {
        const features = Object.entries(m.features as Record<string, boolean>).filter(([f]) => !(m.key === 'attendance' && f === 'automatic'));
        return (
          <Section key={m.key} title={t.moduleNames[m.key] ?? m.name} aside={m.key === 'core' ? t.modules.alwaysOn : m.enabled ? `✓ ${t.modules.inPlan}` : t.modules.notInPlan}>
            <div className="panel" style={{ opacity: m.enabled ? 1 : 0.6 }}>
              {m.requires.length > 0 && <div className="settings-row"><span><span>{t.modules.needs(m.requires.map((k: string) => t.moduleNames[k] ?? k).join(t.tt.listSep))}</span></span></div>}
              {features.map(([f, on]) => (
                <div key={f} className="settings-row">
                  <span><b>{feature(f)}</b></span>
                  {SUBSCRIPTION[m.key]?.includes(f)
                    ? (on && m.enabled ? <Pill tone="P" glyph="✓">{t.modules.inSub}</Pill> : <Pill tone="E" glyph="–">{t.modules.notInSub}</Pill>)
                    : <Switch on={on} label={feature(f)} disabled={!m.enabled || act.busy} onChange={(v) => setFeature(m.key, f, v)} />}
                </div>
              ))}
              {!features.length && <div className="settings-row"><span><span>{t.modules.noOptions}</span></span></div>}
            </div>
          </Section>
        );
      })}
    </>
  );
}
