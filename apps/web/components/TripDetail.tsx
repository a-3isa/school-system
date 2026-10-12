'use client';
import { useState } from 'react';
import { dateTimeCairo, post, todayCairo } from '@/lib/api';
import { useAction, useApi, useEvery } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, Note, PageHead, Tabs, Tag, toast, Tone } from './ui';

export const TRIP_TONE: Record<string, Tone> = { DRAFT: '', OPEN: 'L', CLOSED: 'P', CANCELLED: 'A' };

type Filter = 'ALL' | 'GIVEN' | 'DECLINED' | 'WAITING';

/** Tap a student when they get on the bus, and again when they are back. */
function Headcount({ trip }: { trip: any }) {
  const { t, x, lang } = useI18n();
  const count = useApi<any>(`/trips/${trip.id}/headcount`);
  const act = useAction();
  useEvery(15_000, () => count.reload(), true);
  const rows: any[] = count.data?.rows ?? [];

  async function tap(r: any) {
    if (r.backAt) return;
    if (await act.run(() => post(`/trips/${trip.id}/headcount`, { studentId: r.studentId, leg: r.leftAt ? 'BACK' : 'LEFT' }))) await count.reload();
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorNote error={(act.error ?? count.error) && x((act.error ?? count.error)!)} />
      <p className="small muted" style={{ margin: 0 }}>{t.act.headcountSub}</p>
      <div className="check-kpis">
        <span><b>{count.data ? `${count.data.left}` : '–'}</b>{t.act.onBus(count.data?.left ?? 0, count.data?.going ?? 0)}</span>
        <span><b>{count.data ? `${count.data.back}` : '–'}</b>{t.act.backN(count.data?.back ?? 0, count.data?.going ?? 0)}</span>
      </div>
      {rows.length ? (
        <div className="headcount">
          {rows.map((r) => (
            <button key={r.studentId} type="button" className={`count-btn${r.backAt ? ' back' : r.leftAt ? ' left' : ''}`} disabled={act.busy || !!r.backAt} onClick={() => void tap(r)}>
              <b>{x(lang === 'ar' && r.nameAr ? r.nameAr : r.name)}</b>
              <span className="small">{r.class && x(r.class)}</span>
              <span>{r.backAt ? `✓ ${t.act.back}` : r.leftAt ? `● ${t.act.left}` : '○'}</span>
            </button>
          ))}
        </div>
      ) : (
        <Empty>{count.loading ? t.common.loading : t.act.nobodyGoing}</Empty>
      )}
    </div>
  );
}

