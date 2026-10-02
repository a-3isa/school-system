'use client';
import Link from 'next/link';
import { useState } from 'react';
import { dateTimeCairo, post, timeCairo, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { EXCEPTION_TONE } from '@/components/Lessons';
import { Empty, ErrorNote, Field, PageHead, Tabs, Tag, toast } from '@/components/ui';

export default function ExceptionsPage() {
  const { t, x } = useI18n();
  const [date, setDate] = useState(todayCairo());
  const [tab, setTab] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const open = useApi<any[]>(`/attendance/exceptions?date=${date}&status=OPEN`);
  const resolved = useApi<any[]>(`/attendance/exceptions?date=${date}&status=RESOLVED`);
  const act = useAction();
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function resolve(id: string) {
    if (await act.run(() => post(`/attendance/exceptions/${id}/resolve`, { note: note.trim() || undefined }))) {
      toast(t.exc.resolvedToast);
      setResolving(null);
      setNote('');
      await Promise.all([open.reload(), resolved.reload()]);
    }
  }

  const list = (tab === 'OPEN' ? open : resolved).data;

  return (
    <>
      <PageHead
        sub={t.exc.sub}
        title={t.nav.exceptions}
        actions={
          <>
            <Field label={t.common.date} id="day">
              <input id="day" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value || todayCairo())} />
            </Field>
            <Tabs
              label={t.nav.exceptions}
              value={tab}
              onChange={(v) => { setTab(v); setResolving(null); }}
              items={[['OPEN', t.exc.openN(open.data?.length ?? 0)], ['RESOLVED', t.exc.resolvedN(resolved.data?.length ?? 0)]]}
            />
          </>
        }
      />
      <ErrorNote error={open.error ?? act.error} />
      <section className="panel">
        {list?.length ? (
          list.map((e) => (
            <article key={e.id} className="list-row" style={{ gap: 12, padding: '18px 20px' }}>
              <div className="row wrap" style={{ gap: 20, alignItems: 'flex-start' }}>
                <div className="stack" style={{ flex: '1 1 420px', minWidth: 0 }}>
                  <span className="row wrap">
                    <Tag tone={EXCEPTION_TONE[e.type]}>{t.exc.type[e.type as keyof typeof t.exc.type] ?? e.type}</Tag>
                    <span className="small cap num">{timeCairo(e.createdAt)}</span>
                    {e.student && <span className="small muted">{x(`${e.student.firstName} ${e.student.lastName}${e.student.class ? ` · ${e.student.class.name}` : ''}`)}</span>}
                  </span>
                  <span style={{ fontSize: 16, lineHeight: 1.5, textWrap: 'pretty' }}>{x(e.message)}</span>
                  {e.status === 'RESOLVED' && (
                    <span className="small" style={{ color: 'var(--p)' }}>{x(t.exc.resolvedAt(dateTimeCairo(e.resolvedAt), e.note))}</span>
                  )}
                </div>
                <div className="row" style={{ flex: '0 0 auto' }}>
                  {e.student && <Link className="btn" href={`/students/${e.student.id ?? e.studentId}`}>{t.exc.openStudent}</Link>}
                  {e.status === 'OPEN' && resolving !== e.id && (
                    <button type="button" className="btn primary" onClick={() => { setResolving(e.id); setNote(''); }}>{t.exc.resolve}</button>
                  )}
                </div>
              </div>
              {resolving === e.id && (
                <form className="row wrap" style={{ alignItems: 'flex-end', background: 'var(--bg)', borderRadius: 8, padding: 12 }} onSubmit={(ev) => { ev.preventDefault(); void resolve(e.id); }}>
                  <Field label={t.exc.note} id={`note-${e.id}`} className="grow">
                    <input id={`note-${e.id}`} className="input" autoFocus value={note} placeholder={t.exc.notePh} onChange={(ev) => setNote(ev.target.value)} />
                  </Field>
                  <button type="submit" className="btn primary" disabled={act.busy}>{t.exc.markResolved}</button>
                  <button type="button" className="btn" onClick={() => setResolving(null)}>{t.common.cancel}</button>
                </form>
              )}
            </article>
          ))
        ) : list ? (
          <Empty title={tab === 'OPEN' ? t.exc.allClear : t.exc.noneResolved}>{tab === 'OPEN' ? t.exc.allClearSub : undefined}</Empty>
        ) : (
          <Empty>{t.common.loading}</Empty>
        )}
      </section>
    </>
  );
}
