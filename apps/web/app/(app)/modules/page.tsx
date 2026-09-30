'use client';
import { FormEvent, useEffect, useState } from 'react';
import { patch } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Badge, Card, ErrorNote, Field, PageHead, Switch, toast } from '@/components/ui';

const FEATURE: Record<string, string> = {
  excelImport: 'Excel import', automatic: 'Automatic attendance (BLE straps)', leaveEarlyAlerts: 'Alerts when a child leaves early',
  liveMapForParents: 'Live bus map for parents', parentalControls: 'Parental controls', tuitionFees: 'Tuition fees',
  paidActivities: 'Paid activities', reportCards: 'Report cards', clinic: 'Clinic visits', merits: 'Merit points', chat: 'Parent–teacher chat', polls: 'Polls',
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ModulesPage() {
  const { refresh } = useSession();
  const modules = useApi<any[]>('/modules');
  const school = useApi('/school');
  const act = useAction();
  const [settings, setSettings] = useState({ attendanceMode: 'MANUAL', absenceNoticeTime: '08:15', schoolDays: [0, 1, 2, 3, 4] as number[] });

  useEffect(() => {
    if (school.data) setSettings({ attendanceMode: school.data.attendanceMode, absenceNoticeTime: school.data.absenceNoticeTime, schoolDays: school.data.schoolDays });
  }, [school.data]);

  const setFeature = async (key: string, feature: string, on: boolean) => {
    if (await act.run(async () => modules.setData(await patch(`/modules/${key}/features`, { features: { [feature]: on } })))) toast('Saved.');
  };

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    if (await act.run(async () => school.setData(await patch('/school', settings)))) {
      toast('School settings saved.');
      await refresh();
    }
  }

  const automaticAllowed = modules.data?.find((m) => m.key === 'attendance')?.features.automatic;

  return (
    <>
      <PageHead eyebrow="School setup" title="Modules & settings" sub="Modules follow your subscription. You choose the features inside the modules you have." />
      <ErrorNote error={act.error} />
      <Card title="Attendance settings">
        <form className="stack" onSubmit={saveSettings}>
          <div className="form-row">
            <Field label="How attendance is taken" id="mode">
              <select id="mode" className="input" value={settings.attendanceMode} onChange={(e) => setSettings({ ...settings, attendanceMode: e.target.value })}>
                <option value="MANUAL">Manual, on the classroom PC</option>
                <option value="AUTOMATIC" disabled={!automaticAllowed}>Automatic, from BLE straps{automaticAllowed ? '' : ' (turn the feature on below)'}</option>
              </select>
            </Field>
            <Field label="“Absent today” message goes out at" id="t">
              <input id="t" className="input" type="time" value={settings.absenceNoticeTime} onChange={(e) => setSettings({ ...settings, absenceNoticeTime: e.target.value })} />
            </Field>
          </div>
          <div className="field">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>School days</span>
            <div className="seg" role="group" aria-label="School days">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  className="s-PRESENT"
                  aria-pressed={settings.schoolDays.includes(i)}
                  onClick={() => setSettings({ ...settings, schoolDays: settings.schoolDays.includes(i) ? settings.schoolDays.filter((x) => x !== i) : [...settings.schoolDays, i].sort() })}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div><button className="btn primary" type="submit" disabled={act.busy}>Save settings</button></div>
        </form>
      </Card>
      <div className="grid g2">
        {modules.data?.map((m) => (
          <Card key={m.key} title={m.name} action={m.key === 'core' ? <Badge tone="dark">Always on</Badge> : m.enabled ? <Badge tone="ok">In your plan</Badge> : <Badge>Not in your plan</Badge>}>
            {m.requires.length > 0 && <span className="muted small">Needs {m.requires.join(', ')}</span>}
            {Object.entries(m.features as Record<string, boolean>).map(([f, on]) => (
              <div key={f} className="row between" style={{ opacity: m.enabled ? 1 : 0.5 }}>
                <span>{FEATURE[f] ?? f}</span>
                <Switch on={on} label={FEATURE[f] ?? f} disabled={!m.enabled || act.busy} onChange={(v) => setFeature(m.key, f, v)} />
              </div>
            ))}
            {!Object.keys(m.features).length && <span className="muted small">No options.</span>}
          </Card>
        ))}
      </div>
    </>
  );
}
