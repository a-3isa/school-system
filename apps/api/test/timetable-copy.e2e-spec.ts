import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, login, ownerClient, startApp } from './helpers';

/**
 * Copying one class's week to another class of the same year group. The subjects and periods are the
 * same; what the new class gets for itself is its own teacher for each subject and its own classroom.
 */
describe('Copying a class’s timetable (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, other: Client, t1: Client;
  let schoolId: string;
  const id: Record<string, string> = {};

  const copy = (body: object, c: Client = admin) => c.post('/api/timetable/copy', body);
  const weekOf = async (classId: string) =>
    (await prisma.timetableEntry.findMany({ where: { classId }, include: { subject: true, room: true, period: true }, orderBy: [{ dayOfWeek: 'asc' }, { period: { number: 'asc' } }] })).map(
      (l) => [l.dayOfWeek, l.period.number, l.subject.name, l.room.name, l.teacherId],
    );
  const assign = (classId: string, subjectId: string, teacherId: string) => admin.put('/api/timetable/assign', { classId, subjectId, teacherId }).expect(200);
  const place = (classId: string, dayOfWeek: number, periodId: string, subjectId: string, roomId: string) =>
    admin.post('/api/timetable', { classId, dayOfWeek, periodId, subjectId, roomId });

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'copy');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Copy School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@copy.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@copy.eg', 'admin-pass');
    await owner.post('/api/owner/schools', { name: 'Other School', plan: 'COMPLETE', admin: { name: 'Other', email: 'admin@other-copy.eg', password: 'admin-pass' } }).expect(201);
    other = await login(app, 'admin@other-copy.eg', 'admin-pass');
    for (const [key, name] of [['m1', 'Hana'], ['s1', 'Mona'], ['m2', 'Sherif'], ['s2', 'Karim'], ['m3', 'Nour']]) {
      id[key] = (await admin.post('/api/staff', { name, role: 'TEACHER', email: `${key}@copy.eg`, password: 'staff-pass' }).expect(201)).body.id;
    }
    t1 = await login(app, 'm1@copy.eg', 'staff-pass');

    id.grade4 = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body.id;
    id.grade5 = (await admin.post('/api/grades', { name: 'Grade 5', order: 5 })).body.id;
    id.math = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    id.science = (await admin.post('/api/subjects', { name: 'Science' })).body.id;
    for (const g of [id.grade4, id.grade5]) for (const s of [id.math, id.science]) await admin.put(`/api/grades/${g}/subjects/${s}`, {}).expect(200);
    for (const [key, name, grade] of [['a', '4-A', id.grade4], ['b', '4-B', id.grade4], ['c', '4-C', id.grade4], ['d', '4-D', id.grade4], ['e', '4-E', id.grade4], ['f', '4-F', id.grade4], ['five', '5-A', id.grade5]]) {
      id[key] = (await admin.post('/api/classes', { name, gradeId: grade })).body.id;
    }
    id.roomA = (await admin.post('/api/rooms', { name: 'Room A' })).body.id;
    id.roomB = (await admin.post('/api/rooms', { name: 'Room B' })).body.id;
    id.roomC = (await admin.post('/api/rooms', { name: 'Room C' })).body.id;
    id.roomD = (await admin.post('/api/rooms', { name: 'Room D' })).body.id;
    id.lab = (await admin.post('/api/rooms', { name: 'Lab', kind: 'LAB' })).body.id;
    id.lab2 = (await admin.post('/api/rooms', { name: 'Lab 2', kind: 'LAB' })).body.id;
    for (const [key, n, a, b] of [['p1', 1, '08:00', '08:45'], ['p2', 2, '08:45', '09:30'], ['p3', 3, '09:50', '10:35']] as const) {
      id[key] = (await admin.post('/api/periods', { number: n, startTime: a, endTime: b })).body.id;
    }

    // Each class has its own teacher for each subject.
    await assign(id.a, id.math, id.m1);
    await assign(id.a, id.science, id.s1);
    await assign(id.b, id.math, id.m2);
    await assign(id.b, id.science, id.s2);
    // 4-A's week: Maths on Sunday and Monday first thing in its classroom, Science in the lab on Sunday.
    await place(id.a, 0, id.p1, id.math, id.roomA).expect(201);
    await place(id.a, 0, id.p2, id.science, id.lab).expect(201);
    await place(id.a, 1, id.p1, id.math, id.roomA).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('copies the week with the new class’s own teachers and classroom, and a free lab of the same kind', async () => {
    const res = (await copy({ fromClassId: id.a, toClassId: id.b, roomId: id.roomB }).expect(201)).body;
    expect(res).toEqual({ copied: 3, skipped: [], withoutTeacher: [] });
    expect(await weekOf(id.b)).toEqual([
      [0, 1, 'Math', 'Room B', id.m2], // Sherif, not Hana
      [0, 2, 'Science', 'Lab 2', id.s2], // Karim, not Mona; 4-A has the lab then
      [1, 1, 'Math', 'Room B', id.m2],
    ]);
    expect(await weekOf(id.a)).toHaveLength(3); // the first class is untouched
    expect(await prisma.auditLog.count({ where: { schoolId, action: 'timetable.copy' } })).toBe(1);
  });

  it('copies a subject that has no teacher in the new class yet, and says which ones', async () => {
    // 4-C has no teachers; both labs are taken on Sunday period 2 (4-A and 4-B), so that lesson is left out.
    const res = (await copy({ fromClassId: id.a, toClassId: id.c, roomId: id.roomC }).expect(201)).body;
    expect(res.copied).toBe(2);
    expect(res.withoutTeacher).toEqual([{ subject: 'Math', subjectAr: null }]);
    expect(res.skipped).toEqual([{ dayOfWeek: 0, period: 2, subject: 'Science', subjectAr: null, reason: 'ROOM_BUSY', detail: 'Lab' }]);
    expect((await weekOf(id.c)).map((l) => l[4])).toEqual([null, null]);
    // Giving 4-C its Maths teacher later takes all of those lessons.
    await assign(id.c, id.math, id.m3);
    expect((await weekOf(id.c)).map((l) => l[4])).toEqual([id.m3, id.m3]);
  });

  it('fills only the empty periods unless told to replace, and says what was already there', async () => {
    const again = (await copy({ fromClassId: id.a, toClassId: id.b, roomId: id.roomB }).expect(201)).body;
    expect(again.copied).toBe(0);
    expect(again.skipped.map((s: any) => [s.dayOfWeek, s.period, s.reason])).toEqual([[0, 1, 'FILLED'], [0, 2, 'FILLED'], [1, 1, 'FILLED']]);
    await prisma.timetableEntry.deleteMany({ where: { classId: id.b, dayOfWeek: 1 } });
    expect((await copy({ fromClassId: id.a, toClassId: id.b, roomId: id.roomB }).expect(201)).body.copied).toBe(1); // only the emptied period
    expect((await copy({ fromClassId: id.a, toClassId: id.b, roomId: id.roomB, replace: true }).expect(201)).body).toEqual({ copied: 3, skipped: [], withoutTeacher: [] });
    expect(await weekOf(id.b)).toHaveLength(3);
  });

  it('leaves out a lesson whose teacher is already teaching another class then', async () => {
    // Sherif (4-B's Maths) is teaching 5-A's Maths on Monday period 1, so he can't also take 4-B's copy of that lesson.
    await prisma.timetableEntry.deleteMany({ where: { classId: id.b } });
    await assign(id.five, id.math, id.m2);
    await place(id.five, 1, id.p1, id.math, id.roomD).expect(201);
    const res = (await copy({ fromClassId: id.a, toClassId: id.b, roomId: id.roomB, replace: true }).expect(201)).body;
    expect(res.copied).toBe(2);
    expect(res.skipped).toEqual([{ dayOfWeek: 1, period: 1, subject: 'Math', subjectAr: null, reason: 'TEACHER_BUSY', detail: 'Sherif' }]);
  });

  it('needs no classroom when the first class has lessons only in shared rooms, and takes the free lab', async () => {
    await assign(id.e, id.science, id.s1);
    await place(id.e, 4, id.p3, id.science, id.lab).expect(201);
    const res = (await copy({ fromClassId: id.e, toClassId: id.f }).expect(201)).body;
    expect(res).toEqual({ copied: 1, skipped: [], withoutTeacher: [{ subject: 'Science', subjectAr: null }] });
    expect(await weekOf(id.f)).toEqual([[4, 3, 'Science', 'Lab 2', null]]); // 4-E has the lab then
  });

  it('refuses the same class, another year group, a missing classroom, an empty week and strangers', async () => {
    expect((await copy({ fromClassId: id.a, toClassId: id.a, roomId: id.roomB }).expect(400)).body.message).toBe('Choose two different classes.');
    expect((await copy({ fromClassId: id.a, toClassId: id.five, roomId: id.roomB }).expect(400)).body.message).toBe('A week can be copied only to another class of the same year group.');
    expect((await copy({ fromClassId: id.a, toClassId: id.d }).expect(400)).body.message).toBe('Choose the classroom for the new class’s lessons.');
    expect((await copy({ fromClassId: id.a, toClassId: id.d, roomId: 'nope' }).expect(400)).body.message).toBe('Room not found in this school.');
    expect((await copy({ fromClassId: id.d, toClassId: id.a, roomId: id.roomB }).expect(400)).body.message).toBe('This class has no lessons to copy.');
    await copy({ fromClassId: id.a, toClassId: id.d, roomId: id.roomB }, t1).expect(403);
    expect((await copy({ fromClassId: id.a, toClassId: id.d, roomId: id.roomB }, other).expect(400)).body.message).toBe('Class not found in this school.');
    expect((await weekOf(id.d))).toEqual([]); // nothing was copied by any of those
  });
});
