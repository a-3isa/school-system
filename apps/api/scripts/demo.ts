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
  const mona = await A('POST', '/staff', { name: 'Mona Adel', honorific: 'MS', role: 'TEACHER', email: 'mona@demo.school', password: 'demo-teacher-1' });
  const karim = await A('POST', '/staff', { name: 'Karim Samir', honorific: 'MR', role: 'TEACHER', email: 'karim@demo.school', password: 'demo-teacher-1' });
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
  const subjectAr: Record<string, string> = { Math: 'الرياضيات', Arabic: 'اللغة العربية', English: 'اللغة الإنجليزية', Science: 'العلوم' };
  for (const s of ['Math', 'Arabic', 'English', 'Science']) subjects[s] = await A('POST', '/subjects', { name: s, nameAr: subjectAr[s] });
  // Primary 4 studies these four subjects; every class of the year group has them.
  for (const s of Object.values(subjects)) await A('PUT', `/grades/${g4.id}/subjects/${s.id}`, {});
  // The school assigns each subject to a teacher, class by class: Maths is Hana's in 4/1 and Karim's in 4/2 (same year group,
  // different class, different teacher); Arabic and English are Mona's in 4/1 and Sherif's in 4/2. The lessons follow.
  for (const [cls, who] of [[c4a, { Math: hana, Science: hana, Arabic: mona, English: mona }], [c4b, { Math: karim, Science: karim, Arabic: sherif, English: sherif }]] as const) {
    for (const [name, teacher] of Object.entries(who)) await A('PUT', '/timetable/assign', { classId: cls.id, subjectId: subjects[name].id, teacherId: teacher.id });
  }
  const times = [['08:00', '08:45'], ['08:45', '09:30'], ['09:50', '10:35'], ['10:35', '11:20'], ['11:40', '12:25'], ['12:25', '13:10']];
  const periods: any[] = [];
  for (const [i, [startTime, endTime]] of times.entries()) periods.push(await A('POST', '/periods', { number: i + 1, startTime, endTime }));

  const plan: [string, string][] = [['Math', 'English'], ['Arabic', 'Math'], ['English', 'Science'], ['Science', 'Arabic'], ['Math', 'Math'], ['Arabic', 'English']];
  for (const day of [0, 1, 2, 3, 4]) {
    for (const [i, p] of periods.entries()) {
      const [a, b] = plan[(i + day) % plan.length];
      const aInLab = a === 'Science';
      const bInLab = b === 'Science' && !aInLab;
      await A('POST', '/timetable', { classId: c4a.id, dayOfWeek: day, periodId: p.id, roomId: aInLab ? lab.id : r204.id, subjectId: subjects[a].id });
      await A('POST', '/timetable', { classId: c4b.id, dayOfWeek: day, periodId: p.id, roomId: bInLab ? lab.id : r205.id, subjectId: subjects[b].id });
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
  await demoBehaviour(owner, admin, school.id);
  await demoAcademics(owner, admin, school.id);
  await demoActivities(owner, admin, school.id, hana.id);
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

/** Behaviour notes for the demo school: praise and a concern from the class teacher, and an incident kept back by Student Affairs. */
async function demoBehaviour(owner: string, admin: string, schoolId: string) {
  // Behaviour comes with the Complete plan; the owner switches it on for this demo (merit points are on with it).
  await call(owner, 'PUT', `/owner/schools/${schoolId}/modules/behavior`, { enabled: true });
  const hana = (await call(null, 'POST', '/auth/login', { login: 'hana@demo.school', password: 'demo-teacher-1' })).token;
  const mine: any[] = await call(hana, 'GET', '/behaviour/students');
  const layla = mine.find((s) => s.firstName === 'Layla') ?? mine[0];
  const omar = mine.find((s) => s.firstName === 'Omar') ?? mine[1];

  await call(hana, 'POST', '/behaviour', { studentId: layla.id, kind: 'PRAISE', category: 'KINDNESS', text: 'Layla helped a new classmate find her way around the school today. A lovely gesture.', points: 3 });
  await call(hana, 'POST', '/behaviour', { studentId: layla.id, kind: 'PRAISE', category: 'EFFORT', text: 'Excellent effort in the multiplication quiz. She revised the tables of 7 and 8 at home.', points: 2 });
  await call(hana, 'POST', '/behaviour', { studentId: omar.id, kind: 'PRAISE', category: 'PARTICIPATION', text: 'Omar answered every question in today’s Maths lesson and encouraged the others to join in.', points: 2 });
  await call(hana, 'POST', '/behaviour', { studentId: omar.id, kind: 'CONCERN', category: 'HOMEWORK', text: 'Omar has not handed in his Arabic homework twice this week. Please remind him gently.', points: -1 });
  // Only Student Affairs records incidents, and parents see one only after it is shared.
  await call(admin, 'POST', '/behaviour', {
    studentId: omar.id, kind: 'INCIDENT', category: 'DAMAGE', severity: 'MINOR', place: 'Playground',
    text: 'A classroom window blind was damaged during break.', actionTaken: 'Spoke with Omar and agreed that he will tell a teacher at once next time.', points: -2,
  });
}


/**
 * Marks for the demo school: Maths and Science for class 4/1 with three assessments each, marked and
 * published; two midterm exams next week; and one published term-1 report card (Layla's).
 */
async function demoAcademics(owner: string, admin: string, schoolId: string) {
  // Academics comes with the Complete plan; the owner switches it on for this demo.
  await call(owner, 'PUT', `/owner/schools/${schoolId}/modules/academics`, { enabled: true });
  const A = (m: string, p: string, b?: unknown) => call(admin, m, p, b);
  const hana = (await call(null, 'POST', '/auth/login', { login: 'hana@demo.school', password: 'demo-teacher-1' })).token;
  await A('PATCH', '/school', { principalName: 'Dr. Amal Fawzy' });

  const subjects: any[] = await A('GET', '/subjects');
  const rooms: any[] = await A('GET', '/rooms');
  const classes: any[] = await A('GET', '/classes');
  const c4a = classes.find((c) => c.name === '4/1');
  const today = new Date();
  const dateOf = (offsetDays: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offsetDays));
    return d.toISOString().slice(0, 10) < '2026-09-14' ? '2026-09-14' : d.toISOString().slice(0, 10); // never before the school year starts
  };
  const schoolDay = (offsetDays: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offsetDays));
    while (d.getUTCDay() > 4) d.setUTCDate(d.getUTCDate() + 1); // Friday and Saturday are the weekend
    return d.toISOString().slice(0, 10);
  };

  const plan: [string, [string, string, number, number][]][] = [
    ['Math', [['QUIZ', 'Multiplication quiz', 20, -21], ['HOMEWORK', 'Fractions worksheet', 10, -12], ['PROJECT', 'Shapes project', 50, -4]]],
    ['Science', [['QUIZ', 'The water cycle quiz', 20, -19], ['CLASSWORK', 'Plants in our school garden', 10, -10], ['PROJECT', 'Solar system model', 50, -3]]],
  ];
  for (const [name, items] of plan) {
    const subject = subjects.find((s) => s.name === name);
    for (const [k, [kind, title, maxScore, offset]] of items.entries()) {
      const a = await call(hana, 'POST', '/academics/assessments', { classId: c4a.id, subjectId: subject.id, kind, title, date: dateOf(offset), maxScore });
      const students: any[] = await call(hana, 'GET', `/academics/assessments/${a.id}/marks`);
      const marks = students.map((s, i) => {
        if (i === 3 && k === 0) return { studentId: s.id, absent: true, excused: true }; // away with a note
        if (i === 5 && k === 1) return { studentId: s.id, absent: true }; // simply absent
        const share = 0.5 + ((i * 7 + k * 5 + (name === 'Science' ? 3 : 0)) % 45) / 100; // 50% to 94%
        return { studentId: s.id, score: Math.round(maxScore * share * 2) / 2 };
      });
      await call(hana, 'PUT', `/academics/assessments/${a.id}/marks`, { marks });
      await call(hana, 'POST', `/academics/assessments/${a.id}/publish`);
    }
  }

  // Midterm exams next week.
  const room204 = rooms.find((r) => r.name === 'Room 204');
  const lab = rooms.find((r) => r.name === 'Science lab');
  const sunday = schoolDay(7);
  const next = new Date(`${sunday}T00:00:00Z`);
  do next.setUTCDate(next.getUTCDate() + 1);
  while (next.getUTCDay() > 4);
  await call(hana, 'POST', '/academics/assessments', { classId: c4a.id, subjectId: subjects.find((s) => s.name === 'Math').id, kind: 'MIDTERM', title: 'Maths midterm', date: sunday, maxScore: 40, startTime: '09:00', endTime: '10:30', roomId: room204.id });
  await call(hana, 'POST', '/academics/assessments', { classId: c4a.id, subjectId: subjects.find((s) => s.name === 'Science').id, kind: 'MIDTERM', title: 'Science midterm', date: next.toISOString().slice(0, 10), maxScore: 40, startTime: '09:00', endTime: '10:30', roomId: lab.id });

  // Layla's report card for term 1, written and published.
  const year = (await A('GET', '/school/years'))[0];
  const body = { classId: c4a.id, yearId: year.id, term: 1 };
  await call(hana, 'POST', '/academics/report-cards/generate', body);
  const cards = (await call(hana, 'GET', `/academics/report-cards?classId=${c4a.id}&term=1&yearId=${year.id}`)).cards;
  const card = cards.find((c: any) => c.name.startsWith('Layla')) ?? cards[0];
  const comment = (token: string, b: object) => call(token, 'PATCH', `/academics/report-cards/${card.id}/comments`, b);
  await comment(hana, { subjectId: subjects.find((s) => s.name === 'Math').id, comment: 'A confident start to the year. Practise the tables of 7 and 8 a little more.' });
  await comment(hana, { subjectId: subjects.find((s) => s.name === 'Science').id, comment: 'Curious and careful in every experiment.' });
  await comment(hana, { classTeacherComment: 'A kind and helpful member of the class. Well done!' });
  await comment(admin, { principalComment: 'We are proud of your progress. Keep it up.' });
  await A('POST', '/academics/report-cards/publish', { ids: [card.id] });
}

