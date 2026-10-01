// Fills a running API with a demo school (sample data) for trying the dashboard.
//
//   OWNER_EMAIL=... OWNER_PASSWORD=... npx ts-node scripts/demo.ts [--api http://localhost:3000]
//
// Creates "Nile Valley School (demo)" with an admin (admin@demo.school / demo-admin-1),
// two teachers (hana@demo.school, sherif@demo.school / demo-teacher-1), classes, rooms,
// periods, a timetable, 24 students with parents (parent1@demo.school … parent24@demo.school /
// demo-parent-1), gateways and straps.
import { playDay } from './demo-day';

const api = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'http://localhost:3000') + '/api';

async function call(token: string | null, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(api + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const FIRST = ['Layla', 'Omar', 'Yara', 'Ali', 'Karim', 'Salma', 'Mariam', 'Youssef', 'Hana', 'Ziad', 'Nour', 'Adam'];
const LAST = ['Hussein', 'Kamal', 'Mostafa', 'Ramadan', 'Fathy', 'Nabil', 'Adel', 'Gamal'];

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD (the account made by npm run seed).');
  const owner = (await call(null, 'POST', '/auth/login', { login: email, password })).token;

  const school = await call(owner, 'POST', '/owner/schools', {
    name: 'Nile Valley School (demo)', nameAr: 'مدرسة وادي النيل', plan: 'SMART',
    admin: { name: 'Samia Adel', email: 'admin@demo.school', password: 'demo-admin-1' },
  });
  const admin = (await call(null, 'POST', '/auth/login', { login: 'admin@demo.school', password: 'demo-admin-1' })).token;
  const A = (m: string, p: string, b?: unknown) => call(admin, m, p, b);

  // The demo school subscribes to automatic attendance (straps); only the owner can switch it on.
  await call(owner, 'PATCH', `/owner/schools/${school.id}/modules/attendance/features`, { features: { automatic: true } });
  await A('PATCH', '/school', { absenceNoticeTime: '08:30' });

  const hana = await A('POST', '/staff', { name: 'Hana Nabil', role: 'TEACHER', email: 'hana@demo.school', password: 'demo-teacher-1' });
  const sherif = await A('POST', '/staff', { name: 'Sherif Kamal', role: 'TEACHER', email: 'sherif@demo.school', password: 'demo-teacher-1' });
  const g4 = await A('POST', '/grades', { name: 'Grade 4', order: 4 });
  const c4a = await A('POST', '/classes', { name: '4-A', gradeId: g4.id, homeroomTeacherId: hana.id });
  const c4b = await A('POST', '/classes', { name: '4-B', gradeId: g4.id, homeroomTeacherId: sherif.id });
  const r204 = await A('POST', '/rooms', { name: 'Room 204' });
  const r205 = await A('POST', '/rooms', { name: 'Room 205' });
  const lab = await A('POST', '/rooms', { name: 'Science lab', kind: 'LAB' });
  const subjects: Record<string, any> = {};
  for (const s of ['Math', 'Arabic', 'English', 'Science']) subjects[s] = await A('POST', '/subjects', { name: s });
  const times = [['08:00', '08:45'], ['08:45', '09:30'], ['09:50', '10:35'], ['10:35', '11:20'], ['11:40', '12:25'], ['12:25', '13:10']];
  const periods: any[] = [];
  for (const [i, [startTime, endTime]] of times.entries()) periods.push(await A('POST', '/periods', { number: i + 1, startTime, endTime }));

  const plan: [string, string][] = [['Math', 'English'], ['Arabic', 'Math'], ['English', 'Science'], ['Science', 'Arabic'], ['Math', 'Math'], ['Arabic', 'English']];
  for (const day of [0, 1, 2, 3, 4]) {
    for (const [i, p] of periods.entries()) {
      const [a, b] = plan[(i + day) % plan.length];
      const aInLab = a === 'Science';
      const bInLab = b === 'Science' && !aInLab;
      await A('POST', '/timetable', { classId: c4a.id, dayOfWeek: day, periodId: p.id, roomId: aInLab ? lab.id : r204.id, subjectId: subjects[a].id, teacherId: a === 'Math' || a === 'Science' ? hana.id : undefined });
      await A('POST', '/timetable', { classId: c4b.id, dayOfWeek: day, periodId: p.id, roomId: bInLab ? lab.id : r205.id, subjectId: subjects[b].id, teacherId: b === 'English' || b === 'Arabic' ? sherif.id : undefined });
    }
  }

  for (let i = 0; i < 24; i++) {
    const s = await A('POST', '/students', {
      code: `2026-${String(i + 1).padStart(4, '0')}`, firstName: FIRST[i % FIRST.length], lastName: LAST[(i * 3) % LAST.length], classId: i < 12 ? c4a.id : c4b.id,
    });
    // Demo parents get a password straight away; real parents sign up in the app with their email.
    await A('POST', `/students/${s.id}/guardians`, {
      relation: 'MOTHER', name: `Mother of ${s.firstName}`, email: `parent${i + 1}@demo.school`, phone: `+20100${String(1000000 + i)}`, password: 'demo-parent-1',
    });
    await A('POST', '/devices/straps', { mac: `DC:0D:30:00:${String(Math.floor(i / 100)).padStart(2, '0')}:${String(i % 100).padStart(2, '0')}`, studentId: s.id });
  }

  const secrets: Record<string, string> = {};
  for (const [serial, name, kind, roomId] of [['DEMO-GATE-A', 'Gate A', 'GATE', undefined], ['DEMO-R204', 'Room 204', 'ROOM', r204.id], ['DEMO-R205', 'Room 205', 'ROOM', r205.id]] as const) {
    const gw = await call(owner, 'POST', '/owner/gateways', { serial });
    await A('POST', '/devices/gateways/claim', { claimCode: gw.claimCode, name, kind, roomId });
    secrets[serial] = gw.secret;
    console.log(`Gateway ${serial}: secret ${gw.secret}`);
  }
  console.log(`Demo school ready (${school.id}). Sign in as admin@demo.school / demo-admin-1`);
  // Today so far, as if the gateways had been running since the morning.
  await playDay(api, owner, admin, secrets);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
