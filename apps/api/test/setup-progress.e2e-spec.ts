import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, login, ownerClient, startApp } from './helpers';

/**
 * The counts behind the "Getting your school ready" guide on Today: a new school starts at nothing,
 * and each step of setting up moves exactly the number it should.
 */
describe('School set-up progress (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, other: Client, teacher: Client;

  const progress = async (c: Client = admin) => (await c.get('/api/school/setup').expect(200)).body;

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'progress');
    await owner.post('/api/owner/schools', { name: 'Fresh School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@fresh.eg', password: 'admin-pass' } }).expect(201);
    admin = await login(app, 'admin@fresh.eg', 'admin-pass');
    await owner.post('/api/owner/schools', { name: 'Busy School', plan: 'COMPLETE', admin: { name: 'Other', email: 'admin@busy.eg', password: 'admin-pass' } }).expect(201);
    other = await login(app, 'admin@busy.eg', 'admin-pass');
    await admin.post('/api/staff', { name: 'Hana', role: 'TEACHER', email: 'hana@fresh.eg', password: 'staff-pass' }).expect(201);
    teacher = await login(app, 'hana@fresh.eg', 'staff-pass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('starts at nothing for a new school, apart from the teacher just added', async () => {
    expect(await progress()).toEqual({ years: 0, grades: 0, classes: 0, subjects: 0, gradeSubjects: 0, periods: 0, rooms: 0, teachers: 1, classSubjects: 0, withoutTeacher: 0, lessons: 0, students: 0 });
  });

  it('counts each step as it is done, and who still teaches nothing', async () => {
    await admin.post('/api/school/years', { name: '2026/2027', startsOn: '2026-09-20', endsOn: '2027-06-10' }).expect(201);
    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body.id;
    const cls = (await admin.post('/api/classes', { name: '4-A', gradeId: grade })).body.id;
    const math = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    await admin.post('/api/subjects', { name: 'Science' });
    await admin.put(`/api/grades/${grade}/subjects/${math}`, {}).expect(200);
    const room = (await admin.post('/api/rooms', { name: 'Room A' })).body.id;
    const period = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' })).body.id;

    expect(await progress()).toMatchObject({ years: 1, grades: 1, classes: 1, subjects: 2, gradeSubjects: 1, periods: 1, rooms: 1, classSubjects: 1, withoutTeacher: 1, lessons: 0 });

    // Giving the subject its teacher in the class leaves nobody unassigned; placing it adds a lesson.
    const hana = (await prisma.user.findFirstOrThrow({ where: { email: 'hana@fresh.eg' } })).id;
    await admin.put('/api/timetable/assign', { classId: cls, subjectId: math, teacherId: hana }).expect(200);
    await admin.post('/api/timetable', { classId: cls, dayOfWeek: 0, periodId: period, subjectId: math, roomId: room }).expect(201);
    expect(await progress()).toMatchObject({ classSubjects: 1, withoutTeacher: 0, lessons: 1 });
  });

  it('counts only this school', async () => {
    expect(await progress(other)).toEqual({ years: 0, grades: 0, classes: 0, subjects: 0, gradeSubjects: 0, periods: 0, rooms: 0, teachers: 0, classSubjects: 0, withoutTeacher: 0, lessons: 0, students: 0 });
  });

  it('is for Student Affairs only', async () => {
    await teacher.get('/api/school/setup').expect(403);
  });

  it('no longer counts a teacher who has been deactivated', async () => {
    const hana = await prisma.user.findFirstOrThrow({ where: { email: 'hana@fresh.eg' } });
    await prisma.user.update({ where: { id: hana.id }, data: { active: false } });
    expect((await progress()).teachers).toBe(0);
  });
});
