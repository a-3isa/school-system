import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, login, ownerClient, startApp } from './helpers';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * How a subject comes to a class and who teaches it: the admin creates the subject, schedules its
 * lessons in the timetable, then gives the subject a teacher in that class in one step. The
 * timetable's teacher is what the gradebook, attendance and parent chat all read.
 */
describe('Subjects and their teachers (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, other: Client, t1: Client, t2: Client;
  let schoolId: string;
  const id: Record<string, string> = {};

  const lesson = (classId: string, dayOfWeek: number, periodId: string, subjectId: string, roomId: string, teacherId: string) =>
    admin.post('/api/timetable', { classId, dayOfWeek, periodId, subjectId, roomId, teacherId });
  /** A lesson with no teacher, as the school had before a teacher was required on every lesson. */
  const legacyLesson = (classId: string, dayOfWeek: number, periodId: string, subjectId: string, roomId: string) =>
    prisma.timetableEntry.create({ data: { schoolId, classId, dayOfWeek, periodId, subjectId, roomId } });
  const assign = (c: Client, body: object) => c.put('/api/timetable/assign', body);
  const teachingOf = async (c: Client) => (await c.get('/api/academics/teaching').expect(200)).body.map((p: any) => `${p.className} ${p.subjectName}${p.canMark ? '' : ' (read only)'}`);
  const teachersOf = async (classId: string, subjectId: string) =>
    (await prisma.timetableEntry.findMany({ where: { classId, subjectId }, select: { teacherId: true } })).map((e) => e.teacherId);

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'subj');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Subjects School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@subj.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@subj.eg', 'admin-pass');
    await owner.post('/api/owner/schools', { name: 'Other School', plan: 'COMPLETE', admin: { name: 'Other', email: 'admin@other-subj.eg', password: 'admin-pass' } }).expect(201);
    other = await login(app, 'admin@other-subj.eg', 'admin-pass');
    for (const [key, name] of [['t1', 'Hana'], ['t2', 'Sherif'], ['t3', 'Omar']]) {
      id[key] = (await admin.post('/api/staff', { name, honorific: 'MS', role: 'TEACHER', email: `${key}@subj.eg`, password: 'staff-pass' }).expect(201)).body.id;
    }
    id.nurse = (await admin.post('/api/staff', { name: 'Nada', role: 'NURSE', email: 'nurse@subj.eg', password: 'staff-pass' }).expect(201)).body.id;
    t1 = await login(app, 't1@subj.eg', 'staff-pass');
    t2 = await login(app, 't2@subj.eg', 'staff-pass');

    await prisma.academicYear.create({ data: { schoolId, name: '2000-2099', startsOn: d('2000-01-01'), endsOn: d('2099-12-31'), term2StartsOn: d('2050-01-01') } });
    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    id.classA = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id })).body.id;
    id.classB = (await admin.post('/api/classes', { name: '4-B', gradeId: grade.id })).body.id;
    id.roomA = (await admin.post('/api/rooms', { name: 'Room A' })).body.id;
    id.roomB = (await admin.post('/api/rooms', { name: 'Room B' })).body.id;
    id.p1 = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' })).body.id;
    id.p2 = (await admin.post('/api/periods', { number: 2, startTime: '08:45', endTime: '09:30' })).body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('creating and fixing a subject', () => {
    it('is created with an English name and, optionally, an Arabic one', async () => {
      const math = (await admin.post('/api/subjects', { name: '  Math  ', nameAr: ' الرياضيات ' }).expect(201)).body;
      expect(math).toEqual(expect.objectContaining({ name: 'Math', nameAr: 'الرياضيات' }));
      id.math = math.id;
      const english = (await admin.post('/api/subjects', { name: 'English' }).expect(201)).body;
      expect(english.nameAr).toBeNull();
      id.english = english.id;
      const list = (await admin.get('/api/subjects').expect(200)).body;
      expect(list.map((s: any) => [s.name, s.nameAr])).toEqual([['English', null], ['Math', 'الرياضيات']]);
    });

    it('is created by Student Affairs only, and not twice with the same name', async () => {
      await t1.post('/api/subjects', { name: 'Art' }).expect(403);
      expect((await admin.post('/api/subjects', { name: 'Math' }).expect(409)).body.message).toBe('A subject with this name already exists.');
      await admin.post('/api/subjects', { name: '' }).expect(400);
    });

    it('can be renamed and given its Arabic name afterwards; an empty Arabic name clears it', async () => {
      const edited = (await admin.patch(`/api/subjects/${id.english}`, { nameAr: 'اللغة الإنجليزية' }).expect(200)).body;
      expect(edited).toEqual(expect.objectContaining({ name: 'English', nameAr: 'اللغة الإنجليزية' }));
      expect((await admin.patch(`/api/subjects/${id.english}`, { name: 'English language' }).expect(200)).body).toEqual(expect.objectContaining({ name: 'English language', nameAr: 'اللغة الإنجليزية' }));
      expect((await admin.patch(`/api/subjects/${id.english}`, { nameAr: '' }).expect(200)).body.nameAr).toBeNull();
      await admin.patch(`/api/subjects/${id.english}`, { name: 'English' }).expect(200);
      expect((await admin.patch(`/api/subjects/${id.english}`, { name: 'Math' }).expect(409)).body.message).toBe('A subject with this name already exists.');
      await t1.patch(`/api/subjects/${id.english}`, { name: 'Mine' }).expect(403);
      await other.patch(`/api/subjects/${id.english}`, { name: 'Theirs' }).expect(404);
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'subject.edit' } })).toBe(4);
    });

    it('can be deleted only while nothing uses it', async () => {
      const art = (await admin.post('/api/subjects', { name: 'Art' }).expect(201)).body.id;
      await other.delete(`/api/subjects/${art}`).expect(404);
      await admin.delete(`/api/subjects/${art}`).expect(200);
      expect((await admin.get('/api/subjects').expect(200)).body.map((s: any) => s.name)).not.toContain('Art');

      await lesson(id.classA, 0, id.p1, id.math, id.roomA, id.t1).expect(201);
      expect((await admin.delete(`/api/subjects/${id.math}`).expect(400)).body.message).toBe('This subject is in the timetable or has marks, so it can’t be deleted.');
      await admin.delete(`/api/subjects/${id.math}`).expect(400);
      const entry = await prisma.timetableEntry.findFirstOrThrow({ where: { classId: id.classA, subjectId: id.math } });
      await admin.delete(`/api/timetable/${entry.id}`).expect(200);

      // Marks keep a subject too, even with no lesson left.
      await prisma.assessment.create({ data: { schoolId, yearId: (await prisma.academicYear.findFirstOrThrow({ where: { schoolId } })).id, term: 1, classId: id.classA, subjectId: id.english, kind: 'QUIZ', title: 'Quiz', date: d('2026-10-01'), maxScore: 10 } });
      await admin.delete(`/api/subjects/${id.english}`).expect(400);
      await prisma.assessment.deleteMany({ where: { subjectId: id.english } });
    });
  });

  describe('giving a subject a teacher in a class', () => {
    it('needs the subject to have lessons in that class first', async () => {
      expect((await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t1 }).expect(400)).body.message).toBe('This subject has no lessons in this class yet. Add it to the timetable first.');
    });

    it('sets the teacher on every lesson of the subject in the class at once, and the teacher can then mark it', async () => {
      await legacyLesson(id.classA, 0, id.p1, id.math, id.roomA); // no teacher chosen
      await legacyLesson(id.classA, 1, id.p1, id.math, id.roomA);
      await lesson(id.classA, 0, id.p2, id.english, id.roomA, id.t2).expect(201); // another subject, already staffed
      expect(await teachingOf(t1)).toEqual([]); // a lesson with no teacher gives nobody the gradebook
      const create = (c: Client) => c.post('/api/academics/assessments', { classId: id.classA, subjectId: id.math, kind: 'QUIZ', title: 'Quiz', date: '2026-10-01', maxScore: 10 });
      await create(t1).expect(403);

      const res = (await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t1 }).expect(200)).body;
      expect(res).toEqual({ lessons: 2, teacher: { id: id.t1, name: 'Hana', honorific: 'MS' } });
      expect(await teachersOf(id.classA, id.math)).toEqual([id.t1, id.t1]);
      expect(await teachersOf(id.classA, id.english)).toEqual([id.t2]); // the other subject is untouched
      expect(await teachingOf(t1)).toEqual(['4-A Math']);
      id.quiz = (await create(t1).expect(201)).body.id;
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'timetable.assign' } })).toBe(1);
    });

    it('moves the subject to another teacher, who takes over its assessments and marks', async () => {
      await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t3 }).expect(200);
      expect(await teachersOf(id.classA, id.math)).toEqual([id.t3, id.t3]);
      expect(await teachingOf(t1)).toEqual([]);
      await t1.put(`/api/academics/assessments/${id.quiz}/marks`, { marks: [] }).expect(403);
      await t1.patch(`/api/academics/assessments/${id.quiz}`, { title: 'Still mine?' }).expect(403); // writing it earlier doesn’t keep the right
      const t3 = await login(app, 't3@subj.eg', 'staff-pass');
      await t3.patch(`/api/academics/assessments/${id.quiz}`, { title: 'Unit 1 quiz' }).expect(200);
      expect(await teachingOf(t3)).toEqual(['4-A Math']);
    });

    it('refuses a teacher who is already teaching another class at that time, and changes nothing', async () => {
      await lesson(id.classB, 0, id.p1, id.math, id.roomB, id.t2).expect(201); // Sherif: 4-B on Sunday, period 1
      const res = await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t2 }).expect(409);
      expect(res.body.message).toBe('Sherif already teaches 4-B on Sunday in period 1.');
      expect(await teachersOf(id.classA, id.math)).toEqual([id.t3, id.t3]);
    });

    it('is not blocked by the subject’s own lessons, and a teacher can teach one subject in two classes', async () => {
      await legacyLesson(id.classB, 1, id.p2, id.math, id.roomB);
      await assign(admin, { classId: id.classB, subjectId: id.math, teacherId: id.t2 }).expect(200); // Sherif already has one of these lessons
      await assign(admin, { classId: id.classB, subjectId: id.math, teacherId: id.t2 }).expect(200); // and again: nothing to clash with
      expect(await teachingOf(t2)).toEqual(['4-A English', '4-B Math']);
    });

    it('takes the teacher off again with null, and refuses anyone who isn’t an active teacher here', async () => {
      await assign(admin, { classId: id.classB, subjectId: id.math, teacherId: null }).expect(200);
      expect(await teachersOf(id.classB, id.math)).toEqual([null, null]);
      expect((await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.nurse }).expect(400)).body.message).toBe('Teacher not found in this school.');
      expect((await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: 'nope' }).expect(400)).body.message).toBe('Teacher not found in this school.');
      await prisma.user.update({ where: { id: id.t1 }, data: { active: false } });
      expect((await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t1 }).expect(400)).body.message).toBe('Teacher not found in this school.');
      await prisma.user.update({ where: { id: id.t1 }, data: { active: true } });
    });

    it('is for Student Affairs only, and only within the school', async () => {
      await assign(t1, { classId: id.classA, subjectId: id.math, teacherId: id.t1 }).expect(403);
      expect((await assign(other, { classId: id.classA, subjectId: id.math, teacherId: null }).expect(400)).body.message).toBe('Class not found in this school.');
      expect((await assign(admin, { classId: id.classA, subjectId: 'nope', teacherId: null }).expect(400)).body.message).toBe('Subject not found in this school.');
    });
  });
  describe('adding a lesson', () => {
    it('needs a teacher, who must be an active teacher of this school', async () => {
      const body = { classId: id.classA, dayOfWeek: 2, periodId: id.p1, subjectId: id.english, roomId: id.roomA };
      expect((await admin.post('/api/timetable', body).expect(400)).body.message).toContain('Choose the teacher for this lesson.');
      expect((await admin.post('/api/timetable', { ...body, teacherId: id.nurse }).expect(400)).body.message).toBe('Teacher not found in this school.');
      await prisma.user.update({ where: { id: id.t3 }, data: { active: false } });
      expect((await admin.post('/api/timetable', { ...body, teacherId: id.t3 }).expect(400)).body.message).toBe('Teacher not found in this school.');
      await prisma.user.update({ where: { id: id.t3 }, data: { active: true } });
    });

    it('lets one subject have several teachers: a different one in each class of the same year group', async () => {
      // Maths in 4-A is Omar's (from above); in 4-B it is Sherif's. Same grade, same subject, two teachers.
      await lesson(id.classA, 2, id.p2, id.math, id.roomA, id.t3).expect(201);
      await lesson(id.classB, 2, id.p2, id.math, id.roomB, id.t2).expect(201);
      const maths = await prisma.timetableEntry.findMany({ where: { subjectId: id.math, schoolId, teacherId: { not: null } }, select: { classId: true, teacherId: true } });
      const teachersByClass = (c: string) => [...new Set(maths.filter((m) => m.classId === c).map((m) => m.teacherId))];
      expect(teachersByClass(id.classA)).toContain(id.t3);
      expect(teachersByClass(id.classB)).toContain(id.t2);
    });

    it('lets the same class have two teachers for one subject, on different lessons', async () => {
      await lesson(id.classA, 3, id.p1, id.english, id.roomA, id.t2).expect(201);
      await lesson(id.classA, 4, id.p1, id.english, id.roomA, id.t3).expect(201);
      expect(new Set(await teachersOf(id.classA, id.english)).size).toBeGreaterThan(1);
    });

    it('refuses a teacher who is in another class at that time, and the same teacher can teach both classes at other times', async () => {
      const res = await lesson(id.classB, 3, id.p1, id.math, id.roomB, id.t2).expect(409); // Sherif has 4-A English on Thursday-ish: day 3 period 1
      expect(res.body.message).toBe('Sherif already teaches 4-A in period 1.');
      await lesson(id.classB, 4, id.p2, id.english, id.roomB, id.t2).expect(201); // another time: fine
    });
  });

  describe('a teacher’s profile', () => {
    it('shows each class and subject they teach with its lessons a week, and the classes they lead', async () => {
      await admin.patch(`/api/classes/${id.classB}`, { homeroomTeacherId: id.t2 }).expect(200);
      const p = (await admin.get(`/api/staff/${id.t2}`).expect(200)).body;
      expect(p).toEqual(expect.objectContaining({ id: id.t2, name: 'Sherif', role: 'TEACHER', active: true }));
      expect(p.teaching.homerooms.map((c: any) => c.name)).toEqual(['4-B']);
      expect(p.teaching.assignments.map((a: any) => [a.className, a.subjectName, a.lessons])).toEqual([
        ['4-A', 'English', 2], // Sunday period 2 and Thursday period 1
        ['4-B', 'English', 1],
        ['4-B', 'Math', 1],
      ]);
      expect(p.teaching.lessonsPerWeek).toBe(4);
      expect(p.teaching.assignments[0]).toEqual(expect.objectContaining({ gradeName: 'Grade 4', subjectNameAr: null }));
    });

    it('is the teacher’s own to read, and Student Affairs’ to read for anyone', async () => {
      expect((await t2.get(`/api/staff/${id.t2}`).expect(200)).body.teaching.lessonsPerWeek).toBe(4);
      expect((await t2.get(`/api/staff/${id.t1}`).expect(403)).body.message).toBe('You can see only your own profile.');
      expect((await admin.get(`/api/staff/${id.t1}`).expect(200)).body.teaching.assignments).toEqual([]);
    });

    it('has no teaching for other staff, and can’t be read across schools or for someone who isn’t staff', async () => {
      expect((await admin.get(`/api/staff/${id.nurse}`).expect(200)).body).toEqual(expect.objectContaining({ role: 'NURSE', teaching: null }));
      await other.get(`/api/staff/${id.t2}`).expect(404);
      await admin.get('/api/staff/nope').expect(404);
    });
  });
});
