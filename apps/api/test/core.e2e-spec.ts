process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://school:school@localhost:5432/school_test';
process.env.JWT_SECRET = 'test-secret';
process.env.DISABLE_JOBS = '1';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

describe('Phase 1 core (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let http: ReturnType<typeof request>;

  const login = async (loginId: string, password: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ login: loginId, password }).expect(201);
    return res.body.token as string;
  };
  const as = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body?: object) => request(app.getHttpServer()).put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body?: object) => request(app.getHttpServer()).patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', `Bearer ${token}`),
  });

  let owner: ReturnType<typeof as>;
  let admin: ReturnType<typeof as>;
  let schoolId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    await prisma.user.create({
      data: { email: 'owner@test.eg', name: 'Owner', role: Role.OWNER, passwordHash: await bcrypt.hash('owner-pass', 10) },
    });
    owner = as(await login('owner@test.eg', 'owner-pass'));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects requests without a login', async () => {
    await http.get('/api/students').expect(401);
  });

  it('lets the owner create a school on a plan', async () => {
    const res = await owner
      .post('/api/owner/schools', { name: 'Nile Valley School', plan: 'ESSENTIALS', admin: { name: 'Samia Adel', email: 'Admin@NV.eg', password: 'admin-pass' } })
      .expect(201);
    schoolId = res.body.id;
    const on = res.body.modules.filter((m: any) => m.enabled).map((m: any) => m.key);
    expect(on.sort()).toEqual(['attendance', 'core', 'messaging']);
    admin = as(await login('admin@nv.eg', 'admin-pass'));
  });

  it('switches modules with their dependencies', async () => {
    const res = await owner.put(`/api/owner/schools/${schoolId}/modules/canteen`, { enabled: true }).expect(200);
    expect(res.body.alsoEnabled).toEqual(['payments']);
    const blocked = await owner.put(`/api/owner/schools/${schoolId}/modules/payments`, { enabled: false }).expect(400);
    expect(blocked.body.message).toContain('Canteen');
    await owner.put(`/api/owner/schools/${schoolId}/modules/canteen`, { enabled: false }).expect(200);
    await owner.put(`/api/owner/schools/${schoolId}/modules/core`, { enabled: false }).expect(400);
  });

  it('keeps module switching away from school admins', async () => {
    await admin.put(`/api/owner/schools/${schoolId}/modules/transport`, { enabled: true }).expect(403);
    const me = await admin.get('/api/auth/me').expect(200);
    expect(me.body.modules).toContain('attendance');
  });

  it('allows automatic attendance only when the feature is on', async () => {
    await admin.patch('/api/school', { attendanceMode: 'AUTOMATIC' }).expect(400);
    // Automatic attendance (straps) comes with the subscription: the owner switches it on, not the school.
    await admin.patch('/api/modules/attendance/features', { features: { automatic: true } }).expect(403);
    expect((await admin.get('/api/auth/me').expect(200)).body.straps).toBe(false);
    await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
    const me = (await admin.get('/api/auth/me').expect(200)).body;
    expect(me.straps).toBe(true);
    expect(me.attendanceMode).toBe('AUTOMATIC'); // the subscription sets it
    await admin.patch('/api/modules/attendance/features', { features: { flying: true } }).expect(400);
  });

  let classId: string, roomId: string, room2Id: string, subjectId: string, period1: string, teacherId: string;

  it('sets up grades, classes, rooms, subjects and periods', async () => {
    const grade = await admin.post('/api/grades', { name: 'Grade 4', order: 4 }).expect(201);
    const teacher = await admin.post('/api/staff', { name: 'Hana Nabil', role: 'TEACHER', email: 'hana@nv.eg', password: 'teacher-pass' }).expect(201);
    teacherId = teacher.body.id;
    const cls = await admin.post('/api/classes', { name: '4-A', gradeId: grade.body.id, homeroomTeacherId: teacherId }).expect(201);
    classId = cls.body.id;
    await admin.post('/api/classes', { name: '4-A', gradeId: grade.body.id }).expect(409);
    roomId = (await admin.post('/api/rooms', { name: 'Room 204' }).expect(201)).body.id;
    room2Id = (await admin.post('/api/rooms', { name: 'Lab 1', kind: 'LAB' }).expect(201)).body.id;
    subjectId = (await admin.post('/api/subjects', { name: 'Math' }).expect(201)).body.id;
    period1 = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' }).expect(201)).body.id;
    const overlap = await admin.post('/api/periods', { number: 2, startTime: '08:30', endTime: '09:15' }).expect(400);
    expect(overlap.body.message).toContain('Overlaps period 1');
    await admin.post('/api/periods', { number: 2, startTime: '08:45', endTime: '09:30' }).expect(201);
    await admin.post('/api/periods', { number: 3, startTime: '9:00', endTime: '09:45' }).expect(400);
  });

  it('builds a timetable and explains clashes', async () => {
    // Wednesday = 3
    await admin.post('/api/timetable', { classId, dayOfWeek: 3, periodId: period1, roomId, subjectId, teacherId }).expect(201);
    const clash = await admin.post('/api/timetable', { classId, dayOfWeek: 3, periodId: period1, roomId: room2Id, subjectId }).expect(409);
    expect(clash.body.message).toBe('4-A already has Math in period 1.');
    await admin.post('/api/timetable', { classId, dayOfWeek: 5, periodId: period1, roomId, subjectId }).expect(400); // Friday
  });

  it('finds the lesson happening in a room right now', async () => {
    // 08:10 in Cairo on Wednesday 30 Sep 2026.
    const res = await admin.get(`/api/timetable/now?roomId=${roomId}&at=2026-09-30T05:10:00Z`).expect(200);
    expect(res.body.period.number).toBe(1);
    expect(res.body.lesson.class.name).toBe('4-A');
    const between = await admin.get(`/api/timetable/now?roomId=${roomId}&at=2026-09-30T04:00:00Z`).expect(200);
    expect(between.body.lesson).toBeNull();
  });

  let laylaId: string;

  it('manages students and at most two parents', async () => {
    const layla = await admin.post('/api/students', { code: '2019-0412', firstName: 'Layla', lastName: 'Hussein', classId }).expect(201);
    laylaId = layla.body.id;
    await admin.post('/api/students', { code: '2019-0412', firstName: 'X', lastName: 'Y' }).expect(409);
    await admin.post(`/api/students/${laylaId}/guardians`, { relation: 'MOTHER', name: 'Nadia Hussein', email: 'p201000000001@test.eg', phone: '+201000000001', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${laylaId}/guardians`, { relation: 'MOTHER', name: 'Other', email: 'p201000000009@test.eg', phone: '+201000000009' }).expect(400);
    const both = await admin.post(`/api/students/${laylaId}/guardians`, { relation: 'FATHER', name: 'Ibrahim Hussein', email: 'p201000000002@test.eg', phone: '+201000000002' }).expect(201);
    expect(both.body.guardians).toHaveLength(2);

    // A sibling reuses the mother's existing account.
    const karim = await admin.post('/api/students', { code: '2022-0133', firstName: 'Karim', lastName: 'Hussein' }).expect(201);
    await admin.post(`/api/students/${karim.body.id}/guardians`, { relation: 'MOTHER', name: 'Nadia Hussein', email: 'p201000000001@test.eg', phone: '+201000000001' }).expect(201);

    const parent = as(await login('p201000000001@test.eg', 'parent-pass'));
    expect((await parent.get('/api/auth/me').expect(200)).body.consentAt).toBeNull();
    await parent.post('/api/parent/consent').expect(201);
    expect((await parent.get('/api/auth/me').expect(200)).body.consentAt).not.toBeNull();
    const kids = await parent.get('/api/parent/children').expect(200);
    expect(kids.body.map((k: any) => k.firstName).sort()).toEqual(['Karim', 'Layla']);
    await parent.get('/api/students').expect(403);
    await parent.get('/api/timetable').expect(403);
    await parent.get('/api/classes').expect(403);

    // The school restricts Layla for this parent.
    const nadiaId = both.body.guardians.find((g: any) => g.relation === 'MOTHER').userId;
    await admin.patch(`/api/students/${laylaId}/guardians/${nadiaId}`, { restricted: true }).expect(200);
    const after = await parent.get('/api/parent/children').expect(200);
    expect(after.body.map((k: any) => k.firstName)).toEqual(['Karim']);
  });

  it('keeps each school’s data separate', async () => {
    await owner.post('/api/owner/schools', { name: 'Other School', plan: 'SMART', admin: { name: 'B', email: 'b@other.eg', password: 'other-pass' } }).expect(201);
    const other = as(await login('b@other.eg', 'other-pass'));
    await other.get(`/api/students/${laylaId}`).expect(404);
    expect((await other.get('/api/students').expect(200)).body).toEqual([]);
    await other.post('/api/timetable', { classId, dayOfWeek: 0, periodId: period1, roomId, subjectId }).expect(400);
  });

  it('limits writes by role and records an audit trail', async () => {
    const teacher = as(await login('hana@nv.eg', 'teacher-pass'));
    await teacher.post('/api/students', { code: 'T-1', firstName: 'A', lastName: 'B' }).expect(403);
    // A teacher sees only their own lessons, not the whole school.
    await teacher.get('/api/students').expect(403);
    await teacher.get('/api/locations').expect(403);
    await teacher.get('/api/attendance/summary?date=2026-09-30').expect(403);
    const mine = await teacher.get('/api/timetable').expect(200);
    const me = (await teacher.get('/api/auth/me').expect(200)).body;
    expect(mine.body.every((e: any) => e.teacher?.id === me.id)).toBe(true);
    const audit = await admin.get('/api/audit').expect(200);
    const actions = audit.body.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['student.create', 'guardian.add', 'timetable.create', 'module.features']));
    expect(audit.body.find((a: any) => a.action === 'student.create').actorName).toEqual(expect.any(String));
  });

  it('validates input', async () => {
    const res = await admin.post('/api/students', { code: 'X', firstName: 'A', lastName: 'B', hacker: true }).expect(400);
    expect(JSON.stringify(res.body.message)).toContain('hacker');
  });
});
