import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, login, ownerClient, startApp } from './helpers';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * How a subject comes to a class and who teaches it. The periods are the school's, the same for every
 * class. A year group has its subjects; each class of it has them too, each with ONE teacher that the
 * school assigns; and the lessons (where a subject sits in the week) follow: a lesson is taken by the
 * subject's teacher in that class. Several teachers can teach the same subject in different classes.
 */
describe('Subjects, year groups and their teachers (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, other: Client, t1: Client, t2: Client;
  let schoolId: string;
  const id: Record<string, string> = {};

  const studies = (gradeId: string, subjectId: string, body: object = {}) => admin.put(`/api/grades/${gradeId}/subjects/${subjectId}`, body);
  const assign = (c: Client, body: object) => c.put('/api/timetable/assign', body);
  const lesson = (classId: string, dayOfWeek: number, periodId: string, subjectId: string, roomId: string, teacherId?: string) =>
    admin.post('/api/timetable', { classId, dayOfWeek, periodId, subjectId, roomId, ...(teacherId ? { teacherId } : {}) });
  const classSubjects = async (classId: string) => (await admin.get(`/api/classes/${classId}/subjects`).expect(200)).body;
  const teacherOf = async (classId: string, subjectId: string) => (await prisma.classSubject.findUniqueOrThrow({ where: { classId_subjectId: { classId, subjectId } } })).teacherId;
  const lessonTeachers = async (classId: string, subjectId: string) => (await prisma.timetableEntry.findMany({ where: { classId, subjectId }, select: { teacherId: true } })).map((e) => e.teacherId);
  const teachingOf = async (c: Client) => (await c.get('/api/academics/teaching').expect(200)).body.map((p: any) => `${p.className} ${p.subjectName}${p.canMark ? '' : ' (read only)'}`);

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
    id.grade4 = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body.id;
    id.grade5 = (await admin.post('/api/grades', { name: 'Grade 5', order: 5 })).body.id;
    id.classA = (await admin.post('/api/classes', { name: '4-A', gradeId: id.grade4 })).body.id;
    id.classB = (await admin.post('/api/classes', { name: '4-B', gradeId: id.grade4 })).body.id;
    id.class5 = (await admin.post('/api/classes', { name: '5-A', gradeId: id.grade5 })).body.id;
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
      expect((await admin.get('/api/subjects').expect(200)).body.map((s: any) => [s.name, s.nameAr])).toEqual([['English', null], ['Math', 'الرياضيات']]);
    });

    it('is created by Student Affairs only, and not twice with the same name', async () => {
      await t1.post('/api/subjects', { name: 'Art' }).expect(403);
      expect((await admin.post('/api/subjects', { name: 'Math' }).expect(409)).body.message).toBe('A subject with this name already exists.');
      await admin.post('/api/subjects', { name: '' }).expect(400);
    });

    it('can be renamed and given its Arabic name afterwards; an empty Arabic name clears it', async () => {
      expect((await admin.patch(`/api/subjects/${id.english}`, { nameAr: 'اللغة الإنجليزية' }).expect(200)).body).toEqual(expect.objectContaining({ name: 'English', nameAr: 'اللغة الإنجليزية' }));
      expect((await admin.patch(`/api/subjects/${id.english}`, { name: 'English language' }).expect(200)).body).toEqual(expect.objectContaining({ name: 'English language', nameAr: 'اللغة الإنجليزية' }));
      expect((await admin.patch(`/api/subjects/${id.english}`, { nameAr: '' }).expect(200)).body.nameAr).toBeNull();
      await admin.patch(`/api/subjects/${id.english}`, { name: 'English' }).expect(200);
      expect((await admin.patch(`/api/subjects/${id.english}`, { name: 'Math' }).expect(409)).body.message).toBe('A subject with this name already exists.');
      await t1.patch(`/api/subjects/${id.english}`, { name: 'Mine' }).expect(403);
      await other.patch(`/api/subjects/${id.english}`, { name: 'Theirs' }).expect(404);
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'subject.edit' } })).toBe(4);
    });

    it('can be deleted while no lesson or mark uses it, which takes it out of its year groups and classes too', async () => {
      const art = (await admin.post('/api/subjects', { name: 'Art' }).expect(201)).body.id;
      await other.delete(`/api/subjects/${art}`).expect(404);
      await studies(id.grade4, art).expect(200);
      expect(await prisma.classSubject.count({ where: { subjectId: art } })).toBe(2); // 4-A and 4-B
      await t1.delete(`/api/subjects/${art}`).expect(403);
      await admin.delete(`/api/subjects/${art}`).expect(200); // no need to untick it grade by grade first
      expect(await prisma.classSubject.count({ where: { subjectId: art } })).toBe(0);
      expect(await prisma.gradeSubject.count({ where: { subjectId: art } })).toBe(0);
      expect((await admin.get('/api/subjects').expect(200)).body.map((s: any) => s.name)).not.toContain('Art');
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'subject.delete' } })).toBe(1);
    });
  });

  describe('what a year group studies', () => {
    it('gives every class of the year group the subject, with nobody teaching it yet, and no other class', async () => {
      expect((await studies(id.grade4, id.math, { lessonsPerWeek: 5 }).expect(200)).body).toEqual({ gradeId: id.grade4, subjectId: id.math, lessonsPerWeek: 5 });
      await studies(id.grade4, id.english).expect(200);
      for (const c of [id.classA, id.classB]) {
        expect((await classSubjects(c)).map((s: any) => [s.name, s.teacher, s.lessons, s.lessonsPerWeek])).toEqual([['English', null, 0, null], ['Math', null, 0, 5]]);
      }
      expect(await classSubjects(id.class5)).toEqual([]); // Grade 5 studies nothing yet
    });

    it('lists what each year group studies, and counts lessons a week only when told', async () => {
      await studies(id.grade4, id.math).expect(200); // saying nothing leaves the count alone
      expect((await admin.get('/api/curriculum').expect(200)).body.filter((r: any) => r.gradeId === id.grade4 && r.subjectId === id.math)).toEqual([{ gradeId: id.grade4, subjectId: id.math, lessonsPerWeek: 5 }]);
      await studies(id.grade4, id.math, { lessonsPerWeek: null }).expect(200);
      expect((await classSubjects(id.classA)).find((s: any) => s.name === 'Math').lessonsPerWeek).toBeNull();
      await studies(id.grade4, id.math, { lessonsPerWeek: 0 }).expect(400);
      await studies(id.grade4, id.math, { lessonsPerWeek: 21 }).expect(400);
      await studies(id.grade4, id.math, { lessonsPerWeek: 5 }).expect(200);
    });

    it('is set by Student Affairs, for this school’s year groups and subjects only', async () => {
      await t1.put(`/api/grades/${id.grade4}/subjects/${id.math}`, {}).expect(403);
      await other.put(`/api/grades/${id.grade4}/subjects/${id.math}`, {}).expect(404);
      await studies(id.grade4, 'nope').expect(404);
      await studies('nope', id.math).expect(404);
      expect((await t1.get('/api/curriculum').expect(200)).body.length).toBeGreaterThan(0); // everyone on staff may read it
    });

    it('gives a new class its year group’s subjects, and a class that moves year group the new ones', async () => {
      id.classC = (await admin.post('/api/classes', { name: '4-C', gradeId: id.grade4 }).expect(201)).body.id;
      expect((await classSubjects(id.classC)).map((s: any) => s.name)).toEqual(['English', 'Math']);
      await studies(id.grade5, id.english).expect(200);
      await admin.patch(`/api/classes/${id.classC}`, { gradeId: id.grade5 }).expect(200);
      expect((await classSubjects(id.classC)).map((s: any) => s.name)).toEqual(['English', 'Math']); // keeps what it had, gains Grade 5's
      expect((await classSubjects(id.class5)).map((s: any) => s.name)).toEqual(['English']);
      await admin.patch(`/api/classes/${id.classC}`, { gradeId: id.grade4 }).expect(200);
    });
  });

  describe('who teaches a subject in a class', () => {
    it('is chosen by the school for the whole subject, before any lesson is placed, and the teacher can then mark it', async () => {
      expect(await teachingOf(t1)).toEqual([]);
      const res = (await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t1 }).expect(200)).body;
      expect(res).toEqual({ lessons: 0, teacher: { id: id.t1, name: 'Hana', honorific: 'MS' } });
      expect(await teachingOf(t1)).toEqual(['4-A Math']);
      await t1.post('/api/academics/assessments', { classId: id.classA, subjectId: id.math, kind: 'QUIZ', title: 'Quiz', date: '2026-10-01', maxScore: 10 }).expect(201);
      expect((await classSubjects(id.classA)).find((s: any) => s.name === 'Math').teacher).toEqual({ id: id.t1, name: 'Hana', honorific: 'MS' });
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'timetable.assign' } })).toBe(1);
    });

    it('can be a different teacher in each class of the same year group', async () => {
      await assign(admin, { classId: id.classB, subjectId: id.math, teacherId: id.t2 }).expect(200);
      expect([await teacherOf(id.classA, id.math), await teacherOf(id.classB, id.math)]).toEqual([id.t1, id.t2]);
      expect(await teachingOf(t2)).toEqual(['4-B Math']);
    });

    it('is refused for a subject the class doesn’t have, and for anyone who isn’t an active teacher here', async () => {
      expect((await assign(admin, { classId: id.class5, subjectId: id.math, teacherId: id.t1 }).expect(400)).body.message).toBe('This subject isn’t one of this class’s subjects. Add it to the year group’s subjects first.');
      expect((await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.nurse }).expect(400)).body.message).toBe('Teacher not found in this school.');
      expect((await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: 'nope' }).expect(400)).body.message).toBe('Teacher not found in this school.');
      await prisma.user.update({ where: { id: id.t3 }, data: { active: false } });
      expect((await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t3 }).expect(400)).body.message).toBe('Teacher not found in this school.');
      await prisma.user.update({ where: { id: id.t3 }, data: { active: true } });
      expect((await assign(admin, { classId: id.classA, subjectId: 'nope', teacherId: null }).expect(400)).body.message).toBe('Subject not found in this school.');
    });

    it('is for Student Affairs only, and only within the school', async () => {
      await assign(t1, { classId: id.classA, subjectId: id.math, teacherId: id.t1 }).expect(403);
      expect((await assign(other, { classId: id.classA, subjectId: id.math, teacherId: null }).expect(400)).body.message).toBe('Class not found in this school.');
      await other.get(`/api/classes/${id.classA}/subjects`).expect(404);
    });
  });

  describe('placing a lesson', () => {
    it('is only for a subject the class has', async () => {
      const art = (await admin.post('/api/subjects', { name: 'Art' }).expect(201)).body.id;
      expect((await lesson(id.classA, 0, id.p1, art, id.roomA, id.t1).expect(400)).body.message).toBe('This subject isn’t one of this class’s subjects. Add it to the year group’s subjects first.');
    });

    it('takes the subject’s teacher: the school assigns subjects to teachers, and the lessons follow', async () => {
      const made = (await lesson(id.classA, 0, id.p1, id.math, id.roomA).expect(201)).body; // no teacher in the request
      expect(made.teacher).toEqual(expect.objectContaining({ id: id.t1, name: 'Hana' }));
      await lesson(id.classA, 1, id.p1, id.math, id.roomA).expect(201);
      expect(await lessonTeachers(id.classA, id.math)).toEqual([id.t1, id.t1]);
      expect((await classSubjects(id.classA)).find((s: any) => s.name === 'Math').lessons).toBe(2);
    });

    it('can’t name a different teacher: the teacher is changed for the whole subject', async () => {
      expect((await lesson(id.classA, 2, id.p1, id.math, id.roomA, id.t2).expect(400)).body.message).toBe('Hana teaches Math in 4-A. To change the teacher, change it for the whole subject.');
      await lesson(id.classA, 2, id.p1, id.math, id.roomA, id.t1).expect(201); // naming the same one is fine
    });

    it('needs a teacher for a subject that has none yet, and that teacher then takes all of its lessons', async () => {
      expect((await lesson(id.classA, 0, id.p2, id.english, id.roomA).expect(400)).body.message).toBe('Choose the teacher of this subject in this class.');
      // A lesson from before teachers were assigned: no teacher on it.
      await prisma.timetableEntry.create({ data: { schoolId, classId: id.classA, dayOfWeek: 3, periodId: id.p2, subjectId: id.english, roomId: id.roomA } });
      await lesson(id.classA, 1, id.p2, id.english, id.roomA, id.t2).expect(201);
      expect(await teacherOf(id.classA, id.english)).toBe(id.t2);
      expect(await lessonTeachers(id.classA, id.english)).toEqual([id.t2, id.t2]); // the older lesson took it too
    });

    it('moving the subject to another teacher moves its lessons, and the new teacher takes over its marks', async () => {
      await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t3 }).expect(200);
      expect(await lessonTeachers(id.classA, id.math)).toEqual([id.t3, id.t3, id.t3]);
      expect(await teachingOf(t1)).toEqual([]);
      const quiz = await prisma.assessment.findFirstOrThrow({ where: { classId: id.classA, subjectId: id.math } });
      await t1.patch(`/api/academics/assessments/${quiz.id}`, { title: 'Still mine?' }).expect(403);
    });

    it('refuses a teacher who would be in two classes at once, and changes nothing', async () => {
      await lesson(id.classB, 0, id.p1, id.math, id.roomB).expect(201); // Sherif, 4-B, Sunday period 1
      const res = await assign(admin, { classId: id.classA, subjectId: id.math, teacherId: id.t2 }).expect(409);
      expect(res.body.message).toBe('Sherif already teaches 4-B on Sunday in period 1.');
      expect(await lessonTeachers(id.classA, id.math)).toEqual([id.t3, id.t3, id.t3]);
      expect(await teacherOf(id.classA, id.math)).toBe(id.t3);
      // The same goes for placing a lesson: Omar teaches 4-A Math on Sunday period 1, so 4-C Math can't use that slot for him.
      await assign(admin, { classId: id.classC, subjectId: id.math, teacherId: id.t3 }).expect(200);
      expect((await lesson(id.classC, 0, id.p1, id.math, id.roomB).expect(409)).body.message).toBe('Omar already teaches 4-A in period 1.');
      await lesson(id.classC, 0, id.p2, id.math, id.roomB).expect(201); // another period: fine, one teacher, two classes
    });

    it('can take the teacher off a subject, which takes them off its lessons', async () => {
      await assign(admin, { classId: id.classC, subjectId: id.math, teacherId: null }).expect(200);
      expect(await teacherOf(id.classC, id.math)).toBeNull();
      expect(await lessonTeachers(id.classC, id.math)).toEqual([null]);
    });
  });

  describe('a teacher’s profile', () => {
    it('shows each class and subject the school gave them with the lessons placed so far, and the classes they lead', async () => {
      await admin.patch(`/api/classes/${id.classB}`, { homeroomTeacherId: id.t2 }).expect(200);
      const p = (await admin.get(`/api/staff/${id.t2}`).expect(200)).body;
      expect(p).toEqual(expect.objectContaining({ id: id.t2, name: 'Sherif', role: 'TEACHER', active: true }));
      expect(p.teaching.homerooms.map((c: any) => c.name)).toEqual(['4-B']);
      expect(p.teaching.assignments.map((a: any) => [a.className, a.subjectName, a.lessons])).toEqual([
        ['4-A', 'English', 2],
        ['4-B', 'Math', 1],
      ]);
      expect(p.teaching.lessonsPerWeek).toBe(3);
      expect(p.teaching.assignments[0]).toEqual(expect.objectContaining({ gradeName: 'Grade 4', subjectNameAr: null }));
    });

    it('lists a subject given to them but not yet in the timetable, with no lessons', async () => {
      await assign(admin, { classId: id.classB, subjectId: id.english, teacherId: id.t1 }).expect(200);
      const p = (await admin.get(`/api/staff/${id.t1}`).expect(200)).body;
      expect(p.teaching.assignments.map((a: any) => [a.className, a.subjectName, a.lessons])).toEqual([['4-B', 'English', 0]]);
    });

    it('is the teacher’s own to read, and Student Affairs’ to read for anyone', async () => {
      expect((await t2.get(`/api/staff/${id.t2}`).expect(200)).body.teaching.lessonsPerWeek).toBe(3);
      expect((await t2.get(`/api/staff/${id.t1}`).expect(403)).body.message).toBe('You can see only your own profile.');
      expect((await admin.get(`/api/staff/${id.t3}`).expect(200)).body.teaching.assignments.map((a: any) => a.className)).toEqual(['4-A']);
    });

    it('has no teaching for other staff, and can’t be read across schools or for someone who isn’t staff', async () => {
      expect((await admin.get(`/api/staff/${id.nurse}`).expect(200)).body).toEqual(expect.objectContaining({ role: 'NURSE', teaching: null }));
      await other.get(`/api/staff/${id.t2}`).expect(404);
      await admin.get('/api/staff/nope').expect(404);
    });
  });

  describe('reading a subject, and keeping one that is in use', () => {
    it('lists each subject with how many year groups and classes use it', async () => {
      const list = (await admin.get('/api/subjects').expect(200)).body;
      const math = list.find((s: any) => s.name === 'Math');
      const english = list.find((s: any) => s.name === 'English');
      expect(math).toEqual(expect.objectContaining({ id: id.math, nameAr: 'الرياضيات', yearGroups: 1 }));
      expect(math.classes).toBe(await prisma.classSubject.count({ where: { subjectId: id.math } }));
      expect(english.yearGroups).toBe(2); // Grade 4 and Grade 5
      expect((await t1.get('/api/subjects').expect(200)).body.length).toBe(list.length); // everyone on staff may read the list
    });

    it('shows where one subject is used: its year groups, its classes with teachers and lessons, and its marks', async () => {
      const m = (await admin.get(`/api/subjects/${id.math}`).expect(200)).body;
      expect(m).toEqual(expect.objectContaining({ id: id.math, name: 'Math', nameAr: 'الرياضيات', lessons: 5, assessments: 1 }));
      expect(m.yearGroups.map((g: any) => [g.name, g.lessonsPerWeek])).toEqual([['Grade 4', 5]]);
      expect(m.classes.find((c: any) => c.className === '4-A')).toEqual(expect.objectContaining({ lessons: 3, teacher: expect.objectContaining({ name: 'Omar' }) }));
      expect(m.classes.find((c: any) => c.className === '4-C')).toEqual(expect.objectContaining({ lessons: 1, teacher: null }));
      await t1.get(`/api/subjects/${id.math}`).expect(403);
      await other.get(`/api/subjects/${id.math}`).expect(404);
      await admin.get('/api/subjects/nope').expect(404);
    });

    it('is kept while a lesson or a mark uses it', async () => {
      expect((await admin.delete(`/api/subjects/${id.math}`).expect(400)).body.message).toBe('This subject is in the timetable or has marks, so it can’t be deleted.');
      expect((await admin.get('/api/subjects').expect(200)).body.map((s: any) => s.name)).toContain('Math');
    });
  });

  describe('taking a subject out of a year group', () => {
    it('is refused while one of its classes has lessons or marks in it, and otherwise removes it from the classes', async () => {
      expect((await admin.delete(`/api/grades/${id.grade4}/subjects/${id.math}`).expect(400)).body.message).toBe('This year group’s classes already have lessons or marks in this subject, so it can’t be removed.');
      const music = (await admin.post('/api/subjects', { name: 'Music' }).expect(201)).body.id;
      await studies(id.grade4, music).expect(200);
      expect((await classSubjects(id.classA)).map((s: any) => s.name)).toContain('Music');
      await t1.delete(`/api/grades/${id.grade4}/subjects/${music}`).expect(403);
      await admin.delete(`/api/grades/${id.grade4}/subjects/${music}`).expect(200);
      expect((await classSubjects(id.classA)).map((s: any) => s.name)).not.toContain('Music');
    });
  });
});
