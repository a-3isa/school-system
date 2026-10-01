'use client';
import { FormEvent, useState } from 'react';
import { dateTimeCairo, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { Badge, Card, Empty, ErrorNote, Field, PageHead } from '@/components/ui';

export default function OwnerGatewaysPage() {
  const gateways = useApi<any[]>('/owner/gateways');
  const act = useAction();
  const [serial, setSerial] = useState('');
  const [created, setCreated] = useState<{ serial: string; claimCode: string; secret: string } | null>(null);

  async function register(e: FormEvent) {
    e.preventDefault();
    await act.run(async () => {
      setCreated(await post('/owner/gateways', { serial }));
      setSerial('');
      await gateways.reload();
    });
  }

  async function newSecret(id: string, serial: string) {
    if (!confirm(`Give ${serial} a new secret? The old one stops working at once.`)) return;
    await act.run(async () => setCreated(await post(`/owner/gateways/${id}/secret`)));
  }

  return (
    <>
      <PageHead eyebrow="Owner console" title="Gateways" sub="Register each gateway before it ships. Print the claim code on its label; write the secret into its settings." />
      <ErrorNote error={act.error ?? gateways.error} />
      {created && (
        <div className="notice warn">
          <b>{created.serial}</b> is ready. Claim code <b>{created.claimCode}</b> · secret <code>{created.secret}</code>. Copy the secret now; it won’t be shown again.
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <Card title="All gateways" pad={false}>
          {gateways.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Serial</th><th>Claim code</th><th>School</th><th>Name</th><th>Last seen</th><th /></tr></thead>
                <tbody>
                  {gateways.data.map((g) => (
                    <tr key={g.id}>
                      <td className="num">{g.serial}</td>
                      <td className="num">{g.claimCode}</td>
                      <td>{g.school?.name ?? <Badge>Not claimed</Badge>}</td>
                      <td>{g.name ?? '—'}</td>
                      <td className="small">{dateTimeCairo(g.lastSeenAt)}</td>
                      <td><button className="btn small" onClick={() => newSecret(g.id, g.serial)} disabled={act.busy}>New secret</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No gateways registered yet.</Empty>
          )}
        </Card>
        <Card title="Register a gateway">
          <form className="stack" onSubmit={register}>
            <Field label="Serial" id="s"><input id="s" className="input" required placeholder="NV-GW-0001" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
            <button className="btn primary" type="submit" disabled={act.busy}>Register</button>
          </form>
        </Card>
      </div>
    </>
  );
}
