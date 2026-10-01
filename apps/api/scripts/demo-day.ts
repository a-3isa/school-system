// Plays today's school day so far for the demo school, as if the gateways had
// been running since the morning, then switches the school to automatic
// attendance so the platform decides every finished lesson.
//
//   OWNER_EMAIL=... OWNER_PASSWORD=... npx ts-node scripts/demo-day.ts [--api http://localhost:3000]
//
// Run it once on a freshly loaded demo school (scripts/demo.ts runs it for you).
// Lessons already decided earlier today are not decided again.
//
// What happens, per class of 12:
// - the 4th child stays home all day (absent; parents get the absence notice)
// - the 6th child arrives at 08:20 (late for period 1)
// - the 8th child leaves the room for 20 minutes in period 3
// - everyone else comes in through the gate between 07:35 and 07:55
// Lessons in the science lab have no gateway, so they need a teacher's mark.
import { localParts, zonedTime } from '../src/common/time';

const TZ = 'Africa/Cairo';
const MINUTE = 60_000;

export async function playDay(api: string, ownerToken: string, adminToken: string, secrets: Record<string, string> = {}, log = console.log) {
  const call = async (token: string, method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(api + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  const A = (method: string, path: string, body?: unknown) => call(adminToken, method, path, body);

  const now = new Date();
  const { date, time, dayOfWeek } = localParts(now, TZ);
  const school = await A('GET', '/school');
  if (!school.schoolDays.includes(dayOfWeek)) {
    log(`Today isn't a school day, so there is no school day to play. Try again on a school day (Sunday to Thursday).`);
    return;
  }
  const periods: any[] = await A('GET', '/periods');
  if (!periods.length || time < periods[0].startTime) {
    log(`School hasn't started yet today (first period ${periods[0]?.startTime}). Run this again after ${periods[0]?.startTime}.`);
    return;
  }

  // Secrets: the ones just printed by demo.ts, or fresh ones, so nothing has to be copied by hand.
  const owned: any[] = await call(ownerToken, 'GET', '/owner/gateways');
  const auth: Record<string, string> = {};
  let renewed = false;
  for (const g of owned.filter((g) => g.school?.id === school.id)) {
    let secret = secrets[g.serial];
    if (!secret) {
      secret = (await call(ownerToken, 'POST', `/owner/gateways/${g.id}/secret`)).secret as string;
      renewed = true;
    }
    auth[g.id] = 'Basic ' + Buffer.from(`${g.serial}:${secret}`).toString('base64');
  }
  const gateways: any[] = await A('GET', '/devices/gateways');
  const gate = gateways.find((g) => g.kind === 'GATE');
  const roomGateway = new Map(gateways.filter((g) => g.room).map((g) => [g.room.id, g]));
  const send = async (gatewayId: string, sightings: { mac: string; rssi: number; at: number }[]) => {
    const res = await fetch(`${api}/gateway/sightings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth[gatewayId] },
      body: JSON.stringify({ firmware: 'demo-day', sightings }),
    });
    if (!res.ok) throw new Error(`gateway sightings: ${res.status} ${await res.text()}`);
  };

  const straps: any[] = await A('GET', '/devices/straps');
  const macOf = new Map(straps.filter((s) => s.student).map((s) => [s.student.id, s.mac]));
  const students: any[] = (await A('GET', '/students?active=true')).sort((a: any, b: any) => a.code.localeCompare(b.code));
  const byClass = new Map<string, any[]>();
  for (const s of students) if (s.class && macOf.has(s.id)) byClass.set(s.class.id, [...(byClass.get(s.class.id) ?? []), s]);

  const at = (hhmm: string) => zonedTime(date, hhmm, TZ).getTime();
  const nowMs = now.getTime();
  const plan = new Map<string, { home: boolean; arrive: number; awayPeriod?: number }>();
  for (const list of byClass.values()) {
    list.forEach((s, i) => {
      const arrive = i === 5 ? at('08:20') : at('07:35') + ((i * 97) % 20) * MINUTE;
      plan.set(s.id, { home: i === 3, arrive, awayPeriod: i === 7 ? 3 : undefined });
    });
  }

  // Lessons: one reading a minute from the room's gateway for each child in it.
  const lessons: any[] = (await A('GET', '/timetable')).filter((e: any) => e.dayOfWeek === dayOfWeek);
  let readings = 0;
  for (const p of periods) {
    const start = at(p.startTime);
    const end = Math.min(at(p.endTime), nowMs);
    if (start >= nowMs) break;
    for (const lesson of lessons.filter((l) => l.periodId === p.id)) {
      const gw = roomGateway.get(lesson.roomId);
      if (!gw) continue; // no gateway in this room (the lab)
      const kids = byClass.get(lesson.classId) ?? [];
      for (let t = start + 20_000; t < end; t += MINUTE) {
        const minute = (t - start) / MINUTE;
        const here = kids.filter((s) => {
          const who = plan.get(s.id)!;
          if (who.home || t < who.arrive) return false;
          return !(who.awayPeriod === p.number && minute >= 10 && minute < 30);
        });
        if (!here.length) continue;
        await send(gw.id, here.map((s) => ({ mac: macOf.get(s.id), rssi: -58 - Math.floor(Math.random() * 8), at: t })));
        readings += here.length;
      }
    }
  }

  // Switch to automatic before the gate readings, so arrivals reach the parents.
  if (school.attendanceMode !== 'AUTOMATIC') await A('PATCH', '/school', { attendanceMode: 'AUTOMATIC' });
  let arrived = 0;
  if (gate) {
    for (const s of students) {
      const who = plan.get(s.id);
      if (!who || who.home || who.arrive > nowMs) continue;
      const mac = macOf.get(s.id);
      await send(gate.id, [
        { mac, rssi: -55, at: who.arrive },
        { mac, rssi: -52, at: who.arrive + 4000 },
      ]);
      arrived++;
    }
  }
  log(`Played today until ${time}: ${arrived} arrivals at the gate and ${readings} classroom readings.`);
  log('Attendance is now automatic. Within a minute every finished lesson is decided; see Today and Attendance › Exceptions.');
  if (renewed) log('The gateways got new secrets for this run. For the simulator, get one in the owner console: Gateways › New secret.');
}

if (require.main === module) {
  const api = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'http://localhost:3000') + '/api';
  (async () => {
    const email = process.env.OWNER_EMAIL;
    const password = process.env.OWNER_PASSWORD;
    if (!email || !password) throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD (the account made by npm run seed).');
    const login = async (l: string, p: string) => {
      const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
      if (!res.ok) throw new Error(`Sign-in failed for ${l}: ${res.status}`);
      return ((await res.json()) as any).token as string;
    };
    await playDay(api, await login(email, password), await login('admin@demo.school', 'demo-admin-1'));
  })().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