/** Who has answered, with the phone numbers to chase those who haven't. */
function Consents({ trip, canEdit, onChanged }: { trip: any; canEdit: boolean; onChanged: () => void }) {
  const { t, x, lang } = useI18n();
  const sheet = useApi<any>(`/trips/${trip.id}/consents`);
  const act = useAction();
  const [filter, setFilter] = useState<Filter>('ALL');
  const rows: any[] = sheet.data?.rows ?? [];
  const status = (r: any) => r.decision ?? 'WAITING';
  const shown = rows.filter((r) => filter === 'ALL' || status(r) === filter);
  const waiting = rows.filter((r) => !r.decision);

  async function copyWaiting() {
    const phones = [...new Set(waiting.flatMap((r) => r.parents.filter((p: any) => !p.restricted && p.phone).map((p: any) => p.phone as string)))];
    try {
      await navigator.clipboard.writeText(phones.join('\n'));
      toast(t.act.copied(phones.length));
    } catch {
      toast(phones.join(', '));
    }
  }
  async function setPaid(r: any, paid: boolean) {
    if (await act.run(() => post(`/trips/${trip.id}/students/${r.studentId}/paid`, { paid }))) {
      await sheet.reload();
      onChanged();
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorNote error={(act.error ?? sheet.error) && x((act.error ?? sheet.error)!)} />
      <div className="toolbar">
        <Tabs label={t.act.answerCol} value={filter} onChange={setFilter} items={(['ALL', 'GIVEN', 'DECLINED', 'WAITING'] as Filter[]).map((f): [Filter, string] => [f, `${t.act.tabs[f]} · ${f === 'ALL' ? rows.length : rows.filter((r) => status(r) === f).length}`])} />
        <button type="button" className="btn" disabled={!waiting.length} onClick={() => void copyWaiting()}>{t.act.copyWaiting}</button>
      </div>
      <section className="panel scroll">
        {shown.length ? (
          <table>
            <thead><tr><th>{t.act.student}</th><th>{t.common.class}</th><th>{t.act.answerCol}</th><th>{t.act.signedBy}</th><th>{t.act.callParents}</th>{trip.fee != null && <th>{t.act.paid}</th>}</tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.studentId}>
                  <td className="strong">{x(lang === 'ar' && r.nameAr ? r.nameAr : r.name)}{r.note && <span className="sub">{t.act.noteCol}: {r.note}</span>}</td>
                  <td>{r.class && x(r.class)}</td>
                  <td><Tag tone={r.decision === 'GIVEN' ? 'P' : r.decision === 'DECLINED' ? 'A' : ''}>{t.act.answer[status(r)]}</Tag></td>
                  <td>{r.signedName && <>{r.signedName}<span className="sub">{r.signedBy}</span></>}</td>
                  <td>{!r.decision && r.parents.filter((p: any) => !p.restricted).map((p: any) => <span key={p.phone ?? p.name} className="sub" style={{ display: 'block' }}>{p.name} <bdi dir="ltr">{p.phone}</bdi></span>)}</td>
                  {trip.fee != null && (
                    <td>
                      {r.decision === 'GIVEN' && (canEdit
                        ? <button type="button" className="chip-toggle" aria-pressed={!!r.paidAt} disabled={act.busy} onClick={() => void setPaid(r, !r.paidAt)}>{r.paidAt ? `✓ ${t.act.paid}` : t.act.notPaid}</button>
                        : r.paidAt ? <Tag tone="P">✓ {t.act.paid}</Tag> : <Tag>{t.act.notPaid}</Tag>)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{sheet.loading ? t.common.loading : filter === 'WAITING' ? t.act.everyoneAnswered : t.act.nobodyGoing}</Empty>
        )}
      </section>
    </div>
  );
}

/** One trip: its state and the buttons that move it on, who has answered, and the headcount on the day. */
export function TripDetail({ trip, onBack, onEdit, onChanged }: { trip: any; onBack: () => void; onEdit: () => void; onChanged: () => void | Promise<void> }) {
  const { t, x, staff, day, lang } = useI18n();
  const { me } = useSession();
  const act = useAction();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const isLeader = trip.leader?.id === me.id;
  const [counting, setCounting] = useState(false);
  const date = String(trip.date).slice(0, 10);
  const today = date === todayCairo();
  const live = trip.status === 'OPEN' || trip.status === 'CLOSED';

  async function run(path: string, ask: string, done: string) {
    if (!confirm(ask)) return;
    if (await act.run(() => post(`/trips/${trip.id}/${path}`))) {
      toast(done);
      await onChanged();
    }
  }

  return (
    <>
      <PageHead
        crumb={<button type="button" className="btn link" onClick={onBack}>{t.act.allTrips}</button>}
        sub={<>{x(day(date))} · <bdi dir="ltr">{trip.departTime}–{trip.returnTime}</bdi> · {trip.destination}</>}
        title={trip.title}
        actions={isAdmin ? (
          <>
            {(trip.status === 'DRAFT' || trip.status === 'OPEN') && <button type="button" className="btn" onClick={onEdit}>{t.act.editTrip}</button>}
            {trip.status === 'DRAFT' && <button type="button" className="btn primary" disabled={act.busy} onClick={() => void run('open', t.act.openConfirm(trip.counts.students), t.act.opened)}>{t.act.open}</button>}
            {trip.status === 'OPEN' && <button type="button" className="btn primary" disabled={act.busy} onClick={() => void run('close', t.act.closeConfirm, t.act.closed)}>{t.act.close}</button>}
            {trip.status !== 'CANCELLED' && <button type="button" className="btn" disabled={act.busy} onClick={() => void run('cancel', t.act.cancelConfirm(trip.title), t.act.cancelled)}>{t.act.cancel}</button>}
          </>
        ) : undefined}
      />
      <ErrorNote error={act.error && x(act.error)} />
      <div className="row wrap" style={{ gap: 12 }}>
        <Tag tone={TRIP_TONE[trip.status]}>{t.act.status[trip.status]}</Tag>
        {trip.classes.map((c: any) => <Tag key={c.id}>{x(c.name)}</Tag>)}
        {trip.fee != null && <Tag>{t.act.feeTrip(trip.fee)}</Tag>}
        {trip.leader && <span className="small muted">{t.act.leader}: {staff(trip.leader)}</span>}
      </div>
      <span className="small muted">{t.act.consentsLine(trip.counts.given, trip.counts.declined, trip.counts.waiting)}</span>
      {trip.description && <p style={{ margin: 0, maxWidth: 680 }}>{trip.description}</p>}
      {trip.status === 'OPEN' && <Note>{t.act.deadline(x(dateTimeCairo(trip.consentBy)))}</Note>}
      {trip.status === 'CANCELLED' && <Note tone="warn">{t.act.status.CANCELLED}</Note>}
      {live && today && (isAdmin || isLeader) && (
        <div className="row"><button type="button" className={`btn${counting ? '' : ' primary'}`} onClick={() => setCounting(!counting)}>{counting ? t.act.consentsTab : t.act.headcountToday}</button></div>
      )}
      {counting ? <Headcount trip={trip} /> : trip.status !== 'DRAFT' ? <Consents trip={trip} canEdit={isAdmin} onChanged={() => void onChanged()} /> : <Empty>{t.act.noTripsSub}</Empty>}
    </>
  );
}
