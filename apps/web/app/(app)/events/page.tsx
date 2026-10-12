'use client';
import { useState } from 'react';
import { cairoDate, cairoHm } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { EventModal } from '@/components/EventModal';
import { Empty, ErrorNote, PageHead, Tabs, Tag } from '@/components/ui';

/** School events for parents: written for an audience, published, and given a gallery of photos. */
export default function EventsPage() {
  const { t, x, day } = useI18n();
  const events = useApi<any[]>('/events');
  const [tab, setTab] = useState<'UPCOMING' | 'PAST'>('UPCOMING');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const now = Date.now();
  const all = events.data ?? [];
  const upcoming = all.filter((e) => new Date(e.endsAt).getTime() >= now);
  const past = all.filter((e) => new Date(e.endsAt).getTime() < now).reverse();
  const shown = tab === 'UPCOMING' ? upcoming : past;

  return (
    <>
      <PageHead sub={t.act.eventsSub} title={t.nav.events} actions={<button type="button" className="btn primary" onClick={() => setEditing('new')}>{t.act.newEvent}</button>} />
      <div className="toolbar">
        <Tabs label={t.nav.events} value={tab} onChange={setTab} items={[['UPCOMING', `${t.act.upcoming} · ${upcoming.length}`], ['PAST', `${t.act.past} · ${past.length}`]]} />
      </div>
      <ErrorNote error={events.error && x(events.error)} />
      <section className="panel">
        {shown.length ? (
          shown.map((e) => (
            <article key={e.id} className="list-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span className="stack" style={{ flex: '1 1 280px', gap: 3 }}>
                <button type="button" className="btn link" style={{ justifyContent: 'flex-start', fontWeight: 600, fontSize: 16, padding: 0, color: 'var(--ink)' }} onClick={() => setEditing(e)}>{e.title}</button>
                <span className="small muted">
                  {x(day(cairoDate(e.startsAt)))}{e.allDay ? '' : <> · <bdi dir="ltr">{cairoHm(e.startsAt)}–{cairoHm(e.endsAt)}</bdi></>}
                  {e.place ? ` · ${e.place}` : ''} · {t.audience.summary(e.audience.kind, (e.audience.ids ?? []).length)}
                </span>
              </span>
              <span className="row wrap" style={{ gap: 8 }}>
                {e.photoCount > 0 && <span className="small muted">{t.act.photosN(e.photoCount)}</span>}
                <Tag tone={e.publishedAt ? 'P' : ''}>{e.publishedAt ? t.act.published : t.act.draft}</Tag>
              </span>
            </article>
          ))
        ) : (
          <Empty title={events.loading ? undefined : t.act.noEvents}>{events.loading ? t.common.loading : t.act.noEventsSub}</Empty>
        )}
      </section>
      {editing && (
        <EventModal
          event={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved, close) => {
            await events.reload();
            if (close) setEditing(null);
            else if (saved && editing === 'new') setEditing(saved);
          }}
        />
      )}
    </>
  );
}