/**
 * Clubs, a trip and events for the demo school: three clubs (Chess is full and has a waiting list, Art has a fee that is
 * partly paid), one trip next week for class 4/1 that is open for permission with two answers, a past event with
 * three photos and an upcoming one.
 */
async function demoActivities(owner: string, admin: string, schoolId: string, hanaId: string) {
  await call(owner, 'PUT', `/owner/schools/${schoolId}/modules/activities`, { enabled: true });
  await call(owner, 'PATCH', `/owner/schools/${schoolId}/modules/activities/features`, { features: { paidActivities: true } });
  const A = (m: string, p: string, b?: unknown) => call(admin, m, p, b);
  const classes: any[] = await A('GET', '/classes');
  const rooms: any[] = await A('GET', '/rooms');
  const c4a = classes.find((c) => c.name === '4/1');
  const today = new Date();
  const schoolDay = (offsetDays: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offsetDays));
    while (d.getUTCDay() > 4) d.setUTCDate(d.getUTCDate() + 1); // Friday and Saturday are the weekend
    return d.toISOString().slice(0, 10);
  };
  const parent = async (n: number) => {
    const token = (await call(null, 'POST', '/auth/login', { login: `parent${n}@demo.school`, password: 'demo-parent-1' })).token;
    return { token, kids: (await call(token, 'GET', '/parent/children')) as any[] };
  };

  const chess = await A('POST', '/activities', { name: 'Chess club', nameAr: 'نادي الشطرنج', description: 'Openings, tactics and friendly matches.', supervisorId: hanaId, days: [0, 2], startTime: '14:30', endTime: '15:30', roomId: rooms.find((r) => r.name === 'Room 205')?.id, capacity: 2 });
  const art = await A('POST', '/activities', { name: 'Art workshop', nameAr: 'ورشة الفن', description: 'Drawing and painting, with all materials provided.', days: [1], startTime: '14:30', endTime: '15:30', capacity: 15, fee: 350 });
  await A('POST', '/activities', { name: 'Football', nameAr: 'كرة القدم', days: [3], startTime: '14:00', endTime: '15:00', capacity: 20 });

  // Chess takes two places, so the third family is on the waiting list; one Art place is paid for.
  const joined: { token: string; kid: any }[] = [];
  for (const n of [1, 2, 3]) {
    const p = await parent(n);
    const kid = p.kids[0];
    await call(p.token, 'POST', `/parent/children/${kid.id}/activities/${chess.id}/join`);
    joined.push({ token: p.token, kid });
  }
  await call(joined[0].token, 'POST', `/parent/children/${joined[0].kid.id}/activities/${art.id}/join`);
  await call(joined[1].token, 'POST', `/parent/children/${joined[1].kid.id}/activities/${art.id}/join`);
  await A('POST', `/activities/${art.id}/students/${joined[0].kid.id}/paid`, { paid: true });

  // A trip next week for 4/1, open for permission: one family has agreed and one has declined.
  const date = schoolDay(7);
  const answerBy = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 4, 15, 0)).toISOString(); // 18:00 in Cairo
  const trip = await A('POST', '/trips', {
    title: 'Visit to the Egyptian Museum', destination: 'Tahrir, Cairo', description: 'Students bring a packed lunch and wear the school PE kit.',
    date, departTime: '08:30', returnTime: '13:00', fromPeriod: 1, toPeriod: 4, fee: 150, consentBy: answerBy, leaderId: hanaId, classIds: [c4a.id],
  });
  await A('POST', `/trips/${trip.id}/open`);
  let answered = 0;
  for (let n = 1; n <= 8 && answered < 2; n++) {
    const p = await parent(n);
    const kid = p.kids.find((k: any) => k.class?.id === c4a.id);
    if (!kid) continue;
    await call(p.token, 'POST', `/parent/children/${kid.id}/trips/${trip.id}/consent`, answered === 0
      ? { decision: 'GIVEN', signedName: `Parent of ${kid.firstName}`, note: 'Please remind them to take a hat.' }
      : { decision: 'DECLINED', signedName: `Parent of ${kid.firstName}` });
    answered++;
  }

  // Events: a picnic last week with photos, and sports day next week.
  const at = (offsetDays: number, hour: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offsetDays, hour)).toISOString();
  const picnic = await A('POST', '/events', { title: 'Welcome picnic', description: 'Families and teachers met in the school garden.', place: 'School garden', startsAt: at(-10, 7), endsAt: at(-10, 10), audience: { kind: 'SCHOOL' } });
  const photo = async (eventId: string, rgb: [number, number, number], caption: string) => {
    const form = new FormData();
    form.append('caption', caption);
    form.append('file', new Blob([new Uint8Array(squarePng(160, rgb))], { type: 'image/png' }), 'photo.png');
    const res = await fetch(`${api}/events/${eventId}/photos`, { method: 'POST', headers: { authorization: `Bearer ${admin}` }, body: form });
    if (!res.ok) throw new Error(`photo: ${res.status}`);
  };
  await photo(picnic.id, [226, 160, 90], 'Lunch in the garden');
  await photo(picnic.id, [90, 160, 120], 'The relay race');
  await photo(picnic.id, [90, 120, 200], 'Group photo');
  await A('POST', `/events/${picnic.id}/publish`);
  const sports = await A('POST', '/events', { title: 'Sports day', description: 'Races, relays and a tug of war between the classes.', place: 'School yard', startsAt: at(10, 6), endsAt: at(10, 10), audience: { kind: 'SCHOOL' } });
  await A('POST', `/events/${sports.id}/publish`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
