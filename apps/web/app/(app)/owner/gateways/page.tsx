'use client';
import { FormEvent, useState } from 'react';
import { dateTimeCairo, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, Field, PageHead, Pill, Section } from '@/components/ui';

export default function OwnerGatewaysPage() {
  const { t } = useI18n();
  const gateways = useApi<any[]>('/owner/gateways');
  const act = useAction();
  const [serial, setSerial] = useState('');
  const [created, setCreated] = useState<{ id?: string; serial: string; claimCode: string; secret: string } | null>(null);

  async function register(e: FormEvent) {
    e.preventDefault();
    await act.run(async () => {
      setCreated(await post('/owner/gateways', { serial }));
      setSerial('');
      await gateways.reload();
    });
  }

  async function newSecret(id: string, serial: string) {
    if (!confirm(t.ogw.confirmSecret(serial))) return;
    await act.run(async () => setCreated(await post(`/owner/gateways/${id}/secret`)));
  }

  return (
    <>
      <PageHead sub={t.ogw.sub} title={t.nav.gateways} />
      <ErrorNote error={act.error ?? gateways.error} />
      <Section title={t.ogw.register}>
        <form className="form" onSubmit={register}>
          <Field label={t.ogw.serial} id="s"><input id="s" className="input mono" dir="ltr" required placeholder="NVG-2026-00000" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
          <div className="form-actions"><button className="btn primary" type="submit" disabled={act.busy}>{t.ogw.register}</button></div>
        </form>
      </Section>
      {created && (
        <Section title={t.ogw.ready}>
          <div className="secret">
            <span>{t.ogw.serial}<b className="mono" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}><bdi dir="ltr">{created.serial}</bdi></b></span>
            <span>{t.ogw.claimCode}<b className="code"><bdi dir="ltr">{created.claimCode}</bdi></b><span className="small cap">{t.ogw.claimHelp}</span></span>
            <span className="once">{t.ogw.secretOnce}<code dir="ltr">{created.secret}</code></span>
          </div>
        </Section>
      )}
      <div className="panel scroll">
        {gateways.data?.length ? (
          <table style={{ minWidth: 760 }}>
            <thead><tr><th>{t.ogw.serial}</th><th>{t.owner.school}</th><th>{t.ogw.status}</th><th>{t.ogw.claimCode}</th><th>{t.devices.lastSeen}</th><th /></tr></thead>
            <tbody>
              {gateways.data.map((g) => (
                <tr key={g.id}>
                  <td className="mono"><bdi dir="ltr">{g.serial}</bdi>{g.name && <span className="sub" style={{ fontFamily: 'var(--sans)' }}>{g.name}</span>}</td>
                  <td>{g.school?.name ?? '—'}</td>
                  <td>{g.school ? <Pill tone="P" glyph="✓">{t.ogw.claimed}</Pill> : <Pill tone="L" glyph="◔">{t.ogw.waiting}</Pill>}</td>
                  <td className="mono"><bdi dir="ltr">{g.claimCode}</bdi></td>
                  <td className="small num">{g.lastSeenAt ? dateTimeCairo(g.lastSeenAt) : t.devices.never}</td>
                  <td><button type="button" className="btn small" onClick={() => newSecret(g.id, g.serial)} disabled={act.busy}>{t.ogw.newSecret}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{t.ogw.none}</Empty>
        )}
      </div>
    </>
  );
}
