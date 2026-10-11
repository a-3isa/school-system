// Fills a running API with a demo school (sample data) for trying the dashboard.
//
//   OWNER_EMAIL=... OWNER_PASSWORD=... npx ts-node scripts/demo.ts [--api http://localhost:3000]
//
// Creates "Nile Valley Language School (demo)" with an admin (admin@demo.school / demo-admin-1),
// two teachers (hana@demo.school, sherif@demo.school / demo-teacher-1), classes, rooms,
// periods, a timetable, 24 students with parents (parent1@demo.school … parent23@demo.school;
// some mothers have two children) and one guardian (guardian24@demo.school), all with the
// password demo-parent-1, gateways and straps.
import { deflateSync } from 'zlib';
import { playDay } from './demo-day';

const api = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'http://localhost:3000') + '/api';

/** A plain square PNG in one colour, as a stand-in for a student's photo. */
function squarePng(size: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).fill(Buffer.from([r, g, b]))]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

async function upload(token: string, kind: string, file: Buffer, name: string, type: string): Promise<string> {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', new Blob([new Uint8Array(file)], { type }), name);
  const res = await fetch(api + '/students/files', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`upload ${kind}: ${res.status} ${JSON.stringify(data)}`);
  return data.id;
}

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
const GIRLS = new Set(['Layla', 'Yara', 'Salma', 'Mariam', 'Hana', 'Nour']);
// Mothers' own names (in Egypt a mother keeps her family name).
const MOTHERS = ['Dina', 'Rania', 'Mona', 'Heba', 'Nadia', 'Amira', 'Yasmin', 'Ghada', 'Reem', 'Salwa', 'Nermeen', 'Marwa'];
const LAST = ['Hussein', 'Kamal', 'Mostafa', 'Ramadan', 'Fathy', 'Nabil', 'Adel', 'Gamal'];

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD (the account made by npm run seed).');
  const owner = (await call(null, 'POST', '/auth/login', { login: email, password })).token;

  const school = await call(owner, 'POST', '/owner/schools', {
    name: 'Nile Valley Language School (demo)', nameAr: 'مدرسة وادي النيل للغات', plan: 'SMART',
    admin: { name: 'Samia Adel', email: 'admin@demo.school', password: 'demo-admin-1' },
  });
  const admin = (await call(null, 'POST', '/auth/login', { login: 'admin@demo.school', password: 'demo-admin-1' })).token;
  const A = (m: string, p: string, b?: unknown) => call(admin, m, p, b);

  // The demo school subscribes to automatic attendance (straps); only the owner can switch it on.
  await call(owner, 'PATCH', `/owner/schools/${school.id}/modules/attendance/features`, { features: { automatic: true } });
  await A('PATCH', '/school', { absenceNoticeTime: '08:30' });

  // Staff are addressed by title, as in Egypt's private schools: Ms. Samia Adel, Ms. Hana Nabil, Mr. Sherif Kamal.
  const me = await A('GET', '/auth/me');
  await A('PATCH', `/staff/${me.id}`, { honorific: 'MS' });
  const hana = await A('POST', '/staff', { name: 'Hana Nabil', honorific: 'MS', role: 'TEACHER', email: 'hana@demo.school', password: 'demo-teacher-1' });
  const sherif = await A('POST', '/staff', { name: 'Sherif Kamal', honorific: 'MR', role: 'TEACHER', email: 'sherif@demo.school', password: 'demo-teacher-1' });
  // An Egyptian primary school: Primary 1–6, two classes of Primary 4 (4/1 and 4/2) in the languages system.
  const grades: any[] = await A('POST', '/grades/egypt', { stages: ['PRIMARY'] });
  const g4 = grades.find((g) => g.name === 'Primary 4');
  const c4a = await A('POST', '/classes', { name: '4/1', section: '1', gradeId: g4.id, homeroomTeacherId: hana.id, system: 'NATIONAL_LANGUAGES', capacity: 30 });
  const c4b = await A('POST', '/classes', { name: '4/2', section: '2', gradeId: g4.id, homeroomTeacherId: sherif.id, system: 'NATIONAL_LANGUAGES', capacity: 30 });
  // The school year: two terms with the mid-year break, and Egypt's fixed public holidays.
  const year = await A('POST', '/school/years', { name: '2026/2027', startsOn: '2026-09-13', endsOn: '2027-06-30', term2StartsOn: '2027-02-07', breakFrom: '2027-01-24', breakTo: '2027-02-04' });
  await A('POST', '/school/holidays/egypt', { yearId: year.id, lang: 'en' });
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
    // Every student comes with a parent. Some brothers and sisters share a mother
    // (one in 4/1, one in 4/2), and the last child is looked after by a guardian.
    // Demo parents get a password straight away; real parents sign up in the app with their email.
    const sibling = i >= 12 && i % 4 === 0 ? i - 12 : i;
    const first = FIRST[(sibling === i ? i : i + 5) % FIRST.length];
    const parent = i === 23
      ? { relation: 'GUARDIAN', name: 'Fatma Hussein', email: `guardian${i + 1}@demo.school`, password: 'demo-parent-1' }
      : { relation: 'MOTHER', name: `${MOTHERS[sibling % MOTHERS.length]} ${LAST[(sibling * 5 + 2) % LAST.length]}`, email: `parent${sibling + 1}@demo.school`, phone: `+20100${String(1000000 + sibling)}`, password: 'demo-parent-1' };
    // Born in 2016 or 2017 in Cairo; the national number agrees with the birth date and gender.
    const girl = GIRLS.has(first);
    const born = new Date(Date.UTC(i < 12 ? 2016 : 2017, i % 12, 1 + i));
    const ymd = born.toISOString().slice(2, 10).replace(/-/g, '');
    const nationalId = `3${ymd}01${String(100 + i).padStart(3, '0')}${girl ? 2 : 1}${i % 10}`;
    const s = await A('POST', '/students', {
      code: `2026-${String(i + 1).padStart(4, '0')}`, firstName: first, lastName: LAST[(sibling * 3) % LAST.length], classId: i < 12 ? c4a.id : c4b.id, parent,
      gender: girl ? 'FEMALE' : 'MALE', dateOfBirth: born.toISOString().slice(0, 10), nationality: 'EG', nationalId,
      files: [
        await upload(admin, 'PHOTO', squarePng(96, [60 + ((i * 37) % 160), 90 + ((i * 53) % 120), 120 + ((i * 29) % 100)]), 'photo.png', 'image/png'),
        await upload(admin, 'BIRTH_CERTIFICATE', Buffer.from(`%PDF-1.4\n% Birth certificate of ${first} (demo)\n%%EOF\n`), 'birth-certificate.pdf', 'application/pdf'),
      ],
    });
    await A('POST', '/devices/straps', { mac: `DC:0D:30:00:${String(Math.floor(i / 100)).padStart(2, '0')}:${String(i % 100).padStart(2, '0')}`, studentId: s.id });
  }

  const secrets: Record<string, string> = {};
  for (const [serial, name, kind, roomId] of [['DEMO-GATE-A', 'Main gate', 'GATE', undefined], ['DEMO-R204', 'Room 204', 'ROOM', r204.id], ['DEMO-R205', 'Room 205', 'ROOM', r205.id]] as const) {
    const gw = await call(owner, 'POST', '/owner/gateways', { serial });
    await A('POST', '/devices/gateways/claim', { claimCode: gw.claimCode, name, kind, roomId });
    secrets[serial] = gw.secret;
    console.log(`Gateway ${serial}: secret ${gw.secret}`);
  }
  await demoMessaging(owner, admin, school.id, hana.id);
  console.log(`Demo school ready (${school.id}). Sign in as admin@demo.school / demo-admin-1`);
  // Today so far, as if the gateways had been running since the morning.
  await playDay(api, owner, admin, secrets);
}

