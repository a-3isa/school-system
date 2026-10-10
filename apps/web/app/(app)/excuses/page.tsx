'use client';
import Link from 'next/link';
import { useState } from 'react';
import { blobUrl, dateTimeCairo, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { EXCUSE_TONE } from '@/components/Lessons';
import { Empty, ErrorNote, Field, PageHead, Tabs, Tag, toast } from '@/components/ui';

type Tab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

export default function ExcusesPage() {
  const { t, x } = useI18n();
  const [tab, setTab] = useState<Tab>('PENDING');
  const list = useApi<any[]>(`/excuses${tab === 'ALL' ? '' : `?status=${tab}`}`);
  const waiting = useApi<any[]>('/excuses?status=PENDING');
  const act = useAction();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function decide(id: string, approve: boolean) {
    if (await act.run(() => post(`/excuses/${id}/decision`, { approve, note: note.trim() || undefined }))) {
      toast(approve ? t.excuses.accepted : t.excuses.rejected);
      setRejecting(null);
      setNote('');
      await Promise.all([list.reload(), waiting.reload()]);
    }
  }

  async function openFile(id: string) {
    const url = await blobUrl(`/excuses/${id}/file`);
    window.open(url, '_blank', 'noopener');
  }

  return (
    <>
      <PageHead
        sub={t.excuses.sub}
        title={t.nav.excuses}
        actions={
          <Tabs
            label={t.nav.excuses}
            value={tab}
            onChange={(v) => { setTab(v); setRejecting(null); }}
            items={[['PENDING', t.excuses.waitingN(waiting.data?.length ?? 0)], ['APPROVED', t.excuses.tabs.APPROVED], ['REJECTED', t.excuses.tabs.REJECTED], ['ALL', t.excuses.tabs.ALL]]}
          />
        }
      />
      <ErrorNote error={list.error ?? act.error} />
      <section className="panel">
        {list.data?.length ? (
          list.data.map((e) => (
            <article key={e.id} className="list-row" style={{ gap: 12, padding: '18px 20px' }}>
              <div className="row wrap" style={{ gap: 20, alignItems: 'flex-start' }}>
                <div className="stack" style={{ flex: '1 1 420px', minWidth: 0 }}>
                  <span className="row wrap">
                    <Tag tone={EXCUSE_TONE[e.status]}>{t.excuses.status[e.status] ?? e.status}</Tag>
                    <Tag tone="N">{t.excuses.reason[e.reason] ?? e.reason}</Tag>
                    <strong style={{ fontSize: 16 }}>{x(`${e.student.firstName} ${e.student.lastName}`)}</strong>
                    {e.student.class && <span className="small muted">{x(e.student.class.name)}</span>}
                  </span>
                  <span className="num" style={{ fontSize: 15 }}>{t.excuses.days(e.fromDate.slice(0, 10), e.toDate.slice(0, 10))}</span>
                  {e.note && <span style={{ fontSize: 15, lineHeight: 1.5, textWrap: 'pretty' }}>“{x(e.note)}”</span>}
                  <span className="small muted">{x(t.excuses.sentBy(e.submittedBy.name, dateTimeCairo(e.createdAt)))}{e.submittedBy.phone ? ` · ${e.submittedBy.phone}` : ''}</span>
                  {e.status !== 'PENDING' && (
                    <span className="small" style={{ color: e.status === 'APPROVED' ? 'var(--p)' : 'var(--a)' }}>{x(t.excuses.decided(dateTimeCairo(e.decidedAt), e.decisionNote))}</span>
                  )}
                </div>
                <div className="row wrap" style={{ flex: '0 0 auto' }}>
                  {e.hasFile ? <button type="button" className="btn" onClick={() => void openFile(e.id)}>{t.excuses.openFile}</button> : <span className="small muted">{t.excuses.noFile}</span>}
                  <Link className="btn" href={`/students/${e.student.id}`}>{t.excuses.studentFile}</Link>
                  {e.status === 'PENDING' && rejecting !== e.id && (
                    <>
                      <button type="button" className="btn primary" disabled={act.busy} onClick={() => void decide(e.id, true)}>{t.excuses.accept}</button>
                      <button type="button" className="btn" onClick={() => { setRejecting(e.id); setNote(''); }}>{t.excuses.reject}</button>
                    </>
                  )}
                </div>
              </div>
              {rejecting === e.id && (
                <form className="row wrap" style={{ alignItems: 'flex-end', background: 'var(--bg)', borderRadius: 8, padding: 12 }} onSubmit={(ev) => { ev.preventDefault(); void decide(e.id, false); }}>
                  <Field label={t.excuses.rejectWhy} id={`why-${e.id}`} className="grow">
                    <input id={`why-${e.id}`} className="input" autoFocus required value={note} onChange={(ev) => setNote(ev.target.value)} />
                  </Field>
                  <button type="submit" className="btn primary" disabled={act.busy || !note.trim()}>{t.excuses.confirmReject}</button>
                  <button type="button" className="btn" onClick={() => setRejecting(null)}>{t.common.cancel}</button>
                </form>
              )}
            </article>
          ))
        ) : list.data ? (
          <Empty title={t.excuses.none}>{t.excuses.noneSub}</Empty>
        ) : (
          <Empty>{t.common.loading}</Empty>
        )}
      </section>
    </>
  );
}
