import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { Client, kid, login, ownerClient, startApp } from './helpers';
import { BehaviourService, EDIT_WINDOW_HOURS } from '../src/behaviour/behaviour';

const HOUR = 3600_000;

describe('Behaviour (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, social: Client, t1: Client, t2: Client, p1: Client, p2: Client, p3: Client;
  let schoolId: string;
  const id: Record<string, string> = {};
  const svc = () => app.get(BehaviourService);

  const notes = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'behaviour.note' }, orderBy: { createdAt: 'asc' } });
  const praise = (c: Client, student: string, extra: object = {}) => c.post('/api/behaviour', { studentId: student, kind: 'PRAISE', category: 'KINDNESS', text: 'Helped a classmate carry the books.', ...extra });
  const forParent = async (c: Client, student: string) => (await c.get(`/api/parent/children/${student}/behaviour`).expect(200)).body;

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'beh');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Behaviour School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@beh.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@beh.eg', 'admin-pass');
    for (const [key, name, role] of [['t1', 'Hana', 'TEACHER'], ['t2', 'Sherif', 'TEACHER'], ['sw', 'Mervat', 'SOCIAL_WORKER']]) {
      id[key] = (await admin.post('/api/staff', { name, role, email: `${key}@beh.eg`, password: 'staff-pass' }).expect(201)).body.id;
    }
    t1 = await login(app, 't1@beh.eg', 'staff-pass');
    t2 = await login(app, 't2@beh.eg', 'staff-pass');
    social = await login(app, 'sw@beh.eg', 'staff-pass');

    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    id.classA = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id })).body.id;
    id.classB = (await admin.post('/api/classes', { name: '4-B', gradeId: grade.id })).body.id;
    const rooms = [(await admin.post('/api/rooms', { name: 'Room A' })).body.id, (await admin.post('/api/rooms', { name: 'Room B' })).body.id];
    const math = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    const period = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' })).body.id;
    await admin.post('/api/timetable', { classId: id.classA, dayOfWeek: 0, periodId: period, roomId: rooms[0], subjectId: math, teacherId: id.t1 }).expect(201);
    await admin.post('/api/timetable', { classId: id.classB, dayOfWeek: 0, periodId: period, roomId: rooms[1], subjectId: math, teacherId: id.t2 }).expect(201);

    const student = async (key: string, code: string, classId: string, gender: string, parent: object) => {
      id[key] = (await admin.post('/api/students', { ...(await kid(admin)), gender, code, firstName: key, lastName: 'Test', classId, parent }).expect(201)).body.id;
    };
    const mother = (n: number, name: string) => ({ relation: 'MOTHER', name, email: `p${n}@beh.eg`, phone: `+20170000${String(n).padStart(3, '0')}`, password: 'parent-pass' });
    await student('Ali', 'B1', id.classA, 'MALE', mother(1, 'Rania'));
    await student('Layla', 'B2', id.classA, 'FEMALE', mother(3, 'Nadia'));
    await student('Salma', 'B3', id.classB, 'FEMALE', mother(2, 'Dina'));
    p1 = await login(app, 'p1@beh.eg', 'parent-pass');
    p2 = await login(app, 'p2@beh.eg', 'parent-pass');
    p3 = await login(app, 'p3@beh.eg', 'parent-pass');
    for (const [key, email] of [['p1', 'p1@beh.eg'], ['p2', 'p2@beh.eg'], ['p3', 'p3@beh.eg']]) id[key] = (await prisma.user.findFirstOrThrow({ where: { email } })).id;
    await admin.patch(`/api/students/${id.Layla}/guardians/${id.p3}`, { restricted: true }).expect(200); // Nadia sees nothing about Layla
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('who writes what', () => {
    it('lets a teacher praise a student they teach, and tells the parent', async () => {
      const note = (await praise(t1, id.Ali).expect(201)).body;
      expect(note).toEqual(expect.objectContaining({ kind: 'PRAISE', category: 'KINDNESS', visibleToParents: true, readByParent: false }));
      id.note = note.id;
      const told = await notes(id.p1);
      expect(told).toHaveLength(1);
      expect(told[0].title).toBe('A note from school about Ali');
      expect(told[0].data).toEqual(expect.objectContaining({ studentId: id.Ali, noteId: note.id, kind: 'PRAISE' }));
    });

    it('refuses a teacher a student they don’t teach, and an incident', async () => {
      const res = await praise(t1, id.Salma).expect(403);
      expect(res.body.message).toBe('You can write notes only for students you teach.');
      const incident = await t1.post('/api/behaviour', { studentId: id.Ali, kind: 'INCIDENT', category: 'FIGHT', severity: 'MINOR', text: 'A scuffle in the yard.' }).expect(403);
      expect(incident.body.message).toBe('Incidents are recorded by Student Affairs.');
    });

    it('lets Student Affairs and the social worker write about anyone', async () => {
      await praise(admin, id.Salma, { category: 'EFFORT' }).expect(201);
      await social.post('/api/behaviour', { studentId: id.Ali, kind: 'CONCERN', category: 'PUNCTUALITY', text: 'Late three days this week.' }).expect(201);
    });

    it('keeps parents out of the staff screens', async () => {
      await p1.get('/api/behaviour').expect(403);
      await p1.post('/api/behaviour', { studentId: id.Ali, kind: 'PRAISE', category: 'KINDNESS', text: 'Nice work.' }).expect(403);
    });
  });

  describe('incidents', () => {
    it('are kept from parents until Student Affairs shares them, and the parent is told once', async () => {
      const incident = (await admin.post('/api/behaviour', { studentId: id.Ali, kind: 'INCIDENT', category: 'DAMAGE', severity: 'MODERATE', text: 'Broke a window in the gym.', actionTaken: 'Spoke with him and his mother.', place: 'Gym' }).expect(201)).body;
      expect(incident.visibleToParents).toBe(false);
      id.incident = incident.id;
      const before = (await notes(id.p1)).length;
      expect((await forParent(p1, id.Ali)).notes.map((n: any) => n.id)).not.toContain(incident.id);

      await admin.patch(`/api/behaviour/${incident.id}`, { visibleToParents: true }).expect(200);
      const shown = (await forParent(p1, id.Ali)).notes.find((n: any) => n.id === incident.id);
      expect(shown).toEqual(expect.objectContaining({ kind: 'INCIDENT', severity: 'MODERATE', actionTaken: 'Spoke with him and his mother.' }));
      expect((await notes(id.p1)).length).toBe(before + 1);
      expect((await notes(id.p1)).at(-1)!.title).toBe('A note from school about Ali');
      await admin.patch(`/api/behaviour/${incident.id}`, { visibleToParents: true }).expect(200); // already shared: no second notification
      expect((await notes(id.p1)).length).toBe(before + 1);
    });

    it('need a serious level, and only they have one', async () => {
      await admin.post('/api/behaviour', { studentId: id.Ali, kind: 'INCIDENT', category: 'FIGHT', text: 'A scuffle in the yard.' }).expect(400);
      await admin.post('/api/behaviour', { studentId: id.Ali, kind: 'PRAISE', category: 'KINDNESS', text: 'Helpful as always.', severity: 'MINOR' }).expect(400);
      await admin.post('/api/behaviour', { studentId: id.Ali, kind: 'PRAISE', category: 'KINDNESS', text: 'Helpful as always.', place: 'Yard' }).expect(400);
    });
  });

  describe('merit points', () => {
    it('are limited to a range for each kind', async () => {
      await praise(t1, id.Ali, { points: 3 }).expect(201);
      await praise(t1, id.Ali, { points: 0 }).expect(400);
      await praise(t1, id.Ali, { points: 6 }).expect(400);
      await t1.post('/api/behaviour', { studentId: id.Ali, kind: 'CONCERN', category: 'HOMEWORK', text: 'Homework missing again.', points: -2 }).expect(201);
      await t1.post('/api/behaviour', { studentId: id.Ali, kind: 'CONCERN', category: 'HOMEWORK', text: 'Homework missing again.', points: 2 }).expect(400);
      await admin.post('/api/behaviour', { studentId: id.Ali, kind: 'INCIDENT', category: 'OTHER', severity: 'MINOR', text: 'Left without permission.', points: -10 }).expect(201);
      await admin.post('/api/behaviour', { studentId: id.Ali, kind: 'INCIDENT', category: 'OTHER', severity: 'MINOR', text: 'Left without permission.', points: -11 }).expect(400);
    });

    it('show in the parent’s totals, and vanish with the feature', async () => {
      const on = await forParent(p1, id.Ali);
      // The -10 incident hasn't been shared, so it isn't in what the parent sees.
      expect(on.totals.points).toBe(3 - 2);
      expect(on.notes.some((n: any) => n.points === 3)).toBe(true);

      await owner.patch(`/api/owner/schools/${schoolId}/modules/behavior/features`, { features: { merits: false } }).expect(200);
      const res = await praise(t1, id.Ali, { points: 2 }).expect(400);
      expect(res.body.message).toBe('Merit points are switched off for this school.');
      const off = await forParent(p1, id.Ali);
      expect(off.totals.points).toBeUndefined();
      expect(off.notes.every((n: any) => n.points === null)).toBe(true);
      await praise(t1, id.Ali).expect(201); // notes without points are fine
      await owner.patch(`/api/owner/schools/${schoolId}/modules/behavior/features`, { features: { merits: true } }).expect(200);
    });
  });

  describe('what a note must be', () => {
    it('has a category that fits its kind, some text, and a sensible date', async () => {
      await praise(t1, id.Ali, { category: 'FIGHT' }).expect(400);
      await praise(t1, id.Ali, { category: 'NOT_A_CATEGORY' }).expect(400);
      await praise(t1, id.Ali, { text: 'ok' }).expect(400);
      await praise(t1, id.Ali, { occurredAt: new Date(Date.now() + 2 * HOUR).toISOString() }).expect(400);
      await praise(t1, id.Ali, { occurredAt: new Date(Date.now() - 31 * 24 * HOUR).toISOString() }).expect(400);
      await praise(t1, id.Ali, { occurredAt: new Date(Date.now() - 3 * 24 * HOUR).toISOString() }).expect(201);
      await praise(t1, 'nobody').expect(404);
    });

    it('offers a teacher their own students to write about, and Student Affairs everyone', async () => {
      expect((await t1.get('/api/behaviour/students').expect(200)).body.map((s: any) => s.firstName).sort()).toEqual(['Ali', 'Layla']);
      expect((await t2.get('/api/behaviour/students').expect(200)).body.map((s: any) => s.firstName)).toEqual(['Salma']);
      expect((await admin.get('/api/behaviour/students').expect(200)).body).toHaveLength(3);
    });

    it('lists the fixed categories for the screens', async () => {
      const cats = (await t1.get('/api/behaviour/categories').expect(200)).body;
      expect(cats.PRAISE).toContain('KINDNESS');
      expect(cats.CONCERN).toContain('HOMEWORK');
      expect(cats.INCIDENT).toContain('BULLYING');
    });
  });

  describe('who sees what', () => {
    it('shows a teacher only the notes about students they teach', async () => {
      const mine = (await t1.get('/api/behaviour').expect(200)).body;
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((n: any) => n.student.id !== id.Salma)).toBe(true);
      expect((await t2.get('/api/behaviour').expect(200)).body.map((n: any) => n.student.id)).toEqual([id.Salma]);
      expect((await admin.get('/api/behaviour').expect(200)).body.some((n: any) => n.student.id === id.Salma)).toBe(true);
      await t2.patch(`/api/behaviour/${id.note}`, { text: 'Edited by someone else' }).expect(404); // not their student
    });

    it('filters by student, kind and day', async () => {
      const kind = (await admin.get('/api/behaviour?kind=INCIDENT').expect(200)).body;
      expect(kind.length).toBeGreaterThan(0);
      expect(kind.every((n: any) => n.kind === 'INCIDENT')).toBe(true);
      const student = (await admin.get(`/api/behaviour?studentId=${id.Salma}`).expect(200)).body;
      expect(student.every((n: any) => n.student.id === id.Salma)).toBe(true);
      const today = new Date().toISOString().slice(0, 10);
      expect((await admin.get(`/api/behaviour?from=${today}&to=${today}`).expect(200)).body.length).toBeGreaterThan(0);
      await admin.get('/api/behaviour?from=yesterday').expect(400);
    });

    it('keeps a restricted parent out entirely', async () => {
      await admin.post('/api/behaviour', { studentId: id.Layla, kind: 'PRAISE', category: 'ACHIEVEMENT', text: 'Top mark in the quiz.' }).expect(201);
      await p3.get(`/api/parent/children/${id.Layla}/behaviour`).expect(404);
      expect(await notes(id.p3)).toHaveLength(0);
      await p1.get(`/api/parent/children/${id.Layla}/behaviour`).expect(404); // not their child
    });

    it('lets a parent mark a note read, and staff see that', async () => {
      await p1.post(`/api/parent/children/${id.Ali}/behaviour/${id.note}/read`).expect(201);
      await p1.post(`/api/parent/children/${id.Ali}/behaviour/${id.note}/read`).expect(201); // again: fine
      expect((await forParent(p1, id.Ali)).notes.find((n: any) => n.id === id.note).read).toBe(true);
      expect((await t1.get('/api/behaviour').expect(200)).body.find((n: any) => n.id === id.note).readByParent).toBe(true);
      await p2.post(`/api/parent/children/${id.Ali}/behaviour/${id.note}/read`).expect(404);
      await p1.post(`/api/parent/children/${id.Ali}/behaviour/${id.incident}x/read`).expect(404);
    });
  });

  describe('changing and withdrawing', () => {
    it('lets the author change a note for a day, then only Student Affairs', async () => {
      await t1.patch(`/api/behaviour/${id.note}`, { text: 'Helped a classmate carry the heavy books.' }).expect(200);
      const row = await prisma.behaviourNote.findUniqueOrThrow({ where: { id: id.note } });
      const later = new Date(row.createdAt.getTime() + (EDIT_WINDOW_HOURS + 1) * HOUR);
      const teacher = { id: id.t1, schoolId, role: Role.TEACHER };
      await expect(svc().update(teacher, schoolId, id.note, { text: 'Too late' }, later)).rejects.toThrow('for 24 hours');
      await expect(svc().withdraw(teacher, schoolId, id.note, later)).rejects.toThrow('for 24 hours');
      await svc().update({ id: id.sw, schoolId, role: Role.SOCIAL_WORKER }, schoolId, id.note, { text: 'Corrected by Student Affairs.' }, later);
      expect((await prisma.behaviourNote.findUniqueOrThrow({ where: { id: id.note } })).text).toBe('Corrected by Student Affairs.');
    });

    it('lets only the author or Student Affairs change a note', async () => {
      const mine = (await t1.post('/api/behaviour', { studentId: id.Ali, kind: 'CONCERN', category: 'RESPECT', text: 'Spoke over the teacher.' }).expect(201)).body;
      // Another teacher of the same students (the class teacher) can read it but not change it.
      await prisma.class.update({ where: { id: id.classA }, data: { homeroomTeacherId: id.t2 } });
      const res = await t2.patch(`/api/behaviour/${mine.id}`, { text: 'Not yours.' }).expect(403);
      expect(res.body.message).toBe('Only the author or Student Affairs can change this note.');
      await prisma.class.update({ where: { id: id.classA }, data: { homeroomTeacherId: null } });
      await admin.patch(`/api/behaviour/${mine.id}`, { text: 'Spoke over the teacher twice.' }).expect(200);
    });

    it('takes a withdrawn note away from parents, the totals and the staff list', async () => {
      const before = await forParent(p1, id.Ali);
      const gone = (await praise(t1, id.Ali, { points: 4 }).expect(201)).body;
      expect((await forParent(p1, id.Ali)).totals.points).toBe(before.totals.points + 4);
      await t1.post(`/api/behaviour/${gone.id}/withdraw`).expect(201);
      const after = await forParent(p1, id.Ali);
      expect(after.notes.map((n: any) => n.id)).not.toContain(gone.id);
      expect(after.totals).toEqual(before.totals);
      expect((await admin.get('/api/behaviour').expect(200)).body.map((n: any) => n.id)).not.toContain(gone.id);
      await t1.patch(`/api/behaviour/${gone.id}`, { text: 'Back again' }).expect(404);
    });

    it('leaves a trail in the audit log', async () => {
      const actions = (await admin.get('/api/audit?entity=student').expect(200)).body.map((a: any) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['behaviour.note', 'behaviour.edit', 'behaviour.withdraw']));
    });
  });

  describe('the class summary', () => {
    it('counts notes and points for each student this year, for the teacher’s own classes', async () => {
      const mine = (await t1.get('/api/behaviour/summary').expect(200)).body;
      expect(mine.map((s: any) => s.name).sort()).toEqual(['Ali Test', 'Layla Test']);
      const ali = mine.find((s: any) => s.name === 'Ali Test');
      expect(ali.praise).toBeGreaterThan(0);
      expect(ali.concern).toBeGreaterThan(0);
      expect(ali.incident).toBe(2);
      expect(ali.points).toBe(3 - 2 - 10);
      await t1.get(`/api/behaviour/summary?classId=${id.classB}`).expect(403);
      expect((await admin.get(`/api/behaviour/summary?classId=${id.classB}`).expect(200)).body.map((s: any) => s.name)).toEqual(['Salma Test']);
    });

    it('can be narrowed to one student for their page, and a teacher gets nothing for a student they do not teach', async () => {
      const one = (await t1.get(`/api/behaviour/summary?studentId=${id.Ali}`).expect(200)).body;
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({ studentId: id.Ali, name: 'Ali Test', incident: 2, points: 3 - 2 - 10 });
      expect((await t1.get(`/api/behaviour/summary?studentId=${id.Salma}`).expect(200)).body).toEqual([]);
      expect((await admin.get(`/api/behaviour/summary?studentId=${id.Salma}`).expect(200)).body).toHaveLength(1);
    });
  });

  describe('the module switch', () => {
    it('closes everything when Behaviour is off, and is absent from the Essentials plan', async () => {
      await owner.put(`/api/owner/schools/${schoolId}/modules/behavior`, { enabled: false }).expect(200);
      await t1.get('/api/behaviour').expect(403);
      await p1.get(`/api/parent/children/${id.Ali}/behaviour`).expect(403);
      await owner.put(`/api/owner/schools/${schoolId}/modules/behavior`, { enabled: true }).expect(200);
      await t1.get('/api/behaviour').expect(200);

      await owner.post('/api/owner/schools', { name: 'Small', plan: 'ESSENTIALS', admin: { name: 'A', email: 'admin@small-beh.eg', password: 'admin-pass' } }).expect(201);
      const small = await login(app, 'admin@small-beh.eg', 'admin-pass');
      await small.get('/api/behaviour').expect(403);
    });

    it('keeps one school’s notes from another’s', async () => {
      await owner.post('/api/owner/schools', { name: 'Other', plan: 'COMPLETE', admin: { name: 'A', email: 'admin@other-beh.eg', password: 'admin-pass' } }).expect(201);
      const other = await login(app, 'admin@other-beh.eg', 'admin-pass');
      expect((await other.get('/api/behaviour').expect(200)).body).toEqual([]);
      await other.patch(`/api/behaviour/${id.note}`, { text: 'Not their note.' }).expect(404);
      await other.post('/api/behaviour', { studentId: id.Ali, kind: 'PRAISE', category: 'KINDNESS', text: 'Nice work.' }).expect(404);
    });
  });
});
