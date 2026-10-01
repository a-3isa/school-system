'use client';
import { FormEvent, useEffect, useState } from 'react';
import { dateTimeCairo, patch, post, put, timeCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { Badge, Card, Empty, ErrorNote, Field, Kpi, PageHead, toast } from '@/components/ui';

const KIND: Record<string, string> = { GATE: 'Gate', ROOM: 'Room', BUS: 'Bus', CANTEEN: 'Canteen' };
const online = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 5 * 60_000;

export default function DevicesPage() {
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
  const low = straps.data?.filter((s) => s.battery != null && s.battery < 20).length ?? 0;

  async function doClaim(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/devices/gateways/claim', { ...claim, roomId: claim.kind === 'ROOM' ? claim.roomId : undefined }))) {
      toast(`${claim.name} added.`);
      setClaim({ claimCode: '', name: '', kind: claim.kind, roomId: '' });
      await gateways.reload();
    }
  }

  async function addStrap(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/devices/straps', { mac: strap.mac, studentId: strap.studentId || undefined }))) {
      toast('Strap registered.');
      setStrap({ mac: '', studentId: '' });
      await straps.reload();
    }
  }

  const assign = async (id: string, studentId: string) => {
    if (await act.run(() => patch(`/devices/straps/${id}`, { studentId: studentId || null }))) await straps.reload();
  };

  async function saveRules(e: FormEvent) {
    e.preventDefault();
    const body = { rules: { room: { presentShare: ruleForm.presentShare / 100, lateAfterMinutes: ruleForm.lateAfterMinutes, minRssi: ruleForm.roomRssi }, gate: { minRssi: ruleForm.gateRssi } } };
    if (await act.run(async () => rules.setData(await put('/devices/rules', body)))) toast('Rules saved.');
  }

  return (
    <>
      <PageHead eyebrow="School setup" title="Devices" sub="Gateways at the gates and in every lesson room hear each student’s strap. Add a gateway with the claim code on its label." />
      <ErrorNote error={act.error ?? gateways.error} />
      <div className="grid g4">
        <Kpi label="Gateways online" value={`${gateways.data?.filter((g) => online(g.lastSeenAt)).length ?? 0} / ${gateways.data?.length ?? 0}`} />
        <Kpi label="Straps assigned" value={withStrap.size} sub={`${students.data?.length ?? 0} students`} />
        <Kpi label="Students without a strap" value={(students.data?.length ?? 0) - withStrap.size} sub="marked on the classroom PC" />
        <Kpi label="Low batteries" value={low} sub="below 20%" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <Card title="Gateways" pad={false}>
          {gateways.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Kind</th><th>Room</th><th>Serial</th><th>Firmware</th><th>Status</th></tr></thead>
                <tbody>
                  {gateways.data.map((g) => (
                    <tr key={g.id}>
                      <td>{g.name}</td>
                      <td>{KIND[g.kind] ?? '—'}</td>
                      <td>{g.room?.name ?? '—'}</td>
                      <td className="num small">{g.serial}</td>
                      <td className="small">{g.firmware ?? '—'}</td>
                      <td>{online(g.lastSeenAt) ? <Badge tone="ok">Online</Badge> : <Badge tone="alert">{g.lastSeenAt ? `Last seen ${timeCairo(g.lastSeenAt)}` : 'Never seen'}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No gateways yet.</Empty>
          )}
        </Card>
        <Card title="Add a gateway">
          <form className="stack" onSubmit={doClaim}>
            <Field label="Claim code (on the label)" id="cc"><input id="cc" className="input" required placeholder="GW-XXXX-XXXX" value={claim.claimCode} onChange={(e) => setClaim({ ...claim, claimCode: e.target.value })} /></Field>
            <Field label="Name" id="gn"><input id="gn" className="input" required placeholder="Room 204" value={claim.name} onChange={(e) => setClaim({ ...claim, name: e.target.value })} /></Field>
            <div className="form-row">
              <Field label="Where" id="gk">
                <select id="gk" className="input" value={claim.kind} onChange={(e) => setClaim({ ...claim, kind: e.target.value })}>
                  <option value="ROOM">Lesson room</option>
                  <option value="GATE">School gate</option>
                  <option value="CANTEEN">Canteen</option>
                  <option value="BUS">Bus</option>
                </select>
              </Field>
              {claim.kind === 'ROOM' && (
                <Field label="Room" id="gr">
                  <select id="gr" className="input" required value={claim.roomId} onChange={(e) => setClaim({ ...claim, roomId: e.target.value })}>
                    <option value="">Choose</option>
                    {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <button className="btn primary" type="submit" disabled={act.busy}>Add gateway</button>
          </form>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <Card title="Straps" pad={false}>
          {straps.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Strap</th><th>Student</th><th>Battery</th><th>Last heard</th></tr></thead>
                <tbody>
                  {straps.data.map((s) => (
                    <tr key={s.id}>
                      <td className="num small">{s.mac}</td>
                      <td>
                        <select className="input" aria-label={`Student for strap ${s.mac}`} value={s.studentId ?? ''} onChange={(e) => assign(s.id, e.target.value)}>
                          <option value="">Spare</option>
                          {students.data?.filter((st) => st.id === s.studentId || !withStrap.has(st.id)).map((st) => (
                            <option key={st.id} value={st.id}>{st.firstName} {st.lastName}{st.class ? ` · ${st.class.name}` : ''}</option>
                          ))}
                        </select>
                      </td>
                      <td>{s.battery == null ? '—' : <Badge tone={s.battery < 20 ? 'alert' : 'ok'}>{s.battery}%</Badge>}</td>
                      <td className="small">{dateTimeCairo(s.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No straps registered yet.</Empty>
          )}
        </Card>
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Register a strap">
            <form className="stack" onSubmit={addStrap}>
              <Field label="Strap address (MAC)" id="sm"><input id="sm" className="input" required placeholder="DC:0D:30:AA:4A:11" value={strap.mac} onChange={(e) => setStrap({ ...strap, mac: e.target.value })} /></Field>
              <Field label="Student (optional)" id="ss">
                <select id="ss" className="input" value={strap.studentId} onChange={(e) => setStrap({ ...strap, studentId: e.target.value })}>
                  <option value="">Spare</option>
                  {students.data?.filter((st) => !withStrap.has(st.id)).map((st) => <option key={st.id} value={st.id}>{st.firstName} {st.lastName}</option>)}
                </select>
              </Field>
              <button className="btn primary" type="submit" disabled={act.busy}>Register</button>
            </form>
          </Card>
          <Card title="Detection rules">
            <form className="stack" onSubmit={saveRules}>
              <div className="form-row">
                <Field label="Present if in the room for (%)" id="ps"><input id="ps" className="input" type="number" min={10} max={100} value={ruleForm.presentShare} onChange={(e) => setRuleForm({ ...ruleForm, presentShare: Number(e.target.value) })} /></Field>
                <Field label="Late after (minutes)" id="la"><input id="la" className="input" type="number" min={0} value={ruleForm.lateAfterMinutes} onChange={(e) => setRuleForm({ ...ruleForm, lateAfterMinutes: Number(e.target.value) })} /></Field>
              </div>
              <div className="form-row">
                <Field label="Gate signal (dBm)" id="gs"><input id="gs" className="input" type="number" max={0} min={-120} value={ruleForm.gateRssi} onChange={(e) => setRuleForm({ ...ruleForm, gateRssi: Number(e.target.value) })} /></Field>
                <Field label="Room signal (dBm)" id="rs"><input id="rs" className="input" type="number" max={0} min={-120} value={ruleForm.roomRssi} onChange={(e) => setRuleForm({ ...ruleForm, roomRssi: Number(e.target.value) })} /></Field>
              </div>
              <span className="muted small">A strap heard by several gateways belongs to the loudest one, so rooms don’t count straps through the wall.</span>
              <button className="btn" type="submit" disabled={act.busy}>Save rules</button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
