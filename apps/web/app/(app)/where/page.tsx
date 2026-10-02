'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { timeCairo } from '@/lib/api';
import { useApi, useEvery } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Dict } from '@/lib/strings';
import { Empty, ErrorNote, Kpi, LiveStamp, PageHead, Section, Tabs } from '@/components/ui';

type State = 'here' | 'recent' | 'missing' | 'left' | 'away' | 'notSeen' | 'noStrap';
type Place = { gatewayId: string; name: string; kind: string | null; room: string | null };
type Student = { id: string; firstName: string; lastName: string; class: { id: string; name: string } | null; state: State; place: Place | null; seenAt: string | null; arrivedAt: string | null };

const REFRESH_MS = 10_000;
const minsSince = (iso: string | null, now: number) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000)) : 0);

/** A child's name as a chip; it shows how long ago they were heard once that isn't fresh. */
function Chip({ s, now, extra, tone }: { s: Student; now: number; extra?: string; tone?: 'late' | 'alert' }) {
  const { t, x } = useI18n();
  const m = minsSince(s.seenAt, now);
  const stale = !extra && (s.state === 'recent' || s.state === 'missing') && m >= 3;
  const label = extra ?? (stale ? t.where.minAgo(m) : '');
  return (
    <Link href={`/students/${s.id}`} className={`namechip${stale || tone === 'alert' ? ' stale' : ''}`}>
      {s.firstName} {s.lastName}
      {label && <em className={tone ?? (stale ? (m >= 10 ? 'alert' : 'late') : '')}>{x(label)}</em>}
    </Link>
  );
}

function Panel({ title, meta, note, dashed, children }: { title: string; meta?: string; note?: string; dashed?: boolean; children?: React.ReactNode }) {
  const { x } = useI18n();
  return (
    <div className={`place${dashed ? ' dashed' : ''}`}>
      <div className="place-head"><b>{x(title)}</b>{meta && <span>{x(meta)}</span>}</div>
      {note && <span className="small muted">{note}</span>}
      {children && <div className="chips">{children}</div>}
    </div>
  );
}

