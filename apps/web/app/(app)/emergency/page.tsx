'use client';
import { FormEvent, useState } from 'react';
import { dateTimeCairo, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, Field, PageHead, Tag, toast } from '@/components/ui';

export default function EmergencyPage() {
  const { t, x } = useI18n();
  const past = useApi<any[]>('/announcements?priority=EMERGENCY');
  const act = useAction();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [understood, setUnderstood] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!understood || !title.trim() || !body.trim()) return;
    if (await act.run(async () => {
      const sent = await post('/announcements/emergency', { title: title.trim(), body: body.trim() });
      toast(t.emg.sent(sent.recipients));
    })) {
      setTitle('');
      setBody('');
      setUnderstood(false);
      await past.reload();
    }
  }

  return (
    <>
      <PageHead sub={t.emg.sub} title={t.nav.emergency} />
      <p className="warning-panel" role="note">{t.emg.warning}</p>
      <ErrorNote error={act.error && x(act.error)} />
      <form className="panel" onSubmit={(e) => void submit(e)} style={{ padding: 20, display: 'grid', gap: 16, maxInlineSize: 720 }}>
        <Field label={t.emg.fieldTitle} id="emg-title">
          <input id="emg-title" className="input" maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t.emg.fieldBody} id="emg-body">
          <textarea id="emg-body" className="input" rows={5} maxLength={4000} required value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>{t.emg.understand}</span>
        </label>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={act.busy || !understood || !title.trim() || !body.trim()}>{t.emg.send}</button>
        </div>
      </form>
      <h2 style={{ marginBlock: '28px 12px', fontSize: 18 }}>{t.emg.past}</h2>
      <section className="panel">
        {past.data?.length ? (
          past.data.map((a) => (
            <article key={a.id} className="list-row" style={{ padding: '16px 20px' }}>
              <span className="row wrap"><Tag tone="A">{t.ann.urgent}</Tag><strong>{x(a.title)}</strong></span>
              <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{x(a.body)}</span>
              <span className="small muted">{dateTimeCairo(a.sentAt)} · {t.emg.confirmed(a.acknowledgedCount, a.recipients)}</span>
            </article>
          ))
        ) : past.data ? (
          <Empty>{t.emg.none}</Empty>
        ) : (
          <Empty>{t.common.loading}</Empty>
        )}
      </section>
    </>
  );
}
