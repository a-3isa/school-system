'use client';
import { FormEvent, useEffect, useState } from 'react';
import { dateTimeCairo, patch, post, put, timeCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Dict } from '@/lib/strings';
import { Empty, ErrorNote, Field, Note, PageHead, Pill, Section, Tabs, toast } from '@/components/ui';

const online = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 5 * 60_000;

export default function DevicesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'gateways' | 'straps' | 'rules'>('gateways');
  const gateways = useApi<any[]>('/devices/gateways');
  const straps = useApi<any[]>('/devices/straps');
  const students = useApi<any[]>('/students?active=true');
  const rooms = useApi<any[]>('/rooms');
  const rules = useApi('/devices/rules');
  const act = useAction();
  const [claim, setClaim] = useState({ claimCode: '', name: '', kind: 'ROOM', roomId: '' });
  const [strap, setStrap] = useState({ mac: '', studentId: '' });
  const [ruleForm, setRuleForm] = useState({ presentShare: 70, lateAfterMinutes: 10, gateRssi: -70, roomRssi: -85 });

  useEffect(() => {
    if (rules.data) {
      setRuleForm({
        presentShare: Math.round(rules.data.room.presentShare * 100),
        lateAfterMinutes: rules.data.room.lateAfterMinutes,
        gateRssi: rules.data.gate.minRssi,
        roomRssi: rules.data.room.minRssi,
      });
    }
  }, [rules.data]);

  const withStrap = new Set(straps.data?.filter((s) => s.studentId).map((s) => s.studentId));
  const kindName = (k: string) => t.devices.kinds[k as keyof Dict['devices']['kinds']] ?? '—';
  const covered = new Set(gateways.data?.map((g) => g.room?.id).filter(Boolean));
  const deaf = (rooms.data ?? []).filter((r) => !covered.has(r.id));

  async function doClaim(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/devices/gateways/claim', { ...claim, roomId: claim.kind === 'ROOM' ? claim.roomId : undefined }))) {
      toast(t.devices.claimed(claim.name));
      setClaim({ claimCode: '', name: '', kind: claim.kind, roomId: '' });
      await gateways.reload();
    }
  }

  async function addStrap(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/devices/straps', { mac: strap.mac, studentId: strap.studentId || undefined }))) {
      toast(t.devices.strapAdded);
      setStrap({ mac: '', studentId: '' });
      await straps.reload();
    }
  }

  const assign = async (id: string, studentId: string) => {
    if (await act.run(() => patch(`/devices/straps/${id}`, { studentId: studentId || null }))) await straps.reload();
  };

  async function saveRules(e?: FormEvent) {
    e?.preventDefault();
    const body = { rules: { room: { presentShare: ruleForm.presentShare / 100, lateAfterMinutes: ruleForm.lateAfterMinutes, minRssi: ruleForm.roomRssi }, gate: { minRssi: ruleForm.gateRssi } } };
    if (await act.run(async () => rules.setData(await put('/devices/rules', body)))) toast(t.devices.rulesSaved);
  }

  const rule = (key: keyof typeof ruleForm, label: string, help: string, unit: string, min: number, max: number) => (
    <div className="settings-row" key={key}>
      <span><b>{label}</b><span>{help}</span></span>
      <span className="unit">
        <input className="input num" type="number" aria-label={label} min={min} max={max} value={ruleForm[key]} onChange={(e) => setRuleForm({ ...ruleForm, [key]: Number(e.target.value) })} />
        {unit}
      </span>
    </div>
  );

  return (
    <>
      <PageHead
        sub={t.devices.sub}
        title={t.nav.devices}
        actions={tab === 'rules' && <button type="button" className="btn primary" disabled={act.busy} onClick={() => saveRules()}>{t.devices.saveRules}</button>}
      />
      <Tabs label={t.nav.devices} value={tab} onChange={setTab} items={[['gateways', t.devices.gateways], ['straps', t.devices.straps], ['rules', t.devices.rules]]} />
      <ErrorNote error={act.error ?? gateways.error} />

      {tab === 'gateways' && (
        <>
          <Section title={t.devices.claimTitle}>
            <form className="form" onSubmit={doClaim}>
              <Field label={t.devices.claimCode} id="cc"><input id="cc" className="input mono" dir="ltr" required placeholder="GW-XXXX-XXXX" value={claim.claimCode} onChange={(e) => setClaim({ ...claim, claimCode: e.target.value })} /></Field>
              <Field label={t.common.name} id="gn"><input id="gn" className="input" required placeholder={t.devices.namePh} value={claim.name} onChange={(e) => setClaim({ ...claim, name: e.target.value })} /></Field>
              <Field label={t.devices.kind} id="gk">
                <select id="gk" className="input" value={claim.kind} onChange={(e) => setClaim({ ...claim, kind: e.target.value })}>
                  {['ROOM', 'GATE', 'CANTEEN', 'BUS'].map((k) => <option key={k} value={k}>{kindName(k)}</option>)}
                </select>
              </Field>
              {claim.kind === 'ROOM' && (
                <Field label={t.devices.room} id="gr">
                  <select id="gr" className="input" required value={claim.roomId} onChange={(e) => setClaim({ ...claim, roomId: e.target.value })}>
                    <option value="">{t.common.choose}</option>
                    {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
              )}
              <div className="form-actions"><button className="btn primary" type="submit" disabled={act.busy}>{t.devices.claim}</button></div>
            </form>
          </Section>
          <div className="panel scroll">
            {gateways.data?.length ? (
              <table style={{ minWidth: 680 }}>
                <thead><tr><th>{t.common.name}</th><th>{t.devices.kind}</th><th>{t.devices.room}</th><th>{t.devices.lastSeen}</th><th>{t.devices.firmware}</th></tr></thead>
                <tbody>
                  {gateways.data.map((g) => (
                    <tr key={g.id}>
                      <td className="strong">{g.name}<span className="sub mono"><bdi dir="ltr">{g.serial}</bdi></span></td>
                      <td>{kindName(g.kind)}</td>
                      <td>{g.room?.name ?? '—'}</td>
                      <td>{online(g.lastSeenAt) ? <Pill tone="P" glyph="✓">{t.devices.online}</Pill> : <Pill tone="A" glyph="✕">{g.lastSeenAt ? t.devices.lastSeenAt(timeCairo(g.lastSeenAt)) : t.devices.never}</Pill>}</td>
                      <td className="mono">{g.firmware ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{t.devices.noGateways}</Empty>
            )}
          </div>
          {deaf.map((r) => <Note key={r.id} tone="warn" title={t.devices.noGatewayIn(r.name)}>{t.devices.noGatewayText}</Note>)}
        </>
      )}

      {tab === 'straps' && (
        <>
          <Section title={t.devices.registerStrap}>
            <form className="form" onSubmit={addStrap}>
              <Field label={t.devices.address} id="sm"><input id="sm" className="input mono" dir="ltr" required placeholder="DC:0D:30:AA:4A:11" value={strap.mac} onChange={(e) => setStrap({ ...strap, mac: e.target.value })} /></Field>
              <Field label={t.devices.studentOptional} id="ss">
                <select id="ss" className="input" value={strap.studentId} onChange={(e) => setStrap({ ...strap, studentId: e.target.value })}>
                  <option value="">{t.devices.spare}</option>
                  {students.data?.filter((st) => !withStrap.has(st.id)).map((st) => <option key={st.id} value={st.id}>{st.firstName} {st.lastName}</option>)}
                </select>
              </Field>
              <div className="form-actions"><button className="btn primary" type="submit" disabled={act.busy}>{t.devices.register}</button></div>
            </form>
          </Section>
          <div className="panel scroll">
            {straps.data?.length ? (
              <table style={{ minWidth: 640 }}>
                <thead><tr><th>{t.devices.address}</th><th>{t.devices.student}</th><th>{t.devices.battery}</th><th>{t.devices.lastSeen}</th></tr></thead>
                <tbody>
                  {straps.data.map((s) => (
                    <tr key={s.id}>
                      <td className="mono"><bdi dir="ltr">{s.mac}</bdi></td>
                      <td>
                        <select className="input" aria-label={t.devices.studentFor(s.mac)} value={s.studentId ?? ''} onChange={(e) => assign(s.id, e.target.value)}>
                          <option value="">{t.devices.spare}</option>
                          {students.data?.filter((st) => st.id === s.studentId || !withStrap.has(st.id)).map((st) => (
                            <option key={st.id} value={st.id}>{st.firstName} {st.lastName}{st.class ? ` · ${st.class.name}` : ''}</option>
                          ))}
                        </select>
                      </td>
                      <td className="num">{s.battery == null ? '—' : s.battery < 20 ? <Pill tone="L" glyph="!">{t.devices.low(s.battery)}</Pill> : `${s.battery}%`}</td>
                      <td className="small num">{s.lastSeenAt ? dateTimeCairo(s.lastSeenAt) : t.devices.never}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{t.devices.noStraps}</Empty>
            )}
          </div>
        </>
      )}

      {tab === 'rules' && (
        <form className="panel" onSubmit={saveRules}>
          {rule('presentShare', t.devices.rPresent, t.devices.rPresentHelp, t.devices.pctOfLesson, 10, 100)}
          {rule('lateAfterMinutes', t.devices.rLate, t.devices.rLateHelp, t.devices.min, 0, 60)}
          {rule('gateRssi', t.devices.rGate, t.devices.rSignalHelp, 'dBm', -120, 0)}
          {rule('roomRssi', t.devices.rRoom, t.devices.rSignalHelp, 'dBm', -120, 0)}
          <div className="settings-row"><span><span>{t.devices.loudest}</span></span></div>
        </form>
      )}
    </>
  );
}
