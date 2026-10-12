'use client';
import { useState } from 'react';
import { todayCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { TRIP_TONE, TripDetail } from '@/components/TripDetail';
import { TripModal } from '@/components/TripModal';
import { Empty, ErrorNote, PageHead, Tabs, Tag, toast } from '@/components/ui';

/** School trips: planned by Student Affairs, answered by parents with a signed permission slip, counted on the day. */
export default function TripsPage() {
  const { me } = useSession();
  const { t, x, day } = useI18n();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const trips = useApi<any[]>('/trips');
  const [tab, setTab] = useState<'UPCOMING' | 'PAST'>('UPCOMING');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const today = todayCairo();
  const all = trips.data ?? [];
  const current = openId ? all.find((tr) => tr.id === openId) : undefined;
  const upcoming = all.filter((tr) => String(tr.date).slice(0, 10) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const past = all.filter((tr) => String(tr.date).slice(0, 10) < today);
  const shown = tab === 'UPCOMING' ? upcoming : past;

  const modal = editing && (
    <TripModal
      trip={editing === 'new' ? null : editing}
      onClose={() => setEditing(null)}
      onSaved={async (saved) => {
        toast(editing === 'new' ? t.act.tripCreated : t.act.tripSaved);
        setEditing(null);
        await trips.reload();
        if (editing === 'new' && saved?.id) setOpenId(saved.id);
      }}
    />
  );

  if (current) {
    return (
      <>
        <TripDetail trip={current} onBack={() => setOpenId(null)} onEdit={() => setEditing(current)} onChanged={() => trips.reload()} />
        {modal}
      </>
    );
  }

  return (
    <>
      <PageHead
        sub={t.act.tripsSub}
        title={t.nav.trips}
        actions={isAdmin ? <button type="button" className="btn primary" onClick={() => setEditing('new')}>{t.act.newTrip}</button> : undefined}
      />
      <div className="toolbar">
        <Tabs label={t.nav.trips} value={tab} onChange={setTab} items={[['UPCOMING', `${t.act.upcoming} · ${upcoming.length}`], ['PAST', `${t.act.past} · ${past.length}`]]} />
      </div>
      <ErrorNote error={trips.error && x(trips.error)} />
      <section className="panel">
        {shown.length ? (
          shown.map((tr) => (
            <article key={tr.id} className="list-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span className="stack" style={{ flex: '1 1 280px', gap: 3 }}>
                <button type="button" className="btn link" style={{ justifyContent: 'flex-start', fontWeight: 600, fontSize: 16, padding: 0, color: 'var(--ink)' }} onClick={() => setOpenId(tr.id)}>{tr.title}</button>
                <span className="small muted">{x(day(String(tr.date).slice(0, 10)))} · <bdi dir="ltr">{tr.departTime}–{tr.returnTime}</bdi> · {tr.destination}</span>
                <span className="row wrap" style={{ gap: 6 }}>{tr.classes.map((c: any) => <Tag key={c.id}>{x(c.name)}</Tag>)}</span>
              </span>
              <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                <Tag tone={TRIP_TONE[tr.status]}>{t.act.status[tr.status]}</Tag>
                {tr.status !== 'DRAFT' && tr.status !== 'CANCELLED' && <span className="small muted">{t.act.consentsLine(tr.counts.given, tr.counts.declined, tr.counts.waiting)}</span>}
              </span>
            </article>
          ))
        ) : (
          <Empty title={trips.loading ? undefined : t.act.noTrips}>{trips.loading ? t.common.loading : t.act.noTripsSub}</Empty>
        )}
      </section>
      {modal}
    </>
  );
}
