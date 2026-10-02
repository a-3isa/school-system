import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, kid, login, ownerClient, startApp } from './helpers';

// How an Egyptian school is organised: stages and grades, class details, and
// the school year with its terms, mid-year break and holidays.
describe('Egyptian school structure (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let admin: Client, worker: Client;
  let yearId: string;

  beforeAll(async () => {
    app = await startApp();
    const owner = await ownerClient(app, prisma, 'eg');
    await owner.post('/api/owner/schools', { name: 'Egypt School', plan: 'ESSENTIALS', admin: { name: 'Admin', email: 'admin@eg.eg', password: 'admin-pass' } }).expect(201);
    admin = await login(app, 'admin@eg.eg', 'admin-pass');
    // Sunday to Thursday, as most Egyptian schools.
    await admin.patch('/api/school', { schoolDays: [0, 1, 2, 3, 4] }).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('sets up the Egyptian grades for the stages the school has', async () => {
    const grades = (await admin.post('/api/grades/egypt', { stages: ['PRIMARY', 'SECONDARY'] }).expect(201)).body;
    expect(grades.map((g: any) => g.name)).toEqual(['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'Secondary 1', 'Secondary 2', 'Secondary 3']);
    expect(grades[3]).toEqual(expect.objectContaining({ stage: 'PRIMARY', nameAr: 'الصف الرابع الابتدائي' }));
    // Again, with KG added: only the missing ones are created.
    const again = (await admin.post('/api/grades/egypt', { stages: ['KG', 'PRIMARY'] }).expect(201)).body;
    expect(again).toHaveLength(11);
    expect(again[0]).toEqual(expect.objectContaining({ name: 'KG 1', stage: 'KG', nameAr: 'الروضة الأولى' }));
    await admin.post('/api/grades/egypt', { stages: ['UNI'] }).expect(400);
  });

  it('keeps a class’s section, system, boys or girls, stream and capacity', async () => {
    const grades = (await admin.get('/api/grades').expect(200)).body;
    const p4 = grades.find((g: any) => g.name === 'Primary 4').id;
    const s2 = grades.find((g: any) => g.name === 'Secondary 2').id;
    const cls = (await admin.post('/api/classes', { name: '4/1', gradeId: p4, section: '1', system: 'NATIONAL_LANGUAGES', capacity: 30 }).expect(201)).body;
    expect(cls).toEqual(expect.objectContaining({ section: '1', system: 'NATIONAL_LANGUAGES', gender: 'MIXED', capacity: 30, stream: null }));
    // Only secondary classes have a stream.
    expect((await admin.post('/api/classes', { name: '4/2', gradeId: p4, stream: 'SCIENCE' }).expect(400)).body.message).toContain('Only secondary');
    const sci = (await admin.post('/api/classes', { name: 'Sec 2/1', gradeId: s2, gender: 'GIRLS', stream: 'SCIENCE' }).expect(201)).body;
    expect(sci).toEqual(expect.objectContaining({ gender: 'GIRLS', stream: 'SCIENCE' }));
    await admin.patch(`/api/classes/${cls.id}`, { stream: 'LITERARY' }).expect(400);
    const edited = (await admin.patch(`/api/classes/${cls.id}`, { capacity: 32, system: null, homeroomTeacherId: '' }).expect(200)).body;
    expect(edited).toEqual(expect.objectContaining({ capacity: 32, system: null, homeroomTeacherId: null, name: '4/1' }));
    await admin.post('/api/classes', { name: 'X', gradeId: p4, capacity: 0 }).expect(400);
    const list = (await admin.get('/api/classes').expect(200)).body;
    expect(list[0].grade.stage).toBe('PRIMARY');
  });

  it('knows the school year: terms, the mid-year break and holidays', async () => {
    const year = { name: '2026/2027', startsOn: '2026-09-13', endsOn: '2027-06-30', term2StartsOn: '2027-02-07', breakFrom: '2027-01-24', breakTo: '2027-02-04' };
    await admin.post('/api/school/years', { ...year, endsOn: '2026-09-01' }).expect(400);
    await admin.post('/api/school/years', { ...year, breakTo: undefined }).expect(400);
    await admin.post('/api/school/years', { ...year, breakFrom: '2026-08-01' }).expect(400);
    await admin.post('/api/school/years', { ...year, name: '2026-27' }).expect(400);
    yearId = (await admin.post('/api/school/years', year).expect(201)).body.id;
    expect((await admin.post('/api/school/years', { name: '2027/2028', startsOn: '2027-06-01', endsOn: '2028-06-30' }).expect(400)).body.message).toContain('2026/2027');

    const day = async (date: string) => (await admin.get(`/api/school/day?date=${date}`).expect(200)).body;
    expect(await day('2026-10-04')).toEqual(expect.objectContaining({ open: true, term: 1, year: '2026/2027' })); // a Sunday
    expect(await day('2026-10-09')).toEqual(expect.objectContaining({ open: false, reason: 'WEEKEND' })); // a Friday
    expect(await day('2026-09-10')).toEqual(expect.objectContaining({ open: false, reason: 'OUTSIDE_YEAR' }));
    expect(await day('2027-01-26')).toEqual(expect.objectContaining({ open: false, reason: 'BREAK' }));
    expect(await day('2027-02-08')).toEqual(expect.objectContaining({ open: true, term: 2 }));

    // Egypt's fixed public holidays that fall on a school day of this year.
    const added = (await admin.post('/api/school/holidays/egypt', { yearId, lang: 'en' }).expect(201)).body;
    expect(added.map((h: any) => `${h.fromDate.slice(0, 10)} ${h.name}`)).toEqual([
      '2026-10-06 Armed Forces Day', '2027-01-07 Coptic Christmas', '2027-04-25 Sinai Liberation Day', '2027-06-30 June 30 Revolution',
    ]); // 25 January 2027 falls in the mid-year break, and 1 May 2027 is a Saturday.
    expect((await admin.post('/api/school/holidays/egypt', { yearId, lang: 'en' }).expect(201)).body).toEqual([]); // not twice
    expect(await day('2026-10-06')).toEqual(expect.objectContaining({ open: false, reason: 'HOLIDAY', name: 'Armed Forces Day' }));
    // Eid moves with the moon: the school adds it.
    await admin.post('/api/school/holidays', { name: 'Eid al-Fitr', fromDate: '2027-03-09', toDate: '2027-03-11' }).expect(201);
    await admin.post('/api/school/holidays', { name: 'Bad', fromDate: '2027-03-11', toDate: '2027-03-09' }).expect(400);
    expect(await day('2027-03-10')).toEqual(expect.objectContaining({ open: false, name: 'Eid al-Fitr' }));
    expect((await admin.get('/api/school/holidays').expect(200)).body).toHaveLength(5);
  });

  it('has a social worker who follows up absences', async () => {
    await admin.post('/api/staff', { name: 'Hoda', role: 'SOCIAL_WORKER', email: 'hoda@eg.eg', password: 'worker-pass-1' }).expect(201);
    worker = await login(app, 'hoda@eg.eg', 'worker-pass-1');
    await worker.get('/api/students').expect(200);
    await worker.get('/api/attendance/exceptions').expect(200);
    await worker.post('/api/grades/egypt', { stages: ['KG'] }).expect(403);
    const grade = (await admin.get('/api/grades')).body[0].id;
    const cls = (await admin.post('/api/classes', { name: 'KG1/1', gradeId: grade }).expect(201)).body;
    await admin.post('/api/students', { ...(await kid(admin)), code: 'K1', firstName: 'Nour', lastName: 'Ali', classId: cls.id, parent: { relation: 'MOTHER', name: 'Mona', email: 'mona@eg.eg' } }).expect(201);
  });
});
