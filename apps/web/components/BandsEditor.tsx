'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, Section, Tabs, toast } from './ui';

interface Row { min: string; label: string; labelAr: string; gpa: string }
const toRows = (bands: { min: number; label: string; labelAr: string; gpa?: number }[]): Row[] =>
  bands.map((b) => ({ min: String(b.min), label: b.label, labelAr: b.labelAr, gpa: b.gpa === undefined ? '' : String(b.gpa) }));

/** The grade bands of each school system a class uses: what a percentage is called on report cards and in the app. */
export function BandsEditor() {
  const { t, x } = useI18n();
  const bands = useApi<Record<string, any[]>>('/academics/bands');
  const classes = useApi<any[]>('/classes');
  const act = useAction();
  const used = [...new Set((classes.data ?? []).map((c) => (c.system as string | null) ?? 'OTHER'))];
  const systems = used.length ? used : ['OTHER'];
  const [system, setSystem] = useState('');
  const current = systems.includes(system) ? system : systems[0];
  const [rows, setRows] = useState<Row[]>([]);

  // What is shown starts from what is saved, and again after a save, a reset or a different system.
  useEffect(() => {
    if (bands.data?.[current]) setRows(toRows(bands.data[current]));
  }, [bands.data, current]);

  const gpa = current === 'AMERICAN' || rows.some((r) => r.gpa !== '');
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    const body = rows.map((r) => ({ min: Number(r.min), label: r.label, labelAr: r.labelAr, ...(r.gpa !== '' ? { gpa: Number(r.gpa) } : {}) }));
    if (await act.run(async () => bands.setData(await api(`/academics/bands/${current}`, { method: 'PUT', body: { bands: body } })))) toast(t.acad.bandsSaved);
  }

  async function reset() {
    if (await act.run(async () => bands.setData(await api(`/academics/bands/${current}`, { method: 'DELETE' })))) toast(t.acad.bandsReset);
  }

  return (
    <Section title={t.acad.bands} aside={t.acad.bandsSub}>
      <ErrorNote error={(act.error ?? bands.error) && x((act.error ?? bands.error)!)} />
      <div className="panel pad stack" style={{ gap: 16 }}>
        {systems.length > 1
          ? <Tabs label={t.acad.bands} value={current} onChange={setSystem} items={systems.map((s) => [s, t.eg.systems[s] ?? s])} />
          : <span className="small muted">{t.acad.usedBy}: {t.eg.systems[current] ?? current}</span>}
        <div className="scroll">
          <table>
            <thead>
              <tr><th>{t.acad.bandMin}</th><th>{t.acad.bandLabel}</th><th>{t.acad.bandLabelAr}</th>{gpa && <th>{t.acad.bandGpa}</th>}<th /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input className="input num" type="number" min={0} max={100} step="any" aria-label={t.acad.bandMin} style={{ width: 90 }} value={r.min} onChange={(e) => set(i, { min: e.target.value })} /></td>
                  <td><input className="input" aria-label={t.acad.bandLabel} maxLength={30} style={{ width: 160 }} value={r.label} onChange={(e) => set(i, { label: e.target.value })} /></td>
                  <td><input className="input" dir="rtl" aria-label={t.acad.bandLabelAr} maxLength={30} style={{ width: 160 }} value={r.labelAr} onChange={(e) => set(i, { labelAr: e.target.value })} /></td>
                  {gpa && <td><input className="input num" type="number" min={0} max={5} step="0.1" aria-label={t.acad.bandGpa} style={{ width: 90 }} value={r.gpa} onChange={(e) => set(i, { gpa: e.target.value })} /></td>}
                  <td><button type="button" className="btn small" disabled={rows.length <= 2} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>{t.acad.removeBand}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <button type="button" className="btn" disabled={rows.length >= 20} onClick={() => setRows((rs) => [...rs, { min: '', label: '', labelAr: '', gpa: '' }])}>{t.acad.addBand}</button>
          <button type="button" className="btn primary" disabled={act.busy} onClick={() => void save()}>{t.acad.saveBands}</button>
          <button type="button" className="btn" disabled={act.busy} onClick={() => confirm(t.acad.resetBands + '?') && void reset()}>{t.acad.resetBands}</button>
        </div>
      </div>
    </Section>
  );
}