/** Messages for the demo school: announcements, a poll, a chat with a teacher, and meeting times. */
async function demoMessaging(owner: string, admin: string, schoolId: string, hanaId: string) {
  // Chat, polls and meetings come with the Complete plan; the owner switches them on for this demo.
  await call(owner, 'PATCH', `/owner/schools/${schoolId}/modules/messaging/features`, { features: { chat: true, polls: true, meetings: true } });
  const A = (m: string, p: string, b?: unknown) => call(admin, m, p, b);
  const hana = (await call(null, 'POST', '/auth/login', { login: 'hana@demo.school', password: 'demo-teacher-1' })).token;
  const classes: any[] = await A('GET', '/classes');
  const c4a = classes.find((c) => c.name === '4/1');

  const welcome = await A('POST', '/announcements', {
    title: 'Welcome to the new school year',
    body: 'Dear parents, we are glad to welcome you and your children. The first parents’ meeting will be announced soon. Please keep the Student Affairs office informed of any change in your contact details.',
    audience: { kind: 'SCHOOL' },
  });
  await A('POST', `/announcements/${welcome.id}/send`);
  const quiz = await call(hana, 'POST', '/announcements', { title: 'Maths quiz on Thursday', body: 'Class 4/1 will have a short quiz on multiplication this Thursday. Please help your child to revise the tables of 6, 7 and 8.', audience: { kind: 'CLASSES', ids: [c4a.id] } });
  await call(hana, 'POST', `/announcements/${quiz.id}/send`);

  const closesAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  await A('POST', '/polls', {
    question: 'Which day suits you best for the first parents’ meeting?', options: ['Sunday', 'Tuesday', 'Thursday'], closesAt, audience: { kind: 'SCHOOL' },
  });

  // A conversation: the mother of Layla (4/1) and her Maths teacher.
  const parent = (await call(null, 'POST', '/auth/login', { login: 'parent1@demo.school', password: 'demo-parent-1' })).token;
  const kids: any[] = await call(parent, 'GET', '/parent/children');
  const layla = kids.find((k) => k.firstName === 'Layla') ?? kids[0];
  const thread = await call(parent, 'POST', `/parent/children/${layla.id}/threads`, { staffId: hanaId });
  await call(parent, 'POST', `/threads/${thread.id}/messages`, { body: 'Good morning Ms. Hana, how is Layla doing in Maths this term?' });
  await call(hana, 'POST', `/threads/${thread.id}/messages`, { body: 'Good morning! Layla is doing very well and takes part in every lesson. She could practise the tables of 7 and 8 a little more.' });
  await call(parent, 'POST', `/threads/${thread.id}/messages`, { body: 'Thank you, we will practise together this week.' });
  await call(hana, 'POST', `/threads/${thread.id}/read`);

  // Meeting times on the next school day.
  const day = new Date();
  do day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() > 4);
  await call(hana, 'POST', '/meetings/windows', { date: day.toISOString().slice(0, 10), fromTime: '14:00', toTime: '15:00', slotMinutes: 20, place: 'Room 204' });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
