// The people side of a school morning at growth scale, against a running perf API (scripts/perf/serve.ts):
// parents with the app open and staff on the live dashboard screens, each polling at the rate the apps
// poll today. Requests arrive at a steady rate (open loop), so a slow server shows up as latency.
//
//   npx ts-node --transpile-only scripts/perf/http-load.ts [--seconds 60] [--parents 2000] [--scale 1]
//     [--schools 20] [--api http://localhost:3100]
//
// --parents is how many parents have the app open at once (10% of 20,000 by default).
// --scale multiplies every rate, to find where the server stops keeping up.
import { PASSWORD, PERF_DATE, arg, percentiles } from './env';

const API = arg('api', 'http://localhost:3100') + '/api';
const SECONDS = Number(arg('seconds', '60'));
const PARENTS = Number(arg('parents', '2000'));
const SCALE = Number(arg('scale', '1'));
const SCHOOLS = Number(arg('schools', '20'));
const TEACHERS_PER_SCHOOL = 36; // every classroom PC shows "My class now"
const STAFF_SCREENS_PER_SCHOOL = 3; // Student Affairs on Today, On campus now and Follow-ups
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

async function login(loginId: string) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: loginId, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login ${loginId}: ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

type Kind = { name: string; perSecond: number; pick: () => [string, string] };

async function main() {
  // A sample of signed-in people, reused round-robin (signing in 20,000 parents adds nothing to measure).
  const sample = Math.min(PARENTS, 400);
  const parents: { token: string; child: string }[] = [];
  const admins: string[] = [];
  const teachers: { token: string; classId: string }[] = [];
  for (let k = 1; k <= SCHOOLS; k++) {
    const sid = `ps${pad(k)}`;
    admins.push(await login(`admin@${sid}.perf`));
    // At period 3 on a Thursday, class c is taught by teacher (c + 30) mod 45 (see seed-growth.ts).
    for (const c of [0, 1, 2, 3, 4]) teachers.push({ token: await login(`t${(c + 30) % 45}@${sid}.perf`), classId: `${sid}-c${pad(c)}` });
    for (let n = 0; n < sample / SCHOOLS; n++) {
      const i = n * 37;
      parents.push({ token: await login(`p${i}@${sid}.perf`), child: `${sid}-st${pad(i, 4)}` });
    }
  }
  const any = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const parent = (path: (p: { child: string }) => string) => (): [string, string] => {
    const p = any(parents);
    return [p.token, path(p)];
  };
  const admin = (path: string) => (): [string, string] => [any(admins), path];

  const P = PARENTS;
  const S = SCHOOLS * STAFF_SCREENS_PER_SCHOOL;
  const T = SCHOOLS * TEACHERS_PER_SCHOOL;
  const kinds: Kind[] = [
    // Parent app: Home every 60 s (children, notifications, emergencies), Day tab every 30 s, Messages tab every 60 s
    // (it stays mounted in the background).
    { name: 'parent children (60 s)', perSecond: P / 60, pick: parent(() => '/parent/children') },
    { name: 'parent notifications (60 s)', perSecond: P / 60, pick: parent(() => '/notifications') },
    { name: 'parent emergencies (60 s)', perSecond: P / 60, pick: parent(() => '/parent/announcements/emergency') },
    { name: 'parent child today (30 s)', perSecond: P / 30, pick: parent((p) => `/parent/children/${p.child}/today?date=${PERF_DATE}`) },
    { name: 'parent announcements (60 s)', perSecond: P / 60, pick: parent(() => '/parent/announcements') },
    { name: 'parent polls (60 s)', perSecond: P / 60, pick: parent(() => '/parent/polls') },
    { name: 'parent threads (60 s)', perSecond: P / 60, pick: parent(() => '/parent/threads') },
    // Classroom PCs: the register refreshes every 15 s.
    { name: 'teacher register (15 s)', perSecond: T / 15, pick: () => { const t = any(teachers); return [t.token, `/attendance/classes/${t.classId}/periods/${t.classId.slice(0, 4)}-p3?date=${PERF_DATE}`]; } },
    // Student Affairs: Today every 15 s, On campus now every 10 s, the sidebar badges every 60 s.
    { name: 'staff today summary (15 s)', perSecond: S / 15, pick: admin(`/attendance/summary?date=${PERF_DATE}`) },
    { name: 'staff on campus now (10 s)', perSecond: S / 10, pick: admin('/locations') },
    { name: 'staff follow-ups badge (60 s)', perSecond: (S + T) / 60, pick: admin('/attendance/exceptions') },
    { name: 'staff excuses badge (60 s)', perSecond: S / 60, pick: admin('/excuses?status=PENDING') },
    { name: 'staff unread badge (60 s)', perSecond: (S + T) / 60, pick: admin('/threads/unread-count') },
  ];

  const stats = new Map<string, { ms: number[]; errors: number }>(kinds.map((k) => [k.name, { ms: [], errors: 0 }]));
  let inFlight = 0;
  let maxInFlight = 0;
  const fire = async (kind: Kind) => {
    const [token, path] = kind.pick();
    const s = stats.get(kind.name)!;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const t = performance.now();
    try {
      const res = await fetch(API + path, { headers: { authorization: `Bearer ${token}` } });
      await res.arrayBuffer();
      if (!res.ok) s.errors++;
    } catch {
      s.errors++;
    } finally {
      s.ms.push(performance.now() - t);
      inFlight--;
    }
  };

  const total = kinds.reduce((n, k) => n + k.perSecond * SCALE, 0);
  console.log(`Offering ${Math.round(total)} requests a second for ${SECONDS} s (${PARENTS} parents, ${T} classroom PCs, ${S} staff screens, scale ${SCALE}).`);
  const end = performance.now() + SECONDS * 1000;
  const pending: Promise<void>[] = [];
  // Poisson arrivals per kind, scheduled in 10 ms ticks.
  await new Promise<void>((done) => {
    const tick = setInterval(() => {
      if (performance.now() >= end) {
        clearInterval(tick);
        done();
        return;
      }
      for (const k of kinds) {
        let due = k.perSecond * SCALE * 0.01;
        while (due > 0) {
          if (Math.random() < Math.min(1, due)) pending.push(fire(k));
          due -= 1;
        }
      }
    }, 10);
  });
  await Promise.all(pending);

  const rows = kinds.map((k) => {
    const s = stats.get(k.name)!;
    return { kind: k.name, perSecond: Math.round(k.perSecond * SCALE * 10) / 10, errors: s.errors, ...percentiles(s.ms) };
  });
  const all = [...stats.values()].flatMap((s) => s.ms);
  rows.push({ kind: 'ALL', perSecond: Math.round(all.length / SECONDS), errors: [...stats.values()].reduce((n, s) => n + s.errors, 0), ...percentiles(all) });
  console.table(rows);
  console.log(`Most requests waiting at once: ${maxInFlight}`);
  const out = arg('json');
  if (out) require('fs').writeFileSync(out, JSON.stringify({ rows, maxInFlight }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
