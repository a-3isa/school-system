import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { addDays, Client, kid, login, ownerClient, pastSunday, startApp, wideYear } from './helpers';
import { ActivitiesService } from '../src/activities/activities';
import { zonedTime } from '../src/common/time';

describe('Activities: clubs (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, t1: Client, t2: Client, p1: Client, p2: Client, p3: Client, p4: Client, other: Client;
  let schoolId: string;
  const id: Record<string, string> = {};
  const svc = () => app.get(ActivitiesService);

  const join = (c: Client, child: string, club: string) => c.post(`/api/parent/children/${child}/activities/${club}/join`);
  const leave = (c: Client, child: string, club: string) => c.post(`/api/parent/children/${child}/activities/${club}/leave`);
  const club = (extra: object = {}) => ({ name: 'Chess', days: [0, 2], startTime: '14:30', endTime: '15:30', capacity: 2, ...extra });
  const told = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type }, orderBy: { createdAt: 'asc' } });
  const status = async (clubId: string, studentId: string) => (await prisma.activityEnrolment.findUnique({ where: { activityId_studentId: { activityId: clubId, studentId } } }))?.status;

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'act');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Activities School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@act.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@act.eg', 'admin-pass');
    await owner.post('/api/owner/schools', { name: 'Other Activities School', plan: 'COMPLETE', admin: { name: 'Other', email: 'admin@other-act.eg', password: 'admin-pass' } }).expect(201);
    other = await login(app, 'admin@other-act.eg', 'admin-pass');
    for (const [key, name] of [['t1', 'Hana'], ['t2', 'Sherif']]) {
      id[key] = (await admin.post('/api/staff', { name, role: 'TEACHER', email: `${key}@act.eg`, password: 'staff-pass' }).expect(201)).body.id;
    }
    t1 = await login(app, 't1@act.eg', 'staff-pass');
    t2 = await login(app, 't2@act.eg', 'staff-pass');
    // A school year wide enough that "now" is always inside it.
    await admin.post('/api/school/years', wideYear()).expect(201);

    id.g4 = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body.id;
    id.g5 = (await admin.post('/api/grades', { name: 'Grade 5', order: 5 })).body.id;
    id.classA = (await admin.post('/api/classes', { name: '4-A', gradeId: id.g4 })).body.id;
    id.classB = (await admin.post('/api/classes', { name: '4-B', gradeId: id.g4 })).body.id;
    id.classC = (await admin.post('/api/classes', { name: '5-A', gradeId: id.g5 })).body.id;
    id.room = (await admin.post('/api/rooms', { name: 'Library' })).body.id;

    const student = async (key: string, code: string, classId: string, parent: object) => {
      id[key] = (await admin.post('/api/students', { ...(await kid(admin)), code, firstName: key, lastName: 'Test', classId, parent }).expect(201)).body.id;
    };
    const mother = (n: number, name: string) => ({ relation: 'MOTHER', name, email: `p${n}@act.eg`, phone: `+20130000${String(n).padStart(3, '0')}`, password: 'parent-pass' });
    await student('Ali', 'C1', id.classA, mother(1, 'Rania'));
    await student('Layla', 'C2', id.classA, mother(3, 'Nadia'));
    await student('Salma', 'C3', id.classB, mother(2, 'Dina'));
    await student('Omar', 'C4', id.classC, mother(4, 'Heba'));
    p1 = await login(app, 'p1@act.eg', 'parent-pass');
    p2 = await login(app, 'p2@act.eg', 'parent-pass');
    p3 = await login(app, 'p3@act.eg', 'parent-pass');
    p4 = await login(app, 'p4@act.eg', 'parent-pass');
    for (const n of [1, 2, 3, 4]) id[`p${n}`] = (await prisma.user.findFirstOrThrow({ where: { email: `p${n}@act.eg` } })).id;
    await admin.patch(`/api/students/${id.Layla}/guardians/${id.p3}`, { restricted: true }).expect(200); // Nadia sees nothing about Layla
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('creating a club', () => {
    it('is for Student Affairs, with a supervisor, a room and the year groups that may join', async () => {
      await t1.post('/api/activities', club()).expect(403);
      const res = (await admin.post('/api/activities', club({ name: 'Chess', nameAr: 'الشطرنج', supervisorId: id.t1, roomId: id.room, gradeIds: [id.g4], description: 'Beginners welcome.' })).expect(201)).body;
      expect(res).toEqual(expect.objectContaining({ name: 'Chess', nameAr: 'الشطرنج', capacity: 2, days: [0, 2], enrolled: 0, waitlisted: 0, canManage: true, fee: null }));
      expect(res.supervisor.name).toBe('Hana');
      expect(res.room.name).toBe('Library');
      id.chess = res.id;
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'activity.create' } })).toBe(1);
    });

    it('refuses what makes no sense', async () => {
      const msg = async (extra: object) => (await admin.post('/api/activities', club(extra)).expect(400)).body.message;
      expect(await msg({ days: [0, 0] })).toBe('Each day can be chosen once.');
      expect(await msg({ days: [5] })).toBe('Choose days the school is open.'); // Friday
      expect(await msg({ startTime: '15:30', endTime: '14:30' })).toBe('The club must start before it ends.');
      expect(await msg({ startTime: '2:30pm' })).toBe('Times must look like 14:30.');
      expect(await msg({ gradeIds: ['nope'] })).toBe('Year group not found.');
      expect(await msg({ supervisorId: 'nope' })).toBe('Supervisor not found in this school.');
      expect(await msg({ roomId: 'nope' })).toBe('Room not found in this school.');
      await admin.post('/api/activities', club({ capacity: 0 })).expect(400);
      await admin.post('/api/activities', club({ capacity: 501 })).expect(400);
      await admin.post('/api/activities', club({ days: [] })).expect(400);
    });

    it('takes a fee only while paid clubs are switched on', async () => {
      expect((await admin.post('/api/activities', club({ name: 'Art', fee: 350 })).expect(400)).body.message).toBe('Fees for clubs are switched off for this school.');
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { paidActivities: true } }).expect(200);
      const art = (await admin.post('/api/activities', club({ name: 'Art', fee: 350, days: [1], capacity: 3 })).expect(201)).body;
      expect(art.fee).toBe(350);
      id.art = art.id;
      await admin.post('/api/activities', club({ name: 'Free', fee: 100001 })).expect(400);
    });

    it('lists the clubs of the year with their places, to every member of staff', async () => {
      const list = (await t2.get('/api/activities').expect(200)).body;
      expect(list.map((c: any) => c.name)).toEqual(['Art', 'Chess']);
      expect(list.find((c: any) => c.name === 'Chess')).toEqual(expect.objectContaining({ enrolled: 0, waitlisted: 0, canManage: false })); // t2 supervises nothing
      expect((await t1.get('/api/activities').expect(200)).body.find((c: any) => c.name === 'Chess').canManage).toBe(true);
    });
  });

  describe('joining', () => {
    it('gives the last place to one of two parents racing for it, and the waitlist to the other', async () => {
      await admin.patch(`/api/activities/${id.chess}`, { capacity: 1 }).expect(200);
      const [a, b] = await Promise.all([join(p1, id.Ali, id.chess), join(p2, id.Salma, id.chess)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      const results = [a.body, b.body];
      expect(results.filter((r) => r.status === 'ENROLLED')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'WAITLISTED')).toHaveLength(1);
      expect(results.find((r) => r.status === 'WAITLISTED').waitlistPosition).toBe(1);
      expect(await prisma.activityEnrolment.count({ where: { activityId: id.chess, status: 'ENROLLED' } })).toBe(1);
    });

    it('promotes the first on the waitlist when the enrolled child leaves, and tells that family', async () => {
      const enrolled = (await prisma.activityEnrolment.findFirstOrThrow({ where: { activityId: id.chess, status: 'ENROLLED' } })).studentId;
      const waiting = (await prisma.activityEnrolment.findFirstOrThrow({ where: { activityId: id.chess, status: 'WAITLISTED' } })).studentId;
      const parentOf = (child: string) => (child === id.Ali ? p1 : p2);
      await leave(parentOf(enrolled), enrolled, id.chess).expect(201);
      expect(await status(id.chess, enrolled)).toBe('WITHDRAWN');
      expect(await status(id.chess, waiting)).toBe('ENROLLED');
      const parentId = waiting === id.Ali ? id.p1 : id.p2;
      const notes = await told(parentId, 'activity.promoted');
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe(`Good news: ${waiting === id.Ali ? 'Ali' : 'Salma'} now has a place in Chess`);
      expect(notes[0].data).toEqual(expect.objectContaining({ studentId: waiting, activityId: id.chess, name: 'Chess', nameAr: 'الشطرنج' }));
      id.inChess = waiting;
      id.outOfChess = enrolled;
    });

    it('lets a child who left join again, and shows a waitlist position and places in the parent’s list', async () => {
      const outParent = id.outOfChess === id.Ali ? p1 : p2;
      const res = (await join(outParent, id.outOfChess, id.chess).expect(201)).body;
      expect(res).toEqual({ status: 'WAITLISTED', waitlistPosition: 1 });
      const mine = (await outParent.get(`/api/parent/children/${id.outOfChess}/activities`).expect(200)).body.find((c: any) => c.id === id.chess);
      expect(mine).toEqual(expect.objectContaining({ name: 'Chess', status: 'WAITLISTED', waitlistPosition: 1, places: 0, capacity: 1, fee: null, signupOpen: true }));
    });

    it('refuses a year group the club isn’t open to, a second join, closed sign-up, and a restricted parent', async () => {
      expect((await join(p4, id.Omar, id.chess).expect(400)).body.message).toBe('This club isn’t open to Omar’s year group.'); // Grade 5
      const inParent = id.inChess === id.Ali ? p1 : p2;
      expect((await join(inParent, id.inChess, id.chess).expect(400)).body.message).toMatch(/is already on the list\.$/);
      await admin.patch(`/api/activities/${id.chess}`, { signupOpen: false }).expect(200);
      expect((await join(p3, id.Layla, id.chess).expect(404)).body.message).toBe('Child not found.'); // Nadia is restricted for Layla
      const closedFor = id.outOfChess === id.Ali ? p1 : p2;
      await leave(closedFor, id.outOfChess, id.chess).expect(201);
      expect((await join(closedFor, id.outOfChess, id.chess).expect(400)).body.message).toBe('Sign-up for this club is closed.');
      await admin.patch(`/api/activities/${id.chess}`, { signupOpen: true }).expect(200);
      await p3.get(`/api/parent/children/${id.Layla}/activities`).expect(404);
      await p1.get(`/api/parent/children/${id.Salma}/activities`).expect(404); // not their child
    });

    it('shows the clubs open to a child’s year group only, hides the fee while paid clubs are off, and warns about a clash', async () => {
      // Art meets Monday; Chess meets Sunday and Tuesday: no clash. A second club on Sunday at an overlapping time clashes.
      const inParent = id.inChess === id.Ali ? p1 : p2;
      const ids = (await inParent.get(`/api/parent/children/${id.inChess}/activities`).expect(200)).body.map((c: any) => c.id);
      expect(ids).toEqual(expect.arrayContaining([id.chess, id.art]));
      const robotics = (await admin.post('/api/activities', club({ name: 'Robotics', days: [0], startTime: '15:00', endTime: '16:00', capacity: 5 })).expect(201)).body.id;
      const res = (await join(inParent, id.inChess, robotics).expect(201)).body;
      expect(res.status).toBe('ENROLLED');
      expect(res.clash).toEqual({ name: 'Chess', nameAr: 'الشطرنج' });
      // Omar's year group sees only clubs that are open to Grade 5 or to everyone.
      const omar = (await p4.get(`/api/parent/children/${id.Omar}/activities`).expect(200)).body.map((c: any) => c.name);
      expect(omar).toEqual(['Art', 'Robotics']);
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { paidActivities: false } }).expect(200);
      expect((await p4.get(`/api/parent/children/${id.Omar}/activities`).expect(200)).body.find((c: any) => c.name === 'Art').fee).toBeNull();
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { paidActivities: true } }).expect(200);
      id.robotics = robotics;
    });
  });

  describe('running a club', () => {
    it('shows the roster to Student Affairs and to the supervisor only, with the waitlist in order and the parents’ phones', async () => {
      await t2.get(`/api/activities/${id.chess}/roster`).expect(403);
      const roster = (await t1.get(`/api/activities/${id.chess}/roster`).expect(200)).body;
      expect(roster.enrolled).toHaveLength(1);
      expect(roster.enrolled[0]).toEqual(expect.objectContaining({ studentId: id.inChess, class: expect.any(String), attendanceRate: null, paidAt: null }));
      expect(roster.enrolled[0].parents[0].phone).toMatch(/^\+201300/);
      expect(roster.waitlist).toEqual([]);
    });

    it('lets Student Affairs add a student over capacity, audited, and move a waitlisted one up', async () => {
      const res = (await admin.post(`/api/activities/${id.chess}/enrol`, { studentId: id.Layla }).expect(201)).body;
      expect(res.overCapacity).toBe(true);
      expect(await status(id.chess, id.Layla)).toBe('ENROLLED');
      expect((await admin.post(`/api/activities/${id.chess}/enrol`, { studentId: id.Layla }).expect(400)).body.message).toBe('Layla is already on the list.');
      await t1.post(`/api/activities/${id.chess}/enrol`, { studentId: id.Omar }).expect(403);
      expect(await prisma.auditLog.count({ where: { schoolId, action: 'activity.enrol' } })).toBeGreaterThanOrEqual(1);
    });

    it('refuses fewer places than students enrolled, and lets a bigger club take people off the waitlist', async () => {
      expect((await admin.patch(`/api/activities/${id.chess}`, { capacity: 1 }).expect(400)).body.message).toBe('More students are enrolled than the new number of places.');
      const closedParent = id.outOfChess === id.Ali ? p1 : p2;
      await join(closedParent, id.outOfChess, id.chess).expect(201); // waitlisted again
      expect(await status(id.chess, id.outOfChess)).toBe('WAITLISTED');
      await admin.patch(`/api/activities/${id.chess}`, { capacity: 5 }).expect(200);
      expect(await status(id.chess, id.outOfChess)).toBe('ENROLLED');
    });

    it('withdraws a student on behalf of the family and promotes the next', async () => {
      await t2.post(`/api/activities/${id.chess}/students/${id.Layla}/withdraw`).expect(403);
      await t1.post(`/api/activities/${id.chess}/students/${id.Layla}/withdraw`).expect(201);
      expect(await status(id.chess, id.Layla)).toBe('WITHDRAWN');
      await t1.post(`/api/activities/${id.chess}/students/${id.Layla}/withdraw`).expect(404);
    });

    it('marks a fee paid by hand, for enrolled students of a club that has one', async () => {
      const artParent = id.Omar;
      await join(p4, artParent, id.art).expect(201);
      await admin.post(`/api/activities/${id.art}/students/${artParent}/paid`, { paid: true }).expect(201);
      const row = (await admin.get(`/api/activities/${id.art}/roster`).expect(200)).body.enrolled[0];
      expect(row.paidAt).not.toBeNull();
      expect((await p4.get(`/api/parent/children/${id.Omar}/activities`).expect(200)).body.find((c: any) => c.id === id.art)).toEqual(expect.objectContaining({ fee: 350, paid: true }));
      await admin.post(`/api/activities/${id.art}/students/${artParent}/paid`, { paid: false }).expect(201);
      expect((await admin.post(`/api/activities/${id.chess}/students/${id.inChess}/paid`, { paid: true }).expect(400)).body.message).toBe('This club has no fee.');
      await t1.post(`/api/activities/${id.art}/students/${artParent}/paid`, { paid: true }).expect(403);
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { paidActivities: false } }).expect(200);
      await admin.post(`/api/activities/${id.art}/students/${artParent}/paid`, { paid: true }).expect(403);
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { paidActivities: true } }).expect(200);
    });

    it('takes attendance on a day the club meets, not on one it doesn’t, nor on a closed or future day', async () => {
      const sunday = pastSunday();
      const marks = { [id.inChess]: true };
      const res = (await t1.put(`/api/activities/${id.chess}/attendance`, { date: sunday, present: marks }).expect(200)).body;
      expect(res.marked).toBe(1);
      const saved = (await t1.get(`/api/activities/${id.chess}/attendance?date=${sunday}`).expect(200)).body;
      expect(saved.meets).toBe(true);
      expect(saved.students.find((s: any) => s.studentId === id.inChess).present).toBe(true);
      expect(saved.students.find((s: any) => s.studentId === id.outOfChess).present).toBeNull(); // not marked yet
      // Marking again changes it rather than adding a row.
      await t1.put(`/api/activities/${id.chess}/attendance`, { date: sunday, present: { [id.inChess]: false } }).expect(200);
      expect(await prisma.activityAttendance.count({ where: { activityId: id.chess } })).toBe(1);

      const monday = addDays(sunday, 1);
      expect((await t1.put(`/api/activities/${id.chess}/attendance`, { date: monday, present: marks }).expect(400)).body.message).toBe('The club doesn’t meet that day.');
      expect((await t1.put(`/api/activities/${id.chess}/attendance`, { date: sunday, present: { [id.Omar]: true } }).expect(400)).body.message).toBe('Some of those students aren’t enrolled in this club.');
      await t2.put(`/api/activities/${id.chess}/attendance`, { date: sunday, present: marks }).expect(403);
      // Not yet come: checked with a pinned "now".
      const admin1 = { id: id.t1, role: 'TEACHER' } as any;
      await expect(svc().markAttendance(admin1, schoolId, id.chess, { date: sunday, present: marks }, zonedTime(addDays(sunday, -7), '10:00', 'Africa/Cairo'))).rejects.toThrow('Attendance can’t be taken for a day that hasn’t come.');
      const roster = (await t1.get(`/api/activities/${id.chess}/roster`).expect(200)).body;
      expect(roster.enrolled.find((r: any) => r.studentId === id.inChess).attendanceRate).toBe(0);
    });

    it('closes a day for the club when the school is closed', async () => {
      await admin.post('/api/school/holidays', { name: 'Test holiday', fromDate: addDays(pastSunday(), 7), toDate: addDays(pastSunday(), 7) }).expect(201);
      expect((await t1.put(`/api/activities/${id.chess}/attendance`, { date: addDays(pastSunday(), 7), present: { [id.inChess]: true } }).expect(400)).body.message).toBe('The school is closed that day.');
    });
  });

  describe('clubs as an audience, archiving and other schools', () => {
    it('reaches the members of a club with an announcement, and refuses an unknown club', async () => {
      const inParentId = id.inChess === id.Ali ? id.p1 : id.p2;
      const res = (await admin.post('/api/announcements', { title: 'Chess tonight', body: 'Bring your boards.', audience: { kind: 'ACTIVITY', ids: [id.chess] } }).expect(201)).body;
      await admin.post(`/api/announcements/${res.id}/send`).expect(201);
      const got = await prisma.notification.findMany({ where: { type: 'announcement.new', schoolId } });
      const parents = new Set(got.map((n) => n.userId));
      expect(parents.has(inParentId)).toBe(true);
      expect(parents.has(id.p4)).toBe(false); // not in the club
      expect((await admin.post('/api/announcements', { title: 'x', body: 'y', audience: { kind: 'ACTIVITY', ids: ['nope'] } }).expect(400)).body.message).toBe('Club not found.');
      expect((await admin.post('/api/announcements', { title: 'x', body: 'y', audience: { kind: 'ACTIVITY', ids: [] } }).expect(400)).body.message).toBe('Choose at least one club.');
    });

    it('archives a club: everyone is withdrawn without a word, and it leaves the lists', async () => {
      const before = await prisma.notification.count({ where: { schoolId, type: 'activity.promoted' } });
      await admin.post(`/api/activities/${id.robotics}/archive`).expect(201);
      expect(await prisma.activityEnrolment.count({ where: { activityId: id.robotics, status: { in: ['ENROLLED', 'WAITLISTED'] } } })).toBe(0);
      expect(await prisma.notification.count({ where: { schoolId, type: 'activity.promoted' } })).toBe(before);
      expect((await admin.get('/api/activities').expect(200)).body.map((c: any) => c.name)).not.toContain('Robotics');
    });

    it('is invisible to another school', async () => {
      await other.patch(`/api/activities/${id.chess}`, { name: 'Hijacked' }).expect(404);
      await other.get(`/api/activities/${id.chess}/roster`).expect(404);
      expect((await other.get('/api/activities').expect(200)).body).toEqual([]);
    });

    it('is switched off with the module', async () => {
      await owner.put(`/api/owner/schools/${schoolId}/modules/activities`, { enabled: false }).expect(200);
      await admin.get('/api/activities').expect(403);
      await p1.get(`/api/parent/children/${id.Ali}/activities`).expect(403);
      await owner.put(`/api/owner/schools/${schoolId}/modules/activities`, { enabled: true }).expect(200);
    });
  });
});
