// One user at a time: how long each main endpoint takes, how many SQL statements it runs and how much it
// sends back, on the seeded growth data. Also the smart band ingest, per message.
//
//   npx ts-node --transpile-only scripts/perf/queries.ts [--runs 5] [--json out.json]
import { PASSWORD, PERF_DATE, arg, gatewaySecret, percentiles } from './env';
import request from 'supertest';
import { startPerfApp } from './app';

const RUNS = Number(arg('runs', '5'));

async function main() {
  const { app, queries } = await startPerfApp();
  const srv = app.getHttpServer();
  const token = async (login: string) => (await request(srv).post('/api/auth/login').send({ login, password: PASSWORD }).expect(201)).body.token as string;
  const admin = await token('admin@ps01.perf');
  const teacher = await token('t0@ps01.perf');
  const parent = await token('p0@ps01.perf');
  const owner = await token('owner@perf');

  const child = 'ps01-st0000';
  const cases: [string, string, string][] = [
    ['Session (auth/me)', admin, '/api/auth/me'],
    ['Today summary', admin, `/api/attendance/summary?date=${PERF_DATE}`],
    ['Register, one lesson', teacher, `/api/attendance/classes/ps01-c00/periods/ps01-p3?date=${PERF_DATE}`],
    ['On campus now', admin, '/api/locations'],
    ['Follow-ups', admin, '/api/attendance/exceptions'],
    ['Students list', admin, '/api/students'],
    ['Students search', admin, '/api/students?q=Lay'],
    ['Students for band dropdown', admin, '/api/students?active=true'],
    ['Parents list', admin, '/api/parents'],
    ['Staff list', admin, '/api/staff'],
    ['Classes', admin, '/api/classes'],
    ['Timetable (whole school)', admin, '/api/timetable'],
    ['Trips list', admin, '/api/trips'],
    ['Activities list', admin, '/api/activities'],
    ['Activity log', admin, '/api/audit'],
    ['Behaviour summary', admin, '/api/behaviour/summary'],
    ['Chat threads (teacher)', teacher, '/api/threads'],
    ['Chat unread count', teacher, '/api/threads/unread-count'],
    ['Parent: children', parent, '/api/parent/children'],
    ['Parent: child today', parent, `/api/parent/children/${child}/today?date=${PERF_DATE}`],
    ['Parent: notifications', parent, '/api/notifications'],
    ['Parent: threads', parent, '/api/parent/threads'],
    ['Parent: calendar', parent, '/api/parent/calendar'],
    ['Owner: schools', owner, '/api/owner/schools'],
  ];

  const results: Record<string, unknown>[] = [];
  for (const [name, auth, path] of cases) {
    const ms: number[] = [];
    let q = 0;
    let bytes = 0;
    let status = 0;
    for (let i = 0; i < RUNS; i++) {
      queries.reset();
      const t = performance.now();
      const res = await request(srv).get(path).set('Authorization', `Bearer ${auth}`);
      ms.push(performance.now() - t);
      q = queries.count;
      bytes = Buffer.byteLength(res.text ?? '');
      status = res.status;
    }
    results.push({ name, path, status, queries: q, kb: Math.round(bytes / 102.4) / 10, ...percentiles(ms) });
  }

  // Smart band ingest over HTTP: a classroom reader with its 28 bands, the gate reader, an empty heartbeat.
  const basic = (serial: string) => 'Basic ' + Buffer.from(`${serial}:${gatewaySecret(serial)}`).toString('base64');
  const macs = Array.from({ length: 28 }, (_, n) => `DC:0D:01:00:${String(n).padStart(2, '0')}:01`);
  const ingest: [string, string, object[]][] = [
    ['Ingest: classroom reader, 28 bands', 'PERF-01-GW01', macs.map((mac) => ({ mac, rssi: -60 }))],
    ['Ingest: gate reader, 28 bands', 'PERF-01-GW00', macs.map((mac) => ({ mac, rssi: -60 }))],
    ['Ingest: empty heartbeat', 'PERF-01-GW05', []],
  ];
  for (const [name, serial, sightings] of ingest) {
    const ms: number[] = [];
    let q = 0;
    for (let i = 0; i < RUNS; i++) {
      queries.reset();
      const t = performance.now();
      await request(srv).post('/api/gateway/sightings').set('Authorization', basic(serial)).send({ firmware: 'perf', sightings }).expect(200);
      ms.push(performance.now() - t);
      q = queries.count;
    }
    results.push({ name, path: 'POST /api/gateway/sightings', status: 200, queries: q, kb: 0, ...percentiles(ms) });
  }

  console.table(results.map(({ name, status, queries: q, kb, p50, p95 }) => ({ name, status, queries: q, kb, p50, p95 })));
  const out = arg('json');
  if (out) require('fs').writeFileSync(out, JSON.stringify(results, null, 2));
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
