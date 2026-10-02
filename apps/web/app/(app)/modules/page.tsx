'use client';
import { FormEvent, useEffect, useState } from 'react';
import { del, patch, upload } from '@/lib/api';
import { Crest } from '@/components/Crest';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { ErrorNote, PageHead, Pill, Section, Switch, toast } from '@/components/ui';

/** Saturday first, as Egyptian school weeks are read. */
const WEEK = [6, 0, 1, 2, 3, 4, 5];

export default function ModulesPage() {
  const { me, refresh } = useSession();
  const [crestVersion, setCrestVersion] = useState(0);
  const { t } = useI18n();
  const modules = useApi<any[]>('/modules');
  const school = useApi('/school');
  const act = useAction();
  const [settings, setSettings] = useState({ absenceNoticeTime: '08:15', schoolDays: [0, 1, 2, 3, 4] as number[] });

  useEffect(() => {
    if (school.data) setSettings({ absenceNoticeTime: school.data.absenceNoticeTime, schoolDays: school.data.schoolDays });
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
          <input className="input num" type="time" aria-label={t.modules.absTime} style={{ width: 140 }} value={settings.absenceNoticeTime} onChange={(e) => setSettings({ ...settings, absenceNoticeTime: e.target.value })} />
        </div>
        <div className="settings-row">
          <span />
          <button className="btn primary" type="submit" disabled={act.busy}>{t.modules.saveSettings}</button>
        </div>
      </form>
      {modules.data?.map((m) => {
        const features = Object.entries(m.features as Record<string, boolean>).filter(([f]) => !(m.key === 'attendance' && f === 'automatic'));
        return (
          <Section key={m.key} title={m.name} aside={m.key === 'core' ? t.modules.alwaysOn : m.enabled ? `✓ ${t.modules.inPlan}` : t.modules.notInPlan}>
            <div className="panel" style={{ opacity: m.enabled ? 1 : 0.6 }}>
              {m.requires.length > 0 && <div className="settings-row"><span><span>{t.modules.needs(m.requires.join(', '))}</span></span></div>}
              {features.map(([f, on]) => (
                <div key={f} className="settings-row">
                  <span><b>{feature(f)}</b></span>
                  <Switch on={on} label={feature(f)} disabled={!m.enabled || act.busy} onChange={(v) => setFeature(m.key, f, v)} />
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
