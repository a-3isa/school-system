import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Client, login, ownerClient, startApp, KID, kid } from './helpers';
import { localParts } from '../src/common/time';
import { AttendanceEvaluator } from '../src/devices/evaluator';

const MIN = 60_000;

// A lesson that started 15 minutes ago and ends in 30 (Cairo time). The
// teacher signs in and sees it; the parents of a child who came in through the
// gate but isn't in the room hear about it at once.
describe('The lesson happening now (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let admin: Client, teacher: Client, salmaParent: Client, omarParent: Client, karimParent: Client;
  let schoolId: string, classId: string, periodId: string;
  const gw: Record<string, { serial: string; secret: string }> = {};
  const ids: Record<string, string> = {};
  const mac = (n: number) => `DC:0D:30:00:02:${String(n).padStart(2, '0')}`;
  const now = Date.now();
  const start = new Date(now - 15 * MIN);
  const end = new Date(now + 30 * MIN);
  const local = localParts(start, 'Africa/Cairo');
  // The lesson must not cross midnight in Cairo.
  // Everything here, from Karim's arrival an hour ago to the end of the lesson, must be on one Cairo day.
  const fits = local.date === localParts(end, 'Africa/Cairo').date && local.date === localParts(new Date(now - 60 * MIN), 'Africa/Cairo').date;
  const send = (key: string, sightings: object[]) =>
    request(app.getHttpServer()).post('/api/gateway/sightings').auth(gw[key].serial, gw[key].secret).send({ sightings }).expect(200);
  const titles = async (c: Client) => (await c.get('/api/notifications').expect(200)).body.map((n: any) => n.title);

  beforeAll(async () => {
    app = await startApp();
    if (!fits) return;
    const owner = await ownerClient(app, prisma, 'live');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Live School', plan: 'SMART', admin: { name: 'Admin', email: 'admin@live.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@live.eg', 'admin-pass');
    await admin.patch('/api/school', { schoolDays: [0, 1, 2, 3, 4, 5, 6] }).expect(200);
    await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
    await admin.patch('/api/school', { attendanceMode: 'AUTOMATIC' }).expect(200);
    const t = (await admin.post('/api/staff', { name: 'Hana', role: 'TEACHER', email: 'hana@live.eg', password: 'teacher-pass' }).expect(201)).body;
    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    classId = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id })).body.id;
    const room = (await admin.post('/api/rooms', { name: 'Room 204' })).body.id;
    const subject = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    periodId = (await admin.post('/api/periods', { number: 1, startTime: local.time, endTime: localParts(end, 'Africa/Cairo').time }).expect(201)).body.id;
    await admin.post('/api/timetable', { classId, dayOfWeek: local.dayOfWeek, periodId, roomId: room, subjectId: subject, teacherId: t.id }).expect(201);
    for (const [key, kind, name] of [['GATE', 'GATE', 'Gate A'], ['R204', 'ROOM', 'Room 204']] as const) {
      const g = (await owner.post('/api/owner/gateways', { serial: `LIVE-${key}` }).expect(201)).body;
      gw[key] = g;
      await admin.post('/api/devices/gateways/claim', { claimCode: g.claimCode, name, kind, roomId: kind === 'ROOM' ? room : undefined }).expect(201);
    }
    for (const [i, name] of ['Layla', 'Salma', 'Omar', 'Karim'].entries()) {
      ids[name] = (await admin.post('/api/students', { ...(await kid(admin)), code: `V${i}`, firstName: name, lastName: 'Test', classId, parent: { relation: 'GUARDIAN', name: 'Guardian', email: `g-V${i}@ll.test.eg` } })).body.id;
      await admin.post('/api/devices/straps', { mac: mac(i), studentId: ids[name] }).expect(201);
    }
    await admin.post(`/api/students/${ids.Salma}/guardians`, { relation: 'MOTHER', name: 'Mona', email: 'p201500000001@test.eg', phone: '+201500000001', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${ids.Karim}/guardians`, { relation: 'FATHER', name: 'Amr', email: 'p201500000003@test.eg', phone: '+201500000003', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${ids.Omar}/guardians`, { relation: 'MOTHER', name: 'Rania', email: 'p201500000002@test.eg', phone: '+201500000002', password: 'parent-pass' }).expect(201);
    teacher = await login(app, 'hana@live.eg', 'teacher-pass');
    salmaParent = await login(app, 'p201500000001@test.eg', 'parent-pass');
    omarParent = await login(app, 'p201500000002@test.eg', 'parent-pass');
    karimParent = await login(app, 'p201500000003@test.eg', 'parent-pass');

    // Layla and Salma came in through the gate before the lesson; Omar's strap stayed at home.
    for (const n of [0, 1]) await send('GATE', [{ mac: mac(n), rssi: -52, at: now - 25 * MIN }, { mac: mac(n), rssi: -50, at: now - 25 * MIN + 4000 }]);
    // Karim came in early and went out through the gate before the lesson: he isn't at school.
    await send('GATE', [{ mac: mac(3), rssi: -52, at: now - 60 * MIN }, { mac: mac(3), rssi: -50, at: now - 60 * MIN + 4000 }]);
    await send('GATE', [{ mac: mac(3), rssi: -52, at: now - 30 * MIN }, { mac: mac(3), rssi: -50, at: now - 30 * MIN + 4000 }]);
    // Layla has been in Room 204 since the lesson started; Salma hasn't.
    await send('R204', Array.from({ length: 15 }, (_, i) => ({ mac: mac(0), rssi: -60, at: start.getTime() + i * MIN + 20_000 })));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('opens on the teacher’s lesson right now', async () => {
    if (!fits) return;
    const res = await teacher.get('/api/attendance/now').expect(200);
    expect(res.body.now).toEqual(expect.objectContaining({ classId, periodId, subject: 'Math', room: 'Room 204' }));
  });

  it('shows the teacher who is in the room and where the others are', async () => {
    if (!fits) return;
    const res = await teacher.get(`/api/attendance/classes/${classId}/periods/${periodId}?date=${local.date}`).expect(200);
    expect(res.body.lessonState).toBe('now');
    expect(res.body.gatewayWorking).toBe(true);
    const by = Object.fromEntries(res.body.students.map((s: any) => [s.name.split(' ')[0], s.live]));
    expect(by.Layla).toEqual(expect.objectContaining({ inRoom: true, lastPlace: 'Room 204' }));
    expect(by.Salma).toEqual(expect.objectContaining({ inRoom: false, lastPlace: 'Gate A' }));
    expect(by.Salma.arrivedAt).toBeTruthy();
    expect(by.Omar).toEqual(expect.objectContaining({ inRoom: false, lastPlace: null, arrivedAt: null }));
  });

  it('tells the parents of a child at school but not in the lesson, once', async () => {
    if (!fits) return;
    const evaluator = app.get(AttendanceEvaluator);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    await evaluator.evaluateSchool(school, new Date());
    await evaluator.evaluateSchool(school, new Date());
    expect(await titles(salmaParent)).toEqual(['Salma was absent from Math in Room 204', 'Salma arrived at school']);
    expect(await titles(omarParent)).toEqual([]); // not at school: the daily absence notice covers it
    expect(await titles(karimParent)).toEqual(['Karim left school early', 'Karim arrived at school']); // went out before the lesson: no lesson message
    const open = await admin.get(`/api/attendance/exceptions?date=${local.date}&status=OPEN&type=NOT_IN_CLASS`).expect(200);
    expect(open.body.map((e: any) => e.studentId)).toEqual([ids.Salma]);
    const roster = await teacher.get(`/api/attendance/classes/${classId}/periods/${periodId}?date=${local.date}`).expect(200);
    const told = Object.fromEntries(roster.body.students.map((s: any) => [s.name.split(' ')[0], s.live.parentsToldAt]));
    expect(told.Salma).toBeTruthy();
    expect(told.Layla).toBeNull();
  });

  it('lets the teacher mark a child present, which tells the parents again', async () => {
    if (!fits) return;
    await teacher
      .put(`/api/attendance/classes/${classId}/periods/${periodId}`, {
        date: local.date,
        marks: [
          { studentId: ids.Salma, status: 'PRESENT', reason: 'Strap forgotten' },
          { studentId: ids.Omar, status: 'PRESENT', reason: 'Strap forgotten' },
        ],
      })
      .expect(200);
    expect(await titles(salmaParent)).toEqual(['Salma is in Math in Room 204', 'Salma was absent from Math in Room 204', 'Salma arrived at school']);
    expect(await titles(omarParent)).toEqual([]);
    const open = await admin.get(`/api/attendance/exceptions?date=${local.date}&status=OPEN&type=NOT_IN_CLASS`).expect(200);
    expect(open.body).toHaveLength(0);
  });
});