export default function WherePage() {
  const { t, x } = useI18n();
  const live = useApi<{ at: string; schoolHours: boolean; places: Place[]; students: Student[] }>('/locations');
  const classes = useApi<any[]>('/classes');
  const rooms = useApi<any[]>('/rooms');
  const [classId, setClassId] = useState('');
  const [q, setQ] = useState('');
  useEvery(REFRESH_MS, live.reload);

  const now = live.data ? Date.parse(live.data.at) : Date.now();
  const students = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (live.data?.students ?? []).filter(
      (s) => (!classId || s.class?.id === classId) && (!needle || `${s.firstName} ${s.lastName}`.toLowerCase().includes(needle)),
    );
  }, [live.data, classId, q]);

  const of = (...states: State[]) => students.filter((s) => states.includes(s.state));
  const inPlace = (p: Place) => students.filter((s) => (s.state === 'here' || s.state === 'recent' || s.state === 'missing') && s.place?.gatewayId === p.gatewayId);
  const places = [...(live.data?.places ?? [])].sort((a, b) => (a.kind === 'GATE' ? -1 : b.kind === 'GATE' ? 1 : a.name.localeCompare(b.name)));
  // Rooms with no gateway can't hear straps; say so instead of showing them empty.
  const heard = new Set(places.map((p) => p.room).filter(Boolean));
  const deaf = (rooms.data ?? []).filter((r) => !heard.has(r.name));
  const missing = of('missing');
  const kind = (p: Place) => (p.kind === 'GATE' ? t.where.gate : p.room ?? t.where.kinds[(p.kind ?? 'ROOM') as keyof Dict['where']['kinds']]);

  return (
    <>
      <PageHead sub={t.where.sub} title={t.nav.where} actions={<LiveStamp at={live.loadedAt} />} />
      <div className="row wrap" style={{ gap: 12 }}>
        <input type="search" className="input" aria-label={t.common.searchName} placeholder={t.common.searchName} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 280px' }} />
        <Tabs label={t.common.class} value={classId} onChange={setClassId} items={[['', t.common.allClasses], ...(classes.data ?? []).map((c): [string, string] => [c.id, c.name])]} />
      </div>
      <ErrorNote error={live.error} />
      <div className="kpis">
        <Kpi label={t.where.kFresh} value={live.data ? of('here', 'recent').length : '—'} />
        <Kpi label={t.where.kStale} value={live.data ? missing.length : '—'} color="var(--a)" sub={live.data && !live.data.schoolHours ? t.where.onlySchoolHours : undefined} />
        <Kpi label={t.where.kOut} value={live.data ? of('left', 'away').length : '—'} />
        <Kpi label={t.where.kNone} value={live.data ? of('notSeen', 'noStrap').length : '—'} color="var(--muted)" />
      </div>
      <Section title={t.where.needsALook}>
        <div className="panel scroll">
          {missing.length ? (
            <table>
              <thead><tr><th>{t.common.name}</th><th>{t.common.class}</th><th>{t.where.lastHeard}</th><th>{t.where.whereCol}</th><th /></tr></thead>
              <tbody>
                {missing.map((s) => (
                  <tr key={s.id}>
                    <td className="strong">{s.firstName} {s.lastName}</td>
                    <td className="ltr">{s.class?.name ?? '—'}</td>
                    <td className="num">{x(`${timeCairo(s.seenAt)} · ${t.where.minAgo(minsSince(s.seenAt, now))}`)}</td>
                    <td>{s.place?.name ?? '—'}</td>
                    <td><Link className="btn small" href={`/students/${s.id}`}>{t.common.open}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{t.where.nobodyToLook}</Empty>
          )}
        </div>
      </Section>
      {live.data && !places.length && <Empty>{t.where.noGateways}</Empty>}
      <section className="places">
        {places.map((p) => {
          const here = inPlace(p);
          return (
            <Panel key={p.gatewayId} title={p.name} meta={`${p.name === kind(p) ? '' : `${kind(p)} · `}${here.length}`} note={!here.length ? (p.kind === 'GATE' ? t.where.nobodyAtGate : t.where.nobodyHere) : undefined}>
              {here.length ? here.map((s) => (
                p.kind === 'GATE' && s.state === 'missing'
                  ? <Chip key={s.id} s={s} now={now} extra={`${timeCairo(s.seenAt)} · ${t.where.minAgo(minsSince(s.seenAt, now))}`} tone="alert" />
                  : <Chip key={s.id} s={s} now={now} />
              )) : null}
            </Panel>
          );
        })}
        {deaf.map((r) => <Panel key={r.id} title={r.name} note={t.where.cantHear} dashed />)}
        <Panel title={t.where.wentOut} meta={String(of('left').length)} note={of('left').length ? undefined : t.where.nobody}>
          {of('left').length ? of('left').map((s) => <Chip key={s.id} s={s} now={now} extra={timeCairo(s.seenAt)} />) : null}
        </Panel>
        <Panel title={t.where.gone} meta={String(of('away').length)} note={of('away').length ? undefined : t.where.nobody}>
          {of('away').length ? of('away').map((s) => <Chip key={s.id} s={s} now={now} extra={timeCairo(s.seenAt)} />) : null}
        </Panel>
        <Panel title={t.where.notHeard} meta={String(of('notSeen', 'noStrap').length)} note={of('notSeen', 'noStrap').length ? undefined : t.where.nobody}>
          {of('notSeen', 'noStrap').length ? of('notSeen', 'noStrap').map((s) => <Chip key={s.id} s={s} now={now} extra={s.state === 'noStrap' ? t.where.noStrap : undefined} />) : null}
        </Panel>
      </section>
    </>
  );
}
