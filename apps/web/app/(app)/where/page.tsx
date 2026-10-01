'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { timeCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Badge, Card, Empty, ErrorNote, Field, Kpi, PageHead } from '@/components/ui';

type State = 'here' | 'recent' | 'missing' | 'left' | 'away' | 'notSeen' | 'noStrap';
type Place = { gatewayId: string; name: string; kind: string | null; room: string | null };
type Student = { id: string; firstName: string; lastName: string; class: { id: string; name: string } | null; state: State; place: Place | null; seenAt: string | null; arrivedAt: string | null };

const REFRESH_MS = 10_000;

function ago(iso: string | null, now: number) {
  if (!iso) return '';
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min} min ago`;
  return `since ${timeCairo(iso)}`;
}

function Person({ s, now }: { s: Student; now: number }) {
  return (
    <Link href={`/students/${s.id}`} className={`person${s.state === 'recent' ? ' dim' : ''}`}>
      {s.firstName} {s.lastName}
      {s.state !== 'here' && s.seenAt && <span className="ago">{ago(s.seenAt, now)}</span>}
    </Link>
  );
}

export default function WherePage() {
  const live = useApi<{ at: string; schoolHours: boolean; places: Place[]; students: Student[] }>('/locations');
  const classes = useApi<any[]>('/classes');
  const [classId, setClassId] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setInterval(() => void live.reload(), REFRESH_MS);
    return () => clearInterval(t);
  }, [live.reload]);

  const now = live.data ? Date.parse(live.data.at) : Date.now();
  const students = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (live.data?.students ?? []).filter(
      (s) => (!classId || s.class?.id === classId) && (!needle || `${s.firstName} ${s.lastName}`.toLowerCase().includes(needle)),
    );
  }, [live.data, classId, q]);

  const inPlace = (p: Place) => students.filter((s) => (s.state === 'here' || s.state === 'recent') && s.place?.gatewayId === p.gatewayId);
  const of = (state: State) => students.filter((s) => s.state === state);
  const places = [...(live.data?.places ?? [])].sort((a, b) => (a.kind === 'GATE' ? -1 : b.kind === 'GATE' ? 1 : a.name.localeCompare(b.name)));
  const inSchool = students.filter((s) => s.state === 'here' || s.state === 'recent').length;
  const missing = of('missing');

  return (
    <>
      <PageHead
        eyebrow="Live"
        title="Where students are"
        sub="From the straps, refreshed every 10 seconds. Each child is placed where the loudest gateway heard them, so a child is in one room, not in every room that can hear them."
      />
      <ErrorNote error={live.error} />
      <div className="grid g4">
        <Kpi label="Heard in the last 10 minutes" value={live.data ? inSchool : '—'} sub={`of ${students.length} students`} />
        <Kpi label="Not heard for 10+ minutes" value={live.data ? missing.length : '—'} sub={live.data && !live.data.schoolHours ? 'only counted during school hours' : 'last heard inside the school'} />
        <Kpi label="Out of school" value={live.data ? of('left').length + of('away').length : '—'} sub={`${of('left').length} through the gate`} />
        <Kpi label="Not heard today" value={live.data ? of('notSeen').length : '—'} sub={`${of('noStrap').length} without a strap`} />
      </div>
      <div className="form-row">
        <Field label="Search" id="q">
          <input id="q" className="input" placeholder="Student name" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Class" id="cls">
          <select id="cls" className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      {missing.length > 0 && (
        <Card title={<span className="row">Needs a look <Badge tone="alert">{missing.length}</Badge></span>} pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Student</th><th>Class</th><th>Last heard</th><th>Where</th></tr></thead>
              <tbody>
                {missing.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/students/${s.id}`}>{s.firstName} {s.lastName}</Link></td>
                    <td>{s.class?.name ?? '—'}</td>
                    <td className="num">{timeCairo(s.seenAt)} <span className="muted small">· {ago(s.seenAt, now)}</span></td>
                    <td>{s.place?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {live.data && !places.length && <Empty>No gateways yet. Claim one under Devices to see where students are.</Empty>}
      <div className="grid g3">
        {places.map((p) => {
          const here = inPlace(p);
          return (
            <Card key={p.gatewayId} title={<span className="row">{p.name} <Badge tone={here.length ? 'info' : ''}>{here.length}</Badge></span>} action={<span className="muted small">{p.kind === 'GATE' ? 'Gate' : p.room ?? p.kind?.toLowerCase()}</span>}>
              {here.length ? <div className="people">{here.map((s) => <Person key={s.id} s={s} now={now} />)}</div> : <span className="muted small">Nobody here now.</span>}
            </Card>
          );
        })}
        {of('left').length > 0 && (
          <Card title="Went out through the gate">
            <div className="people">{of('left').map((s) => <Person key={s.id} s={s} now={now} />)}</div>
          </Card>
        )}
        {of('away').length > 0 && (
          <Card title="Gone for the day" action={<span className="muted small">not heard since school ended</span>}>
            <div className="people">{of('away').map((s) => <Person key={s.id} s={s} now={now} />)}</div>
          </Card>
        )}
        {of('notSeen').length > 0 && (
          <Card title="Not heard today">
            <div className="people">{of('notSeen').map((s) => <Person key={s.id} s={s} now={now} />)}</div>
          </Card>
        )}
      </div>
    </>
  );
}
