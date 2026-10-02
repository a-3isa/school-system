import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Client, login, ownerClient, startApp, KID, kid } from './helpers';
import { AttendanceEvaluator } from '../src/devices/evaluator';
import { localParts } from '../src/common/time';
import { rulesFor } from '../src/devices/rules';

const MIN = 60_000;

describe('Automatic attendance (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, teacher: Client, parent: Client;
  let schoolId: string;
  const gw: Record<string, { id: string; serial: string; secret: string; claimCode: string }> = {};
  const ids: Record<string, string> = {};
  const mac = (n: number) => `DC:0D:30:00:00:${String(n).padStart(2, '0')}`;

  // A lesson that started 50 minutes ago and ended 5 minutes ago (Cairo time).
  let start = new Date(Date.now() - 50 * MIN);
  // The gate arrivals 10 minutes before the lesson and the lesson itself must be on one Cairo day.
  if (localParts(new Date(start.getTime() - 15 * MIN), 'Africa/Cairo').date !== localParts(new Date(start.getTime() + 45 * MIN), 'Africa/Cairo').date) {
    start = new Date(Date.now() - 20 * 60 * MIN); // avoid a lesson that crosses midnight
  }
  const end = new Date(start.getTime() + 45 * MIN);
  const local = localParts(start, 'Africa/Cairo');
  const at = (min: number, sec = 0) => start.getTime() + min * MIN + sec * 1000;

  const send = (key: string, sightings: object[]) =>
    request(app.getHttpServer())
      .post('/api/gateway/sightings')
      .auth(gw[key].serial, gw[key].secret)
      .send({ firmware: '1.0.3', sightings });
  const everyMinute = (m: string, rssi: number, from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => ({ mac: m, rssi, at: at(from + i, 15) }));

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'auto');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Auto School', plan: 'SMART', admin: { name: 'Admin', email: 'admin@auto.eg', password: 'admin-pass' } })).body.id;
    admin = await login(app, 'admin@auto.eg', 'admin-pass');
    await admin.patch('/api/school', { schoolDays: [0, 1, 2, 3, 4, 5, 6] }).expect(200);
    await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
    await admin.patch('/api/school', { attendanceMode: 'AUTOMATIC' }).expect(200);

    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    const t = (await admin.post('/api/staff', { name: 'Hana', role: 'TEACHER', email: 'hana@auto.eg', password: 'teacher-pass' })).body;
    ids.class = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id, homeroomTeacherId: t.id })).body.id;
    ids.classC = (await admin.post('/api/classes', { name: '4-C', gradeId: grade.id })).body.id;
    ids.room204 = (await admin.post('/api/rooms', { name: 'Room 204' })).body.id;
    ids.room205 = (await admin.post('/api/rooms', { name: 'Room 205' })).body.id;
    ids.lab = (await admin.post('/api/rooms', { name: 'Lab 1', kind: 'LAB' })).body.id;
    const subject = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    const endLocal = localParts(end, 'Africa/Cairo').time;
    ids.period = (await admin.post('/api/periods', { number: 1, startTime: local.time, endTime: endLocal }).expect(201)).body.id;
    await admin.post('/api/timetable', { classId: ids.class, dayOfWeek: local.dayOfWeek, periodId: ids.period, roomId: ids.room204, subjectId: subject, teacherId: t.id }).expect(201);
    await admin.post('/api/timetable', { classId: ids.classC, dayOfWeek: local.dayOfWeek, periodId: ids.period, roomId: ids.lab, subjectId: subject }).expect(201);

    for (const [i, name] of ['Layla', 'Ali', 'Omar', 'Yara', 'Karim', 'Salma'].entries()) {
      ids[name] = (await admin.post('/api/students', { ...(await kid(admin)), code: `A${i}`, firstName: name, lastName: 'Test', classId: ids.class, parent: { relation: 'GUARDIAN', name: 'Guardian', email: `g-A${i}@au.test.eg` } })).body.id;
    }
    await admin.post('/api/students', { ...(await kid(admin)), code: 'C1', firstName: 'Nour', lastName: 'Test', classId: ids.classC, parent: { relation: 'GUARDIAN', name: 'Guardian', email: `g-C1@au.test.eg` } }).expect(201);
    await admin.post(`/api/students/${ids.Ali}/guardians`, { relation: 'MOTHER', name: 'Rania', email: 'p201200000001@test.eg', phone: '+201200000001', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${ids.Salma}/guardians`, { relation: 'FATHER', name: 'Amr', email: 'p201200000002@test.eg', phone: '+201200000002' }).expect(201);
    teacher = await login(app, 'hana@auto.eg', 'teacher-pass');
    parent = await login(app, 'p201200000001@test.eg', 'parent-pass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('registers gateways (owner) and claims them (school)', async () => {
    for (const key of ['GATE', 'R204', 'R205']) {
      const res = await owner.post('/api/owner/gateways', { serial: `NVTEST-${key}` }).expect(201);
      gw[key] = res.body;
      expect(res.body.claimCode).toMatch(/^GW-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    }
    await owner.post('/api/owner/gateways', { serial: 'NVTEST-GATE' }).expect(409);
    await admin.post('/api/devices/gateways/claim', { claimCode: gw.GATE.claimCode, name: 'Gate A', kind: 'GATE' }).expect(201);
    await admin.post('/api/devices/gateways/claim', { claimCode: gw.R204.claimCode, name: 'Room 204', kind: 'ROOM' }).expect(400); // needs a room
    await admin.post('/api/devices/gateways/claim', { claimCode: gw.R204.claimCode, name: 'Room 204', kind: 'ROOM', roomId: ids.room204 }).expect(201);
    await admin.post('/api/devices/gateways/claim', { claimCode: gw.R205.claimCode, name: 'Room 205', kind: 'ROOM', roomId: ids.room205 }).expect(201);
    await admin.post('/api/devices/gateways/claim', { claimCode: 'GW-NOPE-NOPE', name: 'X', kind: 'GATE' }).expect(404);
    expect((await admin.get('/api/devices/gateways').expect(200)).body).toHaveLength(3);
  });

  it('assigns straps to students', async () => {
    for (const [i, name] of ['Layla', 'Ali', 'Omar', 'Yara', 'Karim', 'Salma'].entries()) {
      await admin.post('/api/devices/straps', { mac: mac(i).replace(/:/g, '').toLowerCase(), studentId: ids[name] }).expect(201);
    }
    await admin.post('/api/devices/straps', { mac: mac(0) }).expect(409);
    await admin.post('/api/devices/straps', { mac: 'bad' }).expect(400);
  });

  it('rejects gateways with the wrong secret', async () => {
    await request(app.getHttpServer()).post('/api/gateway/sightings').auth(gw.GATE.serial, 'wrong').send({ sightings: [] }).expect(401);
  });

  it('gives a gateway a new secret and retires the old one', async () => {
    const send = (secret: string) => request(app.getHttpServer()).post('/api/gateway/sightings').auth(gw.R205.serial, secret).send({ sightings: [] });
    await admin.post(`/api/owner/gateways/${gw.R205.id}/secret`).expect(403); // owner only
    const old = gw.R205.secret;
    const res = await owner.post(`/api/owner/gateways/${gw.R205.id}/secret`).expect(201);
    expect(res.body.secret).not.toBe(old);
    await send(old).expect(401);
    await send(res.body.secret).expect(200);
    gw.R205 = { ...gw.R205, secret: res.body.secret };
    await owner.post('/api/owner/gateways/nope/secret').expect(404);
  });

  it('confirms arrivals at the gate and tells the parent', async () => {
    const res = await send('GATE', [
      { mac: mac(1), rssi: -60, at: at(-10, 0) }, { mac: mac(1), rssi: -58, at: at(-10, 4) }, // Ali
      { mac: mac(5), rssi: -61, at: at(-10, 0) }, { mac: mac(5), rssi: -60, at: at(-10, 5) }, // Salma
      { mac: mac(3), rssi: -90, at: at(-10, 0) }, { mac: mac(3), rssi: -91, at: at(-10, 5) }, // Yara far away: no arrival
      { mac: 'AA:BB:CC:DD:EE:FF', rssi: -50, at: at(-10, 0) },
    ]).expect(200);
    expect(res.body).toEqual({ stored: 6, unknown: 1 });
    const notes = await parent.get('/api/notifications').expect(200);
    expect(notes.body[0]).toEqual(expect.objectContaining({ type: 'attendance.arrived', title: 'Ali arrived at school' }));
    const presence = await prisma.gatePresence.findMany({ where: { studentId: { in: [ids.Ali, ids.Yara] } } });
    expect(presence.map((p) => p.studentId)).toEqual([ids.Ali]);
  });

  it('decides the lesson from room sightings, loudest gateway wins', async () => {
    await send('R204', [
      ...everyMinute(mac(0), -60, 0, 45), // Layla in the room all lesson
      ...everyMinute(mac(1), -84, 0, 45), // Ali heard faintly through the wall…
      ...everyMinute(mac(2), -62, 15, 45), // Omar from minute 15
      ...everyMinute(mac(4), -60, 0, 45), // Karim, but a teacher marks him by hand
    ]).expect(200);
    await send('R205', everyMinute(mac(1), -57, 0, 45)).expect(200); // …because he's next door
    await send('GATE', [{ mac: mac(5), rssi: -55, at: at(20, 0) }]).expect(200); // Salma goes out

    await admin
      .put(`/api/attendance/classes/${ids.class}/periods/${ids.period}`, { date: local.date, marks: [{ studentId: ids.Karim, status: 'EXCUSED', reason: 'Strap not working' }] })
      .expect(200);

    const evaluator = app.get(AttendanceEvaluator);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const period = await prisma.period.findUniqueOrThrow({ where: { id: ids.period } });
    await evaluator.evaluatePeriod(school, rulesFor(school.detection), local.date, period);
    await evaluator.evaluatePeriod(school, rulesFor(school.detection), local.date, period); // idempotent

    const roster = await admin.get(`/api/attendance/classes/${ids.class}/periods/${ids.period}?date=${local.date}`).expect(200);
    const status = Object.fromEntries(roster.body.students.map((s: any) => [s.name.split(' ')[0], `${s.status}/${s.source}`]));
    expect(status).toEqual({
      Layla: 'PRESENT/AUTOMATIC',
      Ali: 'ABSENT/AUTOMATIC',
      Omar: 'LATE/AUTOMATIC',
      Yara: 'ABSENT/AUTOMATIC',
      Karim: 'EXCUSED/MANUAL',
      Salma: 'ABSENT/AUTOMATIC',
    });
  });

  it('raises exceptions for the dashboard', async () => {
    const res = await admin.get(`/api/attendance/exceptions?date=${local.date}`).expect(200);
    const byType = (t: string) => res.body.filter((e: any) => e.type === t);
    expect(byType('NOT_IN_CLASS').map((e: any) => e.student.firstName).sort()).toEqual(['Ali', 'Salma']);
    expect(byType('GATEWAY_OFFLINE')[0].message).toBe('Lab 1 has no gateway. Mark 4-C Math (period 1) manually.');
    expect(res.body).toHaveLength(3);
  });

  it('spots a child who went out through the gate and tells parent and admin', async () => {
    // Run the minute job as if it were 5 minutes after the lesson.
    await app.get(AttendanceEvaluator).tick(new Date(end.getTime() + 5 * MIN));
    const ex = await admin.get(`/api/attendance/exceptions?date=${local.date}&type=LEFT_EARLY`).expect(200);
    expect(ex.body.map((e: any) => e.student.firstName)).toEqual(['Salma']);
    const adminNotes = await admin.get('/api/notifications').expect(200);
    expect(adminNotes.body.some((n: any) => n.type === 'attendance.left')).toBe(true);
  });

  it('flags low strap batteries once', async () => {
    await send('R204', [{ mac: mac(0), rssi: -60, battery: 12 }]).expect(200);
    const evaluator = app.get(AttendanceEvaluator);
    await evaluator.tick(new Date());
    await evaluator.tick(new Date());
    const ex = await admin.get(`/api/attendance/exceptions?type=LOW_BATTERY`).expect(200);
    expect(ex.body).toHaveLength(1);
    expect(ex.body[0].message).toContain('12%');
  });

  it('leaves exceptions to the school office, not teachers', async () => {
    await teacher.get('/api/attendance/exceptions').expect(403);
    const [battery] = (await admin.get('/api/attendance/exceptions?type=LOW_BATTERY')).body; // raised today
    await teacher.post(`/api/attendance/exceptions/${battery.id}/resolve`, { note: 'Battery ordered' }).expect(403);
    const res = await admin.post(`/api/attendance/exceptions/${battery.id}/resolve`, { note: 'Battery ordered' }).expect(201);
    expect(res.body.status).toBe('RESOLVED');
  });

  it('answers the MQTT broker’s login and topic checks', async () => {
    const hook = (path: string, body: object) => request(app.getHttpServer()).post(`/api/gateway/mqtt/${path}`).send(body).expect(200);
    expect((await hook('auth', { username: gw.GATE.serial, password: gw.GATE.secret })).body.result).toBe('allow');
    expect((await hook('auth', { username: gw.GATE.serial, password: 'nope' })).body.result).toBe('deny');
    expect((await hook('acl', { username: gw.GATE.serial, topic: `gw/${gw.GATE.serial}/sightings`, action: 'publish' })).body.result).toBe('allow');
    expect((await hook('acl', { username: gw.GATE.serial, topic: `gw/${gw.R204.serial}/sightings`, action: 'publish' })).body.result).toBe('deny');
  });

  it('validates detection rules', async () => {
    await admin.put('/api/devices/rules', { rules: { room: { presentShare: 2 } } }).expect(400);
    const res = await admin.put('/api/devices/rules', { rules: { room: { presentShare: 0.8 } } }).expect(200);
    expect(res.body.room.presentShare).toBe(0.8);
  });
});
