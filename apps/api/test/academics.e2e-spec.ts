import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, kid, login, ownerClient, startApp } from './helpers';

// One long school year (2000–2099, term 2 from 2050) so that "today" is always in term 1 and the
// scenarios stay on fixed dates: assessments on 1–2 Oct 2026, exams far in the future.
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('Academics (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, social: Client, t1: Client, t2: Client, t3: Client, p1: Client, p2: Client, p3: Client, other: Client;
  let schoolId: string;
  const id: Record<string, string> = {};

  const create = (c: Client, body: object = {}) =>
    c.post('/api/academics/assessments', { classId: id.classA, subjectId: id.math, kind: 'QUIZ', title: 'Unit 1 quiz', date: '2026-10-01', maxScore: 20, ...body });
  const save = (c: Client, assessmentId: string, marks: object[]) => c.put(`/api/academics/assessments/${assessmentId}/marks`, { marks });
  const told = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type }, orderBy: { createdAt: 'asc' } });
  const grades = async (c: Client, child: string, term = 1) => (await c.get(`/api/parent/children/${child}/grades?term=${term}`).expect(200)).body;
  const gradebook = (c: Client, subjectId = id.math) => c.get(`/api/academics/gradebook?classId=${id.classA}&subjectId=${subjectId}&term=1`);

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'acad');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Academics School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@acad.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@acad.eg', 'admin-pass');
    for (const [key, name, role] of [['t1', 'Hana', 'TEACHER'], ['t2', 'Sherif', 'TEACHER'], ['t3', 'Omar', 'TEACHER'], ['sw', 'Mervat', 'SOCIAL_WORKER']]) {
      id[key] = (await admin.post('/api/staff', { name, honorific: role === 'TEACHER' ? 'MS' : undefined, role, email: `${key}@acad.eg`, password: 'staff-pass' }).expect(201)).body.id;
    }
    [t1, t2, t3, social] = await Promise.all(['t1', 't2', 't3', 'sw'].map((k) => login(app, `${k}@acad.eg`, 'staff-pass')));

    await prisma.academicYear.create({ data: { schoolId, name: '2000-2099', startsOn: d('2000-01-01'), endsOn: d('2099-12-31'), term2StartsOn: d('2050-01-01') } });
    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    id.classA = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id, homeroomTeacherId: id.t2 })).body.id;
    id.classB = (await admin.post('/api/classes', { name: '4-B', gradeId: grade.id })).body.id;
    id.roomA = (await admin.post('/api/rooms', { name: 'Room A' })).body.id;
    id.roomB = (await admin.post('/api/rooms', { name: 'Room B' })).body.id;
    id.math = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    id.english = (await admin.post('/api/subjects', { name: 'English' })).body.id;
    id.p1 = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' })).body.id;
    id.p2 = (await admin.post('/api/periods', { number: 2, startTime: '08:45', endTime: '09:30' })).body.id;
    await admin.post('/api/timetable', { classId: id.classA, dayOfWeek: 0, periodId: id.p1, roomId: id.roomA, subjectId: id.math, teacherId: id.t1 }).expect(201);
    await admin.post('/api/timetable', { classId: id.classA, dayOfWeek: 0, periodId: id.p2, roomId: id.roomA, subjectId: id.english, teacherId: id.t2 }).expect(201);
    await admin.post('/api/timetable', { classId: id.classB, dayOfWeek: 0, periodId: id.p1, roomId: id.roomB, subjectId: id.math, teacherId: id.t3 }).expect(201);

    const student = async (key: string, code: string, classId: string, gender: string, parent: object) => {
      id[key] = (await admin.post('/api/students', { ...(await kid(admin)), gender, code, firstName: key, lastName: 'Test', classId, parent }).expect(201)).body.id;
    };
    const mother = (n: number, name: string) => ({ relation: 'MOTHER', name, email: `p${n}@acad.eg`, phone: `+20125000${String(n).padStart(3, '0')}`, password: 'parent-pass' });
    await student('Ali', 'A1', id.classA, 'MALE', mother(1, 'Rania'));
    await student('Layla', 'A2', id.classA, 'FEMALE', mother(3, 'Nadia'));
    await student('Salma', 'A3', id.classB, 'FEMALE', mother(2, 'Dina'));
    [p1, p2, p3] = await Promise.all([1, 2, 3].map((n) => login(app, `p${n}@acad.eg`, 'parent-pass')));
    for (const [key, email] of [['p1u', 'p1@acad.eg'], ['p2u', 'p2@acad.eg'], ['p3u', 'p3@acad.eg']]) id[key] = (await prisma.user.findFirstOrThrow({ where: { email } })).id;
    await admin.patch(`/api/students/${id.Layla}/guardians/${id.p3u}`, { restricted: true }).expect(200); // Nadia sees nothing about Layla

    await owner.post('/api/owner/schools', { name: 'Other School', plan: 'COMPLETE', admin: { name: 'Other', email: 'admin@other-acad.eg', password: 'admin-pass' } }).expect(201);
    other = await login(app, 'admin@other-acad.eg', 'admin-pass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('the gradebook picker', () => {
    it('lists the pairs a teacher teaches, and the class teacher’s other subjects read-only', async () => {
      expect((await t1.get('/api/academics/teaching').expect(200)).body).toEqual([{ classId: id.classA, className: '4-A', subjectId: id.math, subjectName: 'Math', canMark: true }]);
      const homeroom = (await t2.get('/api/academics/teaching').expect(200)).body;
      expect(homeroom.map((p: any) => [p.subjectName, p.canMark])).toEqual([['English', true], ['Math', false]]);
      expect((await admin.get('/api/academics/teaching').expect(200)).body).toHaveLength(3);
      await social.get('/api/academics/teaching').expect(403);
    });
  });

  describe('assessments', () => {
    it('lets a teacher create one for their class and subject, in the right term', async () => {
      const a = (await create(t1).expect(201)).body;
      expect(a).toEqual(expect.objectContaining({ kind: 'QUIZ', title: 'Unit 1 quiz', term: 1, maxScore: 20, weight: 1, date: '2026-10-01', markedCount: 0, studentCount: 2, publishedAt: null }));
      id.a1 = a.id;
      expect((await create(t1, { kind: 'PROJECT', title: 'Poster', date: '2026-10-02' }).expect(201)).body.weight).toBe(2); // the default for a project
      expect((await create(t1, { title: 'Next term', date: '2050-02-01' }).expect(201)).body.term).toBe(2);
    });

    it('refuses another subject, another class, a date outside every year, and the social worker', async () => {
      expect((await create(t1, { subjectId: id.english }).expect(403)).body.message).toBe('You can only mark subjects you teach.');
      await create(t3).expect(403); // t3 teaches Math in 4-B, not 4-A
      expect((await create(t1, { date: '1999-01-01' }).expect(400)).body.message).toBe('That date isn’t in an academic year.');
      await create(social).expect(403);
      await create(admin).expect(201); // Student Affairs can mark anything
    });

    it('asks for a time on exams only', async () => {
      expect((await create(t1, { kind: 'MIDTERM', title: 'Midterm' }).expect(400)).body.message).toBe('Exams need a start and an end time.');
      expect((await create(t1, { startTime: '09:00', endTime: '10:00' }).expect(400)).body.message).toBe('Only exams have a time and a room.');
      expect((await create(admin, { kind: 'FINAL', startTime: '10:00', endTime: '09:00', date: '2098-05-10' }).expect(400)).body.message).toBe('An exam must end after it starts.');
    });

    it('lists only what a teacher may see', async () => {
      const mine = (await t1.get(`/api/academics/assessments?classId=${id.classA}&term=1`).expect(200)).body;
      expect(mine.length).toBeGreaterThanOrEqual(3);
      expect(mine.every((a: any) => a.subject.name === 'Math')).toBe(true);
      expect((await t3.get(`/api/academics/assessments?classId=${id.classA}`).expect(200)).body).toEqual([]);
      const all = (await t2.get(`/api/academics/assessments?classId=${id.classA}&term=1`).expect(200)).body; // the class teacher reads every subject
      expect(all.map((a: any) => a.id).sort()).toEqual(mine.map((a: any) => a.id).sort());
    });
  });

  describe('marks', () => {
    it('keeps scores within the maximum and to two decimals, and excuses only absences', async () => {
      expect((await save(t1, id.a1, [{ studentId: id.Ali, score: 25 }]).expect(400)).body.message).toBe('Scores must be between 0 and 20.');
      expect((await save(t1, id.a1, [{ studentId: id.Ali, score: 12.345 }]).expect(400)).body.message).toBe('Scores can have at most 2 decimals.');
      expect((await save(t1, id.a1, [{ studentId: id.Ali, score: 10, excused: true }]).expect(400)).body.message).toBe('Only a student who was absent can be excused.');
      expect((await save(t1, id.a1, [{ studentId: id.Salma, score: 10 }]).expect(400)).body.message).toBe('Some of these students aren’t in this class.');
      await save(t3, id.a1, [{ studentId: id.Ali, score: 10 }]).expect(403);
    });

    it('saves a whole class at once and reads it back', async () => {
      expect((await save(t1, id.a1, [{ studentId: id.Ali, score: 18, comment: 'Very good' }, { studentId: id.Layla, score: 12.5 }]).expect(200)).body).toEqual({ saved: 2 });
      const rows = (await t1.get(`/api/academics/assessments/${id.a1}/marks`).expect(200)).body;
      expect(rows.map((r: any) => [r.id === id.Ali ? 'Ali' : 'Layla', r.mark.score])).toEqual([['Ali', 18], ['Layla', 12.5]]);
      expect(rows[0].mark.comment).toBe('Very good');
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'marks.save' } })).toBe(1); // one entry, not one per mark
      await save(t1, id.a1, [{ studentId: id.Layla, score: 12 }]).expect(200);
      await save(t1, id.a1, [{ studentId: id.Layla, score: 12 }]).expect(200);
    });

    it('records an absence, excused or not, and blanks a cell', async () => {
      id.a2 = (await create(t1, { kind: 'PROJECT', title: 'Unit 1 project', date: '2026-10-02', maxScore: 100, weight: 3 }).expect(201)).body.id;
      await save(t1, id.a2, [{ studentId: id.Ali, score: 60 }, { studentId: id.Layla, absent: true, excused: true }]).expect(200);
      const layla = (await t1.get(`/api/academics/assessments/${id.a2}/marks`).expect(200)).body.find((r: any) => r.id === id.Layla);
      expect(layla.mark).toEqual({ score: null, absent: true, excused: true, comment: null });
      await save(t1, id.a2, [{ studentId: id.Layla }]).expect(200); // nothing entered: the mark goes away
      expect((await t1.get(`/api/academics/assessments/${id.a2}/marks`).expect(200)).body.find((r: any) => r.id === id.Layla).mark).toBeNull();
      await save(t1, id.a2, [{ studentId: id.Layla, absent: true, excused: true }]).expect(200);
    });

    it('does not let a teacher publish before entering anything, nor the class teacher write other subjects', async () => {
      const empty = (await create(t1, { title: 'Empty' }).expect(201)).body.id;
      expect((await t1.post(`/api/academics/assessments/${empty}/publish`).expect(400)).body.message).toBe('Enter at least one mark before publishing.');
      await t1.delete(`/api/academics/assessments/${empty}`).expect(200);
      await save(t2, id.a1, [{ studentId: id.Ali, score: 20 }]).expect(403); // t2 leads 4-A but teaches English
    });
  });

  describe('what parents see', () => {
    it('shows nothing until the teacher publishes', async () => {
      expect((await grades(p1, id.Ali)).subjects).toEqual([]);
      expect((await p1.get(`/api/parent/children/${id.Ali}/grades/trend?subjectId=${id.math}`).expect(200)).body).toEqual([]);
    });

    it('lets only the people who teach the pair publish, and tells the unrestricted parents once', async () => {
      await t3.post(`/api/academics/assessments/${id.a1}/publish`).expect(403);
      expect((await t1.post(`/api/academics/assessments/${id.a1}/publish`).expect(201)).body).toEqual({ published: true, told: 1 }); // Layla’s mother is restricted
      const [n] = await told(id.p1u, 'marks.published');
      expect(n.title).toBe('New mark for Ali in Math: Unit 1 quiz');
      expect(n.data).toEqual(expect.objectContaining({ studentId: id.Ali, assessmentId: id.a1, subject: 'Math', title: 'Unit 1 quiz' }));
      expect(await told(id.p3u, 'marks.published')).toHaveLength(0);
      expect((await t1.post(`/api/academics/assessments/${id.a1}/publish`).expect(201)).body).toEqual({ published: true, told: 0 });
      expect(await told(id.p1u, 'marks.published')).toHaveLength(1);
    });

    it('shows the published mark with its percentage, band and trend', async () => {
      const g = await grades(p1, id.Ali);
      expect(g.subjects).toHaveLength(1);
      expect(g.subjects[0]).toEqual(expect.objectContaining({ name: 'Math', percent: 90, band: expect.objectContaining({ label: 'Excellent', labelAr: 'ممتاز' }) }));
      expect(g.subjects[0].assessments).toEqual([expect.objectContaining({ title: 'Unit 1 quiz', score: 18, maxScore: 20, absent: false })]);
      expect(g.overall.percent).toBe(90);
      expect((await p1.get(`/api/parent/children/${id.Ali}/grades/trend?subjectId=${id.math}`).expect(200)).body).toEqual([{ date: '2026-10-01', percent: 90 }]);
    });

    it('counts only published assessments in the percentage', async () => {
      await t1.post(`/api/academics/assessments/${id.a2}/publish`).expect(201);
      const g = await grades(p1, id.Ali);
      expect(g.subjects[0].percent).toBe(67.5); // (1 × 18/20 + 3 × 60/100) ÷ 4
      expect(g.subjects[0].band.label).toBe('Good');
      expect((await grades(p1, id.Ali, 2)).subjects).toEqual([]); // nothing in term 2 yet
    });

    it('hides a child from a restricted parent and from another family', async () => {
      await p3.get(`/api/parent/children/${id.Layla}/grades`).expect(404);
      await p2.get(`/api/parent/children/${id.Ali}/grades`).expect(404);
      await p2.get(`/api/parent/children/${id.Ali}/exams`).expect(404);
      await admin.get(`/api/parent/children/${id.Ali}/grades`).expect(403);
    });
  });

  describe('the gradebook', () => {
    it('works the term percentage and band for each student: weights, and an excused absence left out', async () => {
      const gb = (await gradebook(t1).expect(200)).body;
      expect(gb.assessments.map((a: any) => a.title)).toEqual(expect.arrayContaining(['Unit 1 quiz', 'Unit 1 project'])); // assessments nobody has marked yet are columns too
      const [ali, layla] = gb.students;
      expect(ali).toEqual(expect.objectContaining({ name: 'Ali Test', percent: 67.5, band: expect.objectContaining({ label: 'Good' }) }));
      expect(ali.marks[id.a1]).toEqual(expect.objectContaining({ score: 18 }));
      expect(layla).toEqual(expect.objectContaining({ name: 'Layla Test', percent: 60, band: expect.objectContaining({ label: 'Pass' }) })); // 12/20 only: the project was excused
      expect(layla.marks[id.a2]).toEqual(expect.objectContaining({ absent: true, excused: true }));
    });

    it('shows a teacher only their own subject, and the class teacher everything', async () => {
      expect((await gradebook(t3).expect(403)).body.message).toBe('You can see only the classes and subjects you teach.');
      await gradebook(t2).expect(200);
      await gradebook(social).expect(200);
      await gradebook(t1, id.english).expect(403);
      await gradebook(t2, id.english).expect(200);
      await t1.get('/api/academics/gradebook').expect(400);
    });

    it('uses the school’s own bands once it sets them, and the defaults again after a reset', async () => {
      const defaults = (await admin.get('/api/academics/bands').expect(200)).body;
      expect(defaults.BRITISH[0]).toEqual({ min: 90, label: 'A*', labelAr: 'A*' });
      expect(defaults.AMERICAN[0]).toEqual({ min: 93, label: 'A', labelAr: 'A', gpa: 4 });
      expect(defaults.NATIONAL_ARABIC.map((b: any) => b.label)).toEqual(['Excellent', 'Very good', 'Good', 'Pass', 'Below pass']);

      const own = [{ min: 0, label: 'Fail', labelAr: 'راسب' }, { min: 65, label: 'Satisfactory', labelAr: 'مقبول' }];
      await t1.put('/api/academics/bands/OTHER', { bands: own }).expect(403);
      expect((await admin.put('/api/academics/bands/OTHER', { bands: [{ min: 10, label: 'A', labelAr: 'أ' }, { min: 50, label: 'B', labelAr: 'ب' }] }).expect(400)).body.message).toBe('The lowest grade must start at 0%.');
      expect((await admin.put('/api/academics/bands/NOPE', { bands: own }).expect(400)).body.message).toBe('Choose a school system.');
      expect((await admin.put('/api/academics/bands/OTHER', { bands: own }).expect(200)).body.OTHER.map((b: any) => b.label)).toEqual(['Satisfactory', 'Fail']);
      const [ali, layla] = (await gradebook(t1).expect(200)).body.students; // 4-A has no system, which counts as OTHER
      expect([ali.band.label, layla.band.label]).toEqual(['Satisfactory', 'Fail']);
      expect((await grades(p1, id.Ali)).subjects[0].band.label).toBe('Satisfactory');
      expect((await admin.delete('/api/academics/bands/OTHER').expect(200)).body.OTHER.map((b: any) => b.label)).toContain('Excellent');
      expect((await gradebook(t1).expect(200)).body.students[0].band.label).toBe('Good');
    });
  });

  describe('changing and deleting', () => {
    it('will not lower the maximum below a score, nor move the date out of the year', async () => {
      expect((await t1.patch(`/api/academics/assessments/${id.a1}`, { maxScore: 15 }).expect(400)).body.message).toBe('Some marks are higher than the new maximum.');
      expect((await t1.patch(`/api/academics/assessments/${id.a1}`, { date: '1999-01-01' }).expect(400)).body.message).toBe('That date isn’t in an academic year.');
      expect((await t1.patch(`/api/academics/assessments/${id.a1}`, { title: 'Unit 1 test', maxScore: 25 }).expect(200)).body).toEqual(expect.objectContaining({ title: 'Unit 1 test', maxScore: 25 }));
      await t1.patch(`/api/academics/assessments/${id.a1}`, { title: 'Unit 1 quiz', maxScore: 20 }).expect(200);
      await t3.patch(`/api/academics/assessments/${id.a1}`, { title: 'Mine now' }).expect(403);
    });

    it('keeps published marks from being deleted until Student Affairs unpublishes them', async () => {
      expect((await t1.delete(`/api/academics/assessments/${id.a1}`).expect(400)).body.message).toBe('Published marks can’t be deleted. Unpublish them first.');
      await t1.post(`/api/academics/assessments/${id.a1}/unpublish`).expect(403);
      await admin.post(`/api/academics/assessments/${id.a1}/unpublish`).expect(201);
      expect((await grades(p1, id.Ali)).subjects[0].assessments).toHaveLength(1); // only the project is left
      await t1.post(`/api/academics/assessments/${id.a1}/publish`).expect(201);
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'assessment.unpublish' } })).toBe(1);
    });

    it('is invisible to another school', async () => {
      await other.get(`/api/academics/assessments/${id.a1}/marks`).expect(404);
      await other.post(`/api/academics/assessments/${id.a1}/unpublish`).expect(404);
    });
  });

  describe('the exam timetable', () => {
    const exam = (c: Client, body: object = {}) =>
      create(c, { kind: 'MIDTERM', title: 'Midterm', date: '2098-05-10', startTime: '09:00', endTime: '10:30', roomId: id.roomA, ...body });

    it('schedules exams and refuses a class or a room that is already busy', async () => {
      id.exam = (await exam(t1).expect(201)).body.id;
      expect((await exam(admin, { subjectId: id.english, startTime: '10:00', endTime: '11:00', roomId: id.roomB }).expect(400)).body.message).toBe('This class already has an exam at that time.');
      expect((await exam(admin, { classId: id.classB, startTime: '10:00', endTime: '11:00' }).expect(400)).body.message).toBe('That room is already used for an exam at that time.');
      await exam(admin, { subjectId: id.english, title: 'English midterm', startTime: '10:30', endTime: '12:00' }).expect(201); // starts as the first ends
      await exam(admin, { classId: id.classB, startTime: '09:00', endTime: '10:30', roomId: id.roomB }).expect(201); // another class, another room
      await exam(t1, { roomId: 'nope', date: '2098-05-11' }).expect(404);
    });

    it('lists them by date and time for the whole school or one year group', async () => {
      const all = (await admin.get('/api/academics/exams?from=2098-05-01&to=2098-05-31').expect(200)).body;
      expect(all.map((e: any) => [e.class.name, e.subject.name, e.startTime, e.room?.name])).toEqual([
        ['4-A', 'Math', '09:00', 'Room A'], ['4-B', 'Math', '09:00', 'Room B'], ['4-A', 'English', '10:30', 'Room A'],
      ]);
      expect((await t1.get(`/api/academics/exams?classId=${id.classB}&from=2098-05-01&to=2098-05-31`).expect(200)).body).toHaveLength(1); // everyone on staff may read the timetable
      const grade = all[0].class.grade.id;
      expect((await admin.get(`/api/academics/exams?gradeId=${grade}&from=2098-05-01&to=2098-05-31`).expect(200)).body).toHaveLength(3);
    });

    it('moves an exam without clashing with itself, and shows parents the upcoming ones', async () => {
      await t1.patch(`/api/academics/assessments/${id.exam}`, { startTime: '09:15', endTime: '10:15' }).expect(200);
      expect((await t1.patch(`/api/academics/assessments/${id.exam}`, { endTime: '09:00' }).expect(400)).body.message).toBe('An exam must end after it starts.');
      const upcoming = (await p1.get(`/api/parent/children/${id.Ali}/exams`).expect(200)).body;
      expect(upcoming.map((e: any) => [e.subject, e.date, e.startTime, e.endTime, e.room])).toEqual([['Math', '2098-05-10', '09:15', '10:15', 'Room A'], ['English', '2098-05-10', '10:30', '12:00', 'Room A']]);
      expect((await p2.get(`/api/parent/children/${id.Salma}/exams`).expect(200)).body).toHaveLength(1);
    });
  });

  describe('report cards', () => {
    it('is prepared by the class teacher or Student Affairs, once for each student', async () => {
      id.year = (await prisma.academicYear.findFirstOrThrow({ where: { schoolId } })).id;
      const body = { classId: id.classA, yearId: id.year, term: 1 };
      expect((await t1.post('/api/academics/report-cards/generate', body).expect(403)).body.message).toBe('Only the class teacher can prepare report cards.');
      expect((await t2.post('/api/academics/report-cards/generate', body).expect(201)).body).toEqual({ created: 2, total: 2 });
      expect((await admin.post('/api/academics/report-cards/generate', body).expect(201)).body).toEqual({ created: 0, total: 2 });
      await social.post('/api/academics/report-cards/generate', body).expect(403);
    });

    it('lists a draft with its live percentage and what is still missing', async () => {
      const list = (await t2.get(`/api/academics/report-cards?classId=${id.classA}&term=1&yearId=${id.year}`).expect(200)).body;
      expect(list.term).toBe(1);
      const ali = list.cards.find((c: any) => c.name === 'Ali Test');
      expect(ali).toEqual(expect.objectContaining({ status: 'DRAFT', percent: 67.5, band: expect.objectContaining({ label: 'Good' }) }));
      expect(ali.missing).toEqual({ subjects: 2, classTeacher: true, principal: true }); // Math and English, no comments yet
      id.cardAli = ali.id;
      id.cardLayla = list.cards.find((c: any) => c.name === 'Layla Test').id;
      await t3.get(`/api/academics/report-cards?classId=${id.classA}`).expect(403);
      await social.get(`/api/academics/report-cards?classId=${id.classA}`).expect(200);
      await t1.get(`/api/academics/report-cards?classId=${id.classA}`).expect(200); // teaches Math in 4-A
    });

    it('takes each comment from the person it belongs to', async () => {
      const comment = (c: Client, body: object) => c.patch(`/api/academics/report-cards/${id.cardAli}/comments`, body);
      expect((await comment(t1, { subjectId: id.math, comment: 'Ali works hard in every lesson.' }).expect(200)).body.comments.subjects[id.math]).toBe('Ali works hard in every lesson.');
      expect((await comment(t1, { subjectId: id.english, comment: 'Not mine' }).expect(403)).body.message).toBe('You can only comment on subjects you teach.');
      expect((await comment(t1, { classTeacherComment: 'Not mine' }).expect(403)).body.message).toBe('Only the class teacher can write this comment.');
      await comment(t2, { classTeacherComment: 'A kind and helpful boy.' }).expect(200);
      expect((await comment(t2, { principalComment: 'Well done.' }).expect(403)).body.message).toBe('Only Student Affairs can write the principal’s comment.');
      await comment(admin, { principalComment: 'Keep it up, Ali.' }).expect(200);
      await comment(admin, { subjectId: id.english, comment: 'Good progress in reading.' }).expect(200);
      expect((await comment(t2, {}).expect(400)).body.message).toBe('Send a subject comment, the class teacher’s comment or the principal’s comment.');
      expect((await comment(t2, { comment: 'x' }).expect(400)).body.message).toBe('Choose the subject and write the comment.');
      expect((await comment(t2, { classTeacherComment: 'y'.repeat(601) }).expect(400)).body).toBeDefined();
      const draft = (await t1.get(`/api/academics/report-cards/${id.cardAli}`).expect(200)).body;
      expect(draft.canEdit).toEqual({ subjects: [id.math], classTeacher: false, principal: false });
      expect((await admin.get(`/api/academics/report-cards/${id.cardAli}`).expect(200)).body.canEdit.principal).toBe(true);
    });

    it('builds the card from published marks, comments, the class teacher and the days at school', async () => {
      await prisma.attendanceRecord.createMany({
        data: [['2026-10-04', 'PRESENT'], ['2026-10-05', 'LATE'], ['2026-10-06', 'ABSENT']].map(([date, status]) => ({
          schoolId, studentId: id.Ali, classId: id.classA, periodId: id.p1, date: d(date), status: status as any, source: 'MANUAL' as const,
        })),
      });
      await admin.patch('/api/school', { principalName: 'Dr. Amal Fawzy' }).expect(200);
      const s = (await t1.get(`/api/academics/report-cards/${id.cardAli}`).expect(200)).body.snapshot;
      expect(s.student).toEqual(expect.objectContaining({ name: 'Ali Test', code: 'A1', gender: 'MALE' }));
      expect(s.class).toEqual({ name: '4-A', gradeName: 'Grade 4', system: null });
      expect(s.year).toEqual({ name: '2000-2099' });
      expect(s.subjects.map((x: any) => [x.name, x.percent, x.band?.label ?? null, x.comment, x.teacher])).toEqual([
        ['English', null, null, 'Good progress in reading.', 'Ms. Sherif'],
        ['Math', 67.5, 'Good', 'Ali works hard in every lesson.', 'Ms. Hana'],
      ]);
      expect(s.overall).toEqual({ percent: 67.5, band: expect.objectContaining({ label: 'Good' }) });
      expect(s.attendance).toEqual(expect.objectContaining({ present: 1, late: 1, absent: 1, excused: 0, onTrip: 0 }));
      expect(s.attendance.days).toBeGreaterThan(0);
      expect(s).toEqual(expect.objectContaining({ classTeacher: 'Ms. Sherif', classTeacherComment: 'A kind and helpful boy.', principalComment: 'Keep it up, Ali.', principalName: 'Dr. Amal Fawzy' }));
      expect(s.school).toEqual({ name: 'Academics School', nameAr: null });
    });

    it('is published by Student Affairs, which freezes it and tells the parents', async () => {
      await t2.post('/api/academics/report-cards/publish', { ids: [id.cardAli] }).expect(403);
      expect((await admin.post('/api/academics/report-cards/publish').expect(400)).body.message).toBe('Choose which report cards to publish.');
      expect((await admin.post('/api/academics/report-cards/publish', { classId: id.classA, term: 1, yearId: id.year }).expect(201)).body).toEqual({ published: 2 });
      const [n] = await told(id.p1u, 'reportCard.published');
      expect(n.title).toBe('Ali’s report card for term 1 is ready');
      expect(n.data).toEqual(expect.objectContaining({ studentId: id.Ali, reportCardId: id.cardAli, term: 1, year: '2000-2099' }));
      expect(await told(id.p3u, 'reportCard.published')).toHaveLength(0); // restricted for Layla
      expect((await admin.post('/api/academics/report-cards/publish', { classId: id.classA, term: 1, yearId: id.year }).expect(201)).body).toEqual({ published: 0 });
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'reportcard.publish' } })).toBe(2);
    });

    it('shows the parent the published card, which a later change to a mark leaves alone', async () => {
      const list = (await p1.get(`/api/parent/children/${id.Ali}/report-cards`).expect(200)).body;
      expect(list).toEqual([expect.objectContaining({ id: id.cardAli, year: '2000-2099', term: 1, overall: expect.objectContaining({ percent: 67.5 }) })]);
      await save(t1, id.a2, [{ studentId: id.Ali, score: 30 }]).expect(200);
      expect((await grades(p1, id.Ali)).subjects[0].percent).toBe(45); // the marks moved on … (1 × 90% + 3 × 30%) ÷ 4
      const card = (await p1.get(`/api/parent/children/${id.Ali}/report-cards/${id.cardAli}`).expect(200)).body;
      expect(card.snapshot.subjects.find((x: any) => x.name === 'Math').percent).toBe(67.5); // … the card did not
      expect((await t2.get(`/api/academics/report-cards/${id.cardAli}`).expect(200)).body.snapshot.overall.percent).toBe(67.5);
      await p3.get(`/api/parent/children/${id.Layla}/report-cards`).expect(404);
      await p2.get(`/api/parent/children/${id.Ali}/report-cards/${id.cardAli}`).expect(404);
    });

    it('can’t be commented on while published; unpublishing hides it from the parent until it is published again', async () => {
      expect((await t1.patch(`/api/academics/report-cards/${id.cardAli}/comments`, { subjectId: id.math, comment: 'Late edit' }).expect(400)).body.message).toBe('This report card is published. Unpublish it to change it.');
      await t2.post(`/api/academics/report-cards/${id.cardAli}/unpublish`).expect(403);
      await admin.post(`/api/academics/report-cards/${id.cardAli}/unpublish`).expect(201);
      expect((await p1.get(`/api/parent/children/${id.Ali}/report-cards`).expect(200)).body).toEqual([]);
      await p1.get(`/api/parent/children/${id.Ali}/report-cards/${id.cardAli}`).expect(404);
      await t1.patch(`/api/academics/report-cards/${id.cardAli}/comments`, { subjectId: id.math, comment: 'Updated comment' }).expect(200);
      await admin.post('/api/academics/report-cards/publish', { ids: [id.cardAli] }).expect(201);
      const card = (await p1.get(`/api/parent/children/${id.Ali}/report-cards/${id.cardAli}`).expect(200)).body;
      expect(card.snapshot.subjects.find((x: any) => x.name === 'Math')).toEqual(expect.objectContaining({ percent: 45, comment: 'Updated comment' })); // frozen afresh
    });
  });

  describe('the switches', () => {
    it('turns report cards off on their own: the routes close, the gradebook stays open', async () => {
      await owner.patch(`/api/owner/schools/${schoolId}/modules/academics/features`, { features: { reportCards: false } }).expect(200);
      await admin.get(`/api/academics/report-cards?classId=${id.classA}`).expect(403);
      await p1.get(`/api/parent/children/${id.Ali}/report-cards`).expect(403);
      await gradebook(t1).expect(200);
      await p1.get(`/api/parent/children/${id.Ali}/grades`).expect(200);
      await owner.patch(`/api/owner/schools/${schoolId}/modules/academics/features`, { features: { reportCards: true } }).expect(200);
      await admin.get(`/api/academics/report-cards?classId=${id.classA}`).expect(200);
    });

    it('closes everything when Academics is off', async () => {
      await owner.put(`/api/owner/schools/${schoolId}/modules/academics`, { enabled: false }).expect(200);
      await t1.get('/api/academics/teaching').expect(403);
      await p1.get(`/api/parent/children/${id.Ali}/grades`).expect(403);
      await owner.put(`/api/owner/schools/${schoolId}/modules/academics`, { enabled: true }).expect(200);
      await t1.get('/api/academics/teaching').expect(200);
    });
  });
});
