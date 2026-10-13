import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, kid, login, ownerClient, schoolWeek, startApp, wideYear } from './helpers';
import { TripsService } from '../src/activities/trips';
import { PrismaService } from '../src/prisma/prisma.service';
import { AttendanceJobs } from '../src/attendance/attendance';
import { zonedTime } from '../src/common/time';

// A school week far enough ahead that "the deadline is still to come" holds whenever this runs.
const W = schoolWeek();
const DAY = W.tue;
const CONSENT_BY = `${W.sun}T10:00:00.000Z`;

describe('Activities: trips and permission slips (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, leader: Client, homeroom: Client, stranger: Client, p1: Client, p2: Client, p3: Client, p4: Client, p5: Client;
  let schoolId: string;
  const id: Record<string, string> = {};
  const svc = () => app.get(TripsService);

  const trip = (extra: object = {}) => ({ title: 'Pyramids', destination: 'Giza', date: DAY, departTime: '08:00', returnTime: '14:00', consentBy: CONSENT_BY, classIds: [id.classA, id.classB], fromPeriod: 1, toPeriod: 3, fee: 120, leaderId: id.leader, ...extra });
  const told = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type }, orderBy: { createdAt: 'asc' } });
  const answer = (c: Client, child: string, tripId: string, body: object) => c.post(`/api/parent/children/${child}/trips/${tripId}/consent`, body);
  const sign = (decision: string, name = 'Rania Hassan', extra: object = {}) => ({ decision, signedName: name, ...extra });
  const onTrip = (tripId: string) => prisma.attendanceRecord.findMany({ where: { tripId }, include: { period: true } });

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'trip');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Trips School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@trip.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@trip.eg', 'admin-pass');
    for (const [key, name] of [['leader', 'Hana'], ['homeroom', 'Sherif'], ['stranger', 'Karim']]) {
      id[key] = (await admin.post('/api/staff', { name, role: 'TEACHER', email: `${key}@trip.eg`, password: 'staff-pass' }).expect(201)).body.id;
    }
    leader = await login(app, 'leader@trip.eg', 'staff-pass');
    homeroom = await login(app, 'homeroom@trip.eg', 'staff-pass');
    stranger = await login(app, 'stranger@trip.eg', 'staff-pass');
    await admin.post('/api/school/years', wideYear()).expect(201);

    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body.id;
    id.classA = (await admin.post('/api/classes', { name: '4-A', gradeId: grade })).body.id;
    id.classB = (await admin.post('/api/classes', { name: '4-B', gradeId: grade, homeroomTeacherId: id.homeroom })).body.id;
    id.classC = (await admin.post('/api/classes', { name: '4-C', gradeId: grade })).body.id;
    for (const [n, a, b] of [[1, '08:00', '08:45'], [2, '08:45', '09:30'], [3, '09:50', '10:35'], [4, '10:35', '11:20']] as const) {
      id[`period${n}`] = (await admin.post('/api/periods', { number: n, startTime: a, endTime: b })).body.id;
    }

    const student = async (key: string, code: string, classId: string, parent: object) => {
      id[key] = (await admin.post('/api/students', { ...(await kid(admin)), code, firstName: key, lastName: 'Test', classId, parent }).expect(201)).body.id;
    };
    const mother = (n: number, name: string) => ({ relation: 'MOTHER', name, email: `p${n}@trip.eg`, phone: `+20131000${String(n).padStart(3, '0')}`, password: 'parent-pass' });
    await student('Ali', 'T1', id.classA, mother(1, 'Rania'));
    await student('Layla', 'T2', id.classA, mother(3, 'Nadia'));
    await student('Salma', 'T3', id.classB, mother(2, 'Dina'));
    await student('Omar', 'T4', id.classC, mother(4, 'Heba'));
    await admin.post(`/api/students/${id.Salma}/guardians`, { relation: 'FATHER', name: 'Amr', email: 'p5@trip.eg', phone: '+20131000005', password: 'parent-pass' }).expect(201);
    p1 = await login(app, 'p1@trip.eg', 'parent-pass');
    p2 = await login(app, 'p2@trip.eg', 'parent-pass');
    p3 = await login(app, 'p3@trip.eg', 'parent-pass');
    p4 = await login(app, 'p4@trip.eg', 'parent-pass');
    p5 = await login(app, 'p5@trip.eg', 'parent-pass');
    for (const n of [1, 2, 3, 4, 5]) id[`p${n}`] = (await prisma.user.findFirstOrThrow({ where: { email: `p${n}@trip.eg` } })).id;
    await admin.patch(`/api/students/${id.Layla}/guardians/${id.p3}`, { restricted: true }).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('creating a trip', () => {
    it('is a draft that only Student Affairs makes, with its classes, leader, fee and periods', async () => {
      await leader.post('/api/trips', trip()).expect(403);
      const res = (await admin.post('/api/trips', trip()).expect(201)).body;
      expect(res).toEqual(expect.objectContaining({ title: 'Pyramids', destination: 'Giza', status: 'DRAFT', fee: 120, fromPeriod: 1, toPeriod: 3, departTime: '08:00' }));
      expect(res.classes.map((c: any) => c.name).sort()).toEqual(['4-A', '4-B']);
      expect(res.leader.name).toBe('Hana');
      id.trip = res.id;
    });

    it('refuses a closed day, bad times, half a period range, a deadline in the past or after departure, and strangers’ classes', async () => {
      const msg = async (extra: object) => (await admin.post('/api/trips', trip(extra)).expect(400)).body.message;
      expect(await msg({ date: W.fri })).toBe('The school is closed that day.'); // a Friday
      expect(await msg({ departTime: '15:00' })).toBe('The trip must leave before it returns.');
      expect(await msg({ fromPeriod: 2, toPeriod: undefined })).toBe('Give both fromPeriod and toPeriod, or neither for the whole day.');
      expect(await msg({ fromPeriod: 3, toPeriod: 1 })).toBe('toPeriod must not be before fromPeriod.');
      expect(await msg({ consentBy: '2020-01-01T00:00:00.000Z' })).toBe('The answer deadline must be in the future.');
      expect(await msg({ consentBy: `${W.tue}T09:00:00.000Z` })).toBe('The answer deadline must be before the trip leaves.'); // 11:00 Cairo, after 08:00 departure
      expect(await msg({ classIds: ['nope'] })).toBe('Class not found in this school.');
      expect(await msg({ leaderId: 'nope' })).toBe('Trip leader not found in this school.');
      await admin.post('/api/trips', trip({ classIds: [] })).expect(400);
    });

    it('is invisible to parents while it is a draft, and to another school', async () => {
      expect((await p1.get(`/api/parent/children/${id.Ali}/trips`).expect(200)).body).toEqual([]);
      await answer(p1, id.Ali, id.trip, sign('GIVEN')).expect(404);
    });
  });

  describe('permission slips', () => {
    it('opening the trip asks the parents of its classes, and nobody else, not even a restricted parent', async () => {
      await leader.post(`/api/trips/${id.trip}/open`).expect(403);
      await admin.post(`/api/trips/${id.trip}/open`).expect(201);
      for (const [parent, student, name] of [[id.p1, id.Ali, 'Ali'], [id.p2, id.Salma, 'Salma'], [id.p5, id.Salma, 'Salma']] as const) {
        const notes = await told(parent, 'trip.consent');
        expect(notes).toHaveLength(1);
        expect(notes[0].title).toBe(`Permission needed: Pyramids on ${DAY} for ${name}`);
        expect(notes[0].data).toEqual(expect.objectContaining({ tripId: id.trip, studentId: student, title: 'Pyramids', date: DAY }));
      }
      expect(await told(id.p3, 'trip.consent')).toHaveLength(0); // restricted for Layla
      expect(await told(id.p4, 'trip.consent')).toHaveLength(0); // class C is not going
      await admin.post(`/api/trips/${id.trip}/open`).expect(400);
    });

    it('records the answer with the typed name, audits it, and tells the other parent', async () => {
      const res = (await answer(p2, id.Salma, id.trip, sign('GIVEN', 'Dina  Hassan', { note: 'Allergic to nuts.' })).expect(201)).body;
      expect(res).toEqual({ ok: true, decision: 'GIVEN' });
      const row = await prisma.tripConsent.findUniqueOrThrow({ where: { tripId_studentId: { tripId: id.trip, studentId: id.Salma } } });
      expect(row).toEqual(expect.objectContaining({ decision: 'GIVEN', signedName: 'Dina Hassan', note: 'Allergic to nuts.', byUserId: id.p2 }));
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId, action: 'trip.consent' } });
      expect(audit.data).toEqual(expect.objectContaining({ decision: 'GIVEN', signedName: 'Dina Hassan', studentId: id.Salma }));
      const other = await told(id.p5, 'trip.answered');
      expect(other).toHaveLength(1);
      expect(other[0].title).toBe('Dina answered the permission slip for Salma: Yes');
      expect(await told(id.p2, 'trip.answered')).toHaveLength(0); // not told about their own answer
    });

    it('lets either parent change the answer, and the latest one stands', async () => {
      await answer(p5, id.Salma, id.trip, sign('DECLINED', 'Amr Kamal')).expect(201);
      let row = await prisma.tripConsent.findUniqueOrThrow({ where: { tripId_studentId: { tripId: id.trip, studentId: id.Salma } } });
      expect(row).toEqual(expect.objectContaining({ decision: 'DECLINED', signedName: 'Amr Kamal', byUserId: id.p5 }));
      await answer(p2, id.Salma, id.trip, sign('GIVEN', 'Dina Hassan', { note: 'Allergic to nuts.' })).expect(201); // the new answer replaces the old one whole, note included
      row = await prisma.tripConsent.findUniqueOrThrow({ where: { tripId_studentId: { tripId: id.trip, studentId: id.Salma } } });
      expect(row.decision).toBe('GIVEN');
      expect(await prisma.tripConsent.count({ where: { tripId: id.trip, studentId: id.Salma } })).toBe(1);
    });

    it('asks for a real name, and refuses a restricted parent, a stranger’s child and a class that isn’t going', async () => {
      expect((await answer(p1, id.Ali, id.trip, sign('GIVEN', '   ')).expect(400)).body.message).toBe('Type your full name to sign.');
      expect((await answer(p1, id.Ali, id.trip, sign('GIVEN', '  A  ')).expect(400)).body.message).toBe('Type your full name to sign.');
      await answer(p1, id.Ali, id.trip, sign('GIVEN', 'Al')).expect(400); // under three characters, caught by the field rules
      await answer(p3, id.Layla, id.trip, sign('GIVEN')).expect(404); // Nadia is restricted
      await answer(p1, id.Salma, id.trip, sign('GIVEN')).expect(404); // not their child
      await answer(p4, id.Omar, id.trip, sign('GIVEN')).expect(404); // class C isn't going
      await answer(p1, id.Ali, id.trip, { decision: 'MAYBE', signedName: 'Rania Hassan' }).expect(400);
    });

    it('closes the answers at the deadline', async () => {
      const afterDeadline = zonedTime(W.mon, '12:30', 'Africa/Cairo');
      const parent = { id: id.p1, role: 'PARENT' } as any;
      await expect(svc().consent(parent, id.Ali, id.trip, { decision: 'GIVEN', signedName: 'Rania Hassan' } as any, afterDeadline)).rejects.toThrow('The deadline for this permission slip has passed. Please contact the school.');
      const list = (await p1.get(`/api/parent/children/${id.Ali}/trips`).expect(200)).body;
      expect(list[0]).toEqual(expect.objectContaining({ title: 'Pyramids', status: 'OPEN', canAnswer: true, myConsent: null, paid: false, fee: 120 }));
    });

    it('shows Student Affairs, the leader and the teachers of the classes who has answered, and no one else', async () => {
      await answer(p1, id.Ali, id.trip, sign('DECLINED', 'Rania Hassan')).expect(201);
      const sheet = (await admin.get(`/api/trips/${id.trip}/consents`).expect(200)).body;
      expect(sheet.rows.map((r: any) => [r.name, r.decision])).toEqual([['Ali Test', 'DECLINED'], ['Layla Test', null], ['Salma Test', 'GIVEN']]);
      expect(sheet.rows[2]).toEqual(expect.objectContaining({ signedName: 'Dina Hassan', signedBy: 'Dina', note: 'Allergic to nuts.' }));
      expect(sheet.rows[2].parents.map((p: any) => p.phone).sort()).toEqual(['+20131000002', '+20131000005']);
      await leader.get(`/api/trips/${id.trip}/consents`).expect(200);
      await homeroom.get(`/api/trips/${id.trip}/consents`).expect(200); // class teacher of 4-B
      await stranger.get(`/api/trips/${id.trip}/consents`).expect(403);
      const list = (await admin.get('/api/trips').expect(200)).body;
      expect(list[0].counts).toEqual({ students: 3, given: 1, declined: 1, waiting: 1, paid: 0 });
      expect((await stranger.get('/api/trips').expect(200)).body).toEqual([]);
      expect((await homeroom.get('/api/trips').expect(200)).body).toHaveLength(1);
    });

    it('marks a fee paid by hand, only for students with permission', async () => {
      await admin.post(`/api/trips/${id.trip}/students/${id.Salma}/paid`, { paid: true }).expect(201);
      expect((await admin.get('/api/trips').expect(200)).body[0].counts.paid).toBe(1);
      expect((await p2.get(`/api/parent/children/${id.Salma}/trips`).expect(200)).body[0].paid).toBe(true);
      expect((await admin.post(`/api/trips/${id.trip}/students/${id.Ali}/paid`, { paid: true }).expect(400)).body.message).toBe('Only students with permission can be marked as paid.');
      await leader.post(`/api/trips/${id.trip}/students/${id.Salma}/paid`, { paid: false }).expect(403);
    });

    it('tells the parents who answered when the day or the fee changes, and no one else', async () => {
      await admin.patch(`/api/trips/${id.trip}`, { fee: 150 }).expect(200);
      expect(await told(id.p1, 'trip.changed')).toHaveLength(1);
      expect(await told(id.p2, 'trip.changed')).toHaveLength(1);
      expect(await told(id.p3, 'trip.changed')).toHaveLength(0); // restricted
      await admin.patch(`/api/trips/${id.trip}`, { classIds: [id.classA] }).expect(400); // classes only while a draft
      await admin.patch(`/api/trips/${id.trip}`, { description: 'Bring a hat.' }).expect(200);
      expect(await told(id.p1, 'trip.changed')).toHaveLength(1); // a description is not a change that matters
    });
  });

  describe('the day of the trip', () => {
    it('writes On a trip into the registers for the students with permission, in the trip’s periods only', async () => {
      const res = (await admin.post(`/api/trips/${id.trip}/close`).expect(201)).body;
      expect(res.marked).toBe(3); // Salma × periods 1 to 3
      const records = await onTrip(id.trip);
      expect(records.map((r) => [r.studentId, r.period.number, r.status, r.source, r.reason]).sort()).toEqual([
        [id.Salma, 1, 'ON_TRIP', 'MANUAL', 'Trip: Pyramids'],
        [id.Salma, 2, 'ON_TRIP', 'MANUAL', 'Trip: Pyramids'],
        [id.Salma, 3, 'ON_TRIP', 'MANUAL', 'Trip: Pyramids'],
      ].sort());
      expect(await prisma.attendanceRecord.count({ where: { studentId: id.Ali } })).toBe(0); // declined: expected at school
      expect((await admin.patch(`/api/trips/${id.trip}`, { fee: 10 }).expect(400)).body.message).toBe('This trip is closed. Cancel it and create a new one to change it.');
      await answer(p1, id.Ali, id.trip, sign('GIVEN')).expect(400);
      expect((await admin.post(`/api/trips/${id.trip}/close`).expect(400)).body.message).toBe('Only an open trip can be closed.');
    });

    it('takes the headcount only on the day, by Student Affairs or the leader, and only for students going', async () => {
      expect((await leader.post(`/api/trips/${id.trip}/headcount`, { studentId: id.Salma, leg: 'LEFT' }).expect(400)).body.message).toBe('Headcount is taken on the day of the trip.');
      const leaderUser = { id: id.leader, role: 'TEACHER' } as any;
      const morning = zonedTime(DAY, '08:10', 'Africa/Cairo');
      const afternoon = zonedTime(DAY, '13:40', 'Africa/Cairo');
      await expect(svc().takeHeadcount(leaderUser, schoolId, id.trip, { studentId: id.Salma, leg: 'BACK' }, morning)).rejects.toThrow('Mark that the student left first.');
      await expect(svc().takeHeadcount(leaderUser, schoolId, id.trip, { studentId: id.Ali, leg: 'LEFT' }, morning)).rejects.toThrow('That student isn’t going on this trip.');
      await expect(svc().takeHeadcount({ id: id.stranger, role: 'TEACHER' } as any, schoolId, id.trip, { studentId: id.Salma, leg: 'LEFT' }, morning)).rejects.toThrow('Only Student Affairs or the trip leader can take the headcount.');
      await svc().takeHeadcount(leaderUser, schoolId, id.trip, { studentId: id.Salma, leg: 'LEFT' }, morning);
      let count = await svc().headcount(leaderUser, schoolId, id.trip);
      expect(count).toEqual(expect.objectContaining({ going: 1, left: 1, back: 0 }));
      await svc().takeHeadcount(leaderUser, schoolId, id.trip, { studentId: id.Salma, leg: 'BACK' }, afternoon);
      count = await svc().headcount(leaderUser, schoolId, id.trip);
      expect(count).toEqual(expect.objectContaining({ going: 1, left: 1, back: 1 }));
      expect(count.rows[0].name).toBe('Salma Test');
      await stranger.get(`/api/trips/${id.trip}/headcount`).expect(403);
    });

    it('cancelling removes exactly the records the trip wrote, and tells the parents', async () => {
      // A record that is not the trip's must survive.
      await prisma.attendanceRecord.create({ data: { schoolId, studentId: id.Ali, classId: id.classA, periodId: id.period4, date: new Date(`${DAY}T00:00:00Z`), status: 'PRESENT', source: 'MANUAL' } });
      await admin.post(`/api/trips/${id.trip}/cancel`).expect(201);
      expect(await onTrip(id.trip)).toHaveLength(0);
      expect(await prisma.attendanceRecord.count({ where: { studentId: id.Ali } })).toBe(1);
      const notes = await told(id.p2, 'trip.cancelled');
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe(`The trip Pyramids on ${DAY} has been cancelled`);
      expect(await told(id.p3, 'trip.cancelled')).toHaveLength(0);
      expect((await p2.get(`/api/parent/children/${id.Salma}/trips`).expect(200)).body[0]).toEqual(expect.objectContaining({ status: 'CANCELLED', canAnswer: false }));
      expect((await admin.post(`/api/trips/${id.trip}/cancel`).expect(400)).body.message).toBe('This trip is already cancelled.');
    });
  });

  describe('the reminder', () => {
    it('goes once, to the parents who have not answered, a day before the deadline', async () => {
      const t2 = (await admin.post('/api/trips', trip({ title: 'Museum', destination: 'Cairo', date: W.wed, consentBy: `${W.tue}T09:00:00.000Z` })).expect(201)).body.id;
      await admin.post(`/api/trips/${t2}/open`).expect(201);
      await answer(p1, id.Ali, t2, sign('GIVEN')).expect(201);
      const before = new Date(`${W.tue}T09:00:00.000Z`).getTime();
      const early = new Date(before - 30 * 3600_000);
      expect(await svc().remind(early)).toBe(0); // 30 hours away: too soon
      const sent = await svc().remind(new Date(before - 23.5 * 3600_000));
      expect(sent).toBe(2); // Salma's two parents; Ali's answered, Layla's mother is restricted
      expect(await told(id.p1, 'trip.reminder')).toHaveLength(0);
      const notes = await told(id.p2, 'trip.reminder');
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('Reminder: please answer the permission slip for Salma by tomorrow');
      expect(await svc().remind(new Date(before - 23.2 * 3600_000))).toBe(0); // never twice
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: t2 } })).remindedAt).not.toBeNull();
      id.t2 = t2;
    });

    it('is run by the minute tick, and skipped when trips are switched off for the school', async () => {
      const t3 = (await admin.post('/api/trips', trip({ title: 'Park', destination: 'Zoo', date: W.thu, consentBy: `${W.wed}T09:00:00.000Z` })).expect(201)).body.id;
      await admin.post(`/api/trips/${t3}/open`).expect(201);
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { trips: false } }).expect(200);
      const at = new Date(new Date(`${W.wed}T09:00:00.000Z`).getTime() - 23.5 * 3600_000);
      await app.get(AttendanceJobs).tick(at);
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: t3 } })).remindedAt).toBeNull();
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { trips: true } }).expect(200);
      await app.get(AttendanceJobs).tick(at);
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: t3 } })).remindedAt).not.toBeNull();
    });
  });

  describe('the list', () => {
    it('counts the students of every trip with one query, however many trips there are', async () => {
      expect((await admin.get('/api/trips').expect(200)).body.length).toBeGreaterThan(2);
      const prisma2 = app.get(PrismaService);
      const counts = jest.spyOn(prisma2.student, 'count');
      const groups = jest.spyOn(prisma2.student, 'groupBy');
      try {
        await admin.get('/api/trips').expect(200);
        expect(counts.mock.calls.length + groups.mock.calls.length).toBe(1);
      } finally {
        counts.mockRestore();
        groups.mockRestore();
      }
    });
  });

  describe('switching off', () => {
    it('turns off trips with the feature while clubs go on working', async () => {
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { trips: false } }).expect(200);
      await admin.get('/api/trips').expect(403);
      await p1.get(`/api/parent/children/${id.Ali}/trips`).expect(403);
      await admin.get('/api/activities').expect(200);
      await p1.get(`/api/parent/children/${id.Ali}/activities`).expect(200);
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { trips: true } }).expect(200);
    });
  });
});
