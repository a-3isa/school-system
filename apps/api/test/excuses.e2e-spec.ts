import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Client, login, ownerClient, queriesDuring, startApp, kid, PNG } from './helpers';
import { AttendanceService } from '../src/attendance/attendance.service';
import { ExcusesService, ALERT_AFTER_MINUTES } from '../src/excuses/excuses';

const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const MIN = 60_000;

describe('Excuses and the “didn’t come” check (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, teacher: Client;
  let mona: Client, amr: Client, rania: Client, nadia: Client, hoda: Client;
  let schoolId: string, classId: string, periodId: string, today: string, yesterday: string;
  const ids: Record<string, string> = {};
  const svc = () => app.get(AttendanceService);
  const excuses = () => app.get(ExcusesService);

  const mark = (studentId: string, status: string, date = today) =>
    admin.put(`/api/attendance/classes/${classId}/periods/${periodId}`, { date, marks: [{ studentId, status }] }).expect(200);
  const day = async (c: Client, student: string, date = today) => (await c.get(`/api/parent/children/${student}/today?date=${date}`).expect(200)).body;
  const titles = async (c: Client) => (await c.get('/api/notifications').expect(200)).body.map((n: any) => `${n.type}: ${n.title}`);
  const send = (c: Client, student: string, fields: Record<string, string>, file?: Buffer) => c.upload(`/api/parent/children/${student}/excuses`, fields, file!, 'note.png');
  const sendPlain = (c: Client, student: string, body: Record<string, string>) => c.form(`/api/parent/children/${student}/excuses`, body);

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'exc');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Excuse School', plan: 'ESSENTIALS', admin: { name: 'Admin', email: 'admin@exc.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@exc.eg', 'admin-pass');
    await admin.patch('/api/school', { schoolDays: [0, 1, 2, 3, 4, 5, 6], absenceNoticeTime: '00:00' }).expect(200);
    await admin.post('/api/staff', { name: 'Hana', role: 'TEACHER', email: 'hana@exc.eg', password: 'teacher-pass' }).expect(201);
    teacher = await login(app, 'hana@exc.eg', 'teacher-pass');
    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    classId = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id })).body.id;
    periodId = (await admin.post('/api/periods', { number: 1, startTime: '00:00', endTime: '23:59' }).expect(201)).body.id;
    today = await svc().today(schoolId);
    yesterday = shift(today, -1);

    const mk = async (name: string, i: number, parent: object) => {
      ids[name] = (await admin.post('/api/students', { ...(await kid(admin)), code: `X${i}`, firstName: name, lastName: 'Test', classId, parent })).body.id;
    };
    await mk('Layla', 1, { relation: 'GUARDIAN', name: 'Guardian', email: 'g-x1@ex.test.eg' });
    await mk('Ali', 2, { relation: 'GUARDIAN', name: 'Guardian', email: 'g-x2@ex.test.eg' });
    await mk('Omar', 3, { relation: 'GUARDIAN', name: 'Guardian', email: 'g-x3@ex.test.eg' });
    await mk('Karim', 4, { relation: 'GUARDIAN', name: 'Guardian', email: 'g-x4@ex.test.eg' });
    await admin.post(`/api/students/${ids.Layla}/guardians`, { relation: 'MOTHER', name: 'Mona', email: 'p201700000001@test.eg', phone: '+201700000001', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${ids.Layla}/guardians`, { relation: 'FATHER', name: 'Amr', email: 'p201700000002@test.eg', phone: '+201700000002', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${ids.Ali}/guardians`, { relation: 'MOTHER', name: 'Rania', email: 'p201700000003@test.eg', phone: '+201700000003', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${ids.Omar}/guardians`, { relation: 'MOTHER', name: 'Nadia', email: 'p201700000004@test.eg', phone: '+201700000004', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${ids.Karim}/guardians`, { relation: 'MOTHER', name: 'Hoda', email: 'p201700000005@test.eg', phone: '+201700000005', password: 'parent-pass' }).expect(201);
    mona = await login(app, 'p201700000001@test.eg', 'parent-pass');
    amr = await login(app, 'p201700000002@test.eg', 'parent-pass');
    rania = await login(app, 'p201700000003@test.eg', 'parent-pass');
    nadia = await login(app, 'p201700000004@test.eg', 'parent-pass');
    hoda = await login(app, 'p201700000005@test.eg', 'parent-pass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('the question', () => {
    it('asks the parents of a child who didn’t come, once, instead of just telling them', async () => {
      await mark(ids.Layla, 'ABSENT');
      await mark(ids.Ali, 'ABSENT');
      await mark(ids.Omar, 'ABSENT');
      const queries = await queriesDuring(app, () => svc().sendAbsenceNotices());
      // Three children, one statement each for the notices and the messages.
      expect(queries.filter((q) => /^INSERT INTO "AbsenceNotice"/.test(q.trim()))).toHaveLength(1);
      expect(queries.filter((q) => /^INSERT INTO "public"\."Notification"/.test(q))).toHaveLength(1);
      expect(await svc().sendAbsenceNotices()).toBe(0);
      for (const c of [mona, amr]) expect(await titles(c)).toContain('attendance.absentCheck: Layla didn’t come to school today');
      const note = (await mona.get('/api/notifications').expect(200)).body.find((n: any) => n.type === 'attendance.absentCheck');
      expect(note.data).toEqual(expect.objectContaining({ studentId: ids.Layla, date: today, check: true }));
      expect((await day(mona, ids.Layla)).check).toEqual(expect.objectContaining({ answer: null, alerted: false }));
    });

    it('does not ask about a child whose parent already sent an excuse for today', async () => {
      await mark(ids.Karim, 'ABSENT');
      await send(hoda, ids.Karim, { fromDate: today, toDate: today, reason: 'SICK' }, PNG).expect(201);
      await svc().sendAbsenceNotices();
      expect(await titles(hoda)).not.toContain('attendance.absentCheck: Karim didn’t come to school today');
    });
  });

  describe('answering', () => {
    it('Yes from either parent stops the clock; nobody is alerted', async () => {
      const res = await mona.post(`/api/parent/children/${ids.Layla}/absence-check`, { date: today, knows: true }).expect(201);
      expect(res.body).toEqual(expect.objectContaining({ answer: 'KNOWS', alerted: false }));
      // The other parent answering later changes nothing: the first reply wins.
      const second = await amr.post(`/api/parent/children/${ids.Layla}/absence-check`, { date: today, knows: false }).expect(201);
      expect(second.body.answer).toBe('KNOWS');
    });

    it('No sets off the urgent alert at once, with the parents’ numbers, and tells the admins', async () => {
      await nadia.post(`/api/parent/children/${ids.Omar}/absence-check`, { date: today, knows: false }).expect(201);
      const open = (await admin.get(`/api/attendance/exceptions?status=OPEN&type=ABSENT_UNKNOWN&date=${today}`).expect(200)).body;
      expect(open).toHaveLength(1);
      expect(open[0].message).toContain('Omar Test');
      expect(open[0].message).toContain('+201700000004');
      expect(await titles(admin)).toContain('attendance.urgentAbsence: URGENT: Omar Test isn’t at school and the parents don’t know where');
    });

    it('no answer within 15 minutes sets it off too, and only once', async () => {
      await excuses().checkAlerts(new Date(Date.now() + (ALERT_AFTER_MINUTES - 5) * MIN));
      expect(await prisma.attendanceException.count({ where: { schoolId, studentId: ids.Ali, type: 'ABSENT_UNKNOWN' } })).toBe(0);
      await excuses().checkAlerts(new Date(Date.now() + (ALERT_AFTER_MINUTES + 1) * MIN));
      await excuses().checkAlerts(new Date(Date.now() + (ALERT_AFTER_MINUTES + 2) * MIN));
      expect(await prisma.attendanceException.count({ where: { schoolId, studentId: ids.Ali, type: 'ABSENT_UNKNOWN' } })).toBe(1);
      // Layla's parents said they know: no alert however long it takes.
      expect(await prisma.attendanceException.count({ where: { schoolId, studentId: ids.Layla, type: 'ABSENT_UNKNOWN' } })).toBe(0);
      const urgent = (await titles(admin)).filter((t: string) => t.includes('Ali Test'));
      expect(urgent).toHaveLength(1);
    });

    it('a late “Yes” after the alert is noted on it, and the alert stays for staff', async () => {
      await rania.post(`/api/parent/children/${ids.Ali}/absence-check`, { date: today, knows: true }).expect(201);
      const e = await prisma.attendanceException.findFirstOrThrow({ where: { schoolId, studentId: ids.Ali, type: 'ABSENT_UNKNOWN' } });
      expect(e.status).toBe('OPEN');
    });

    it('the alert closes by itself when the child turns up, and the parent is told', async () => {
      await prisma.attendanceRecord.deleteMany({ where: { studentId: ids.Omar, date: new Date(`${today}T00:00:00Z`) } });
      await mark(ids.Omar, 'PRESENT');
      await excuses().checkAlerts();
      const e = await prisma.attendanceException.findFirstOrThrow({ where: { schoolId, studentId: ids.Omar, type: 'ABSENT_UNKNOWN' } });
      expect(e.status).toBe('RESOLVED');
      expect(e.note).toContain('arrived');
      expect(await titles(nadia)).toContain('attendance.arrived: Omar has arrived at school');
    });

    it('staff can still resolve an alert with a note', async () => {
      const e = await prisma.attendanceException.findFirstOrThrow({ where: { schoolId, studentId: ids.Ali, type: 'ABSENT_UNKNOWN' } });
      await admin.post(`/api/attendance/exceptions/${e.id}/resolve`, { note: 'Spoke to the mother; he is at the clinic.' }).expect(201);
      expect(await prisma.attendanceException.count({ where: { schoolId, type: 'ABSENT_UNKNOWN', status: 'OPEN' } })).toBe(0);
    });

    it('can’t be answered for a day nobody asked about, or for another family’s child', async () => {
      await mona.post(`/api/parent/children/${ids.Layla}/absence-check`, { date: yesterday, knows: true }).expect(404);
      await mona.post(`/api/parent/children/${ids.Ali}/absence-check`, { date: today, knows: true }).expect(404);
    });
  });

  describe('sending an excuse', () => {
    it('lists nothing for a parent who sent none, and only their own child’s', async () => {
      expect((await rania.get(`/api/parent/children/${ids.Ali}/excuses`).expect(200)).body).toEqual([]);
      await rania.get(`/api/parent/children/${ids.Layla}/excuses`).expect(404);
    });

    it('takes a reason, a note and a photo, and tells the school', async () => {
      const res = await send(mona, ids.Layla, { fromDate: yesterday, toDate: today, reason: 'SICK', note: 'High fever, see doctor’s note.' }, PNG).expect(201);
      expect(res.body).toEqual(expect.objectContaining({ status: 'PENDING', reason: 'SICK', hasFile: true, fileMime: 'image/png' }));
      ids.excuseLayla = res.body.id;
      expect(await titles(admin)).toContain('excuse.submitted: Mona sent an excuse for Layla Test');
      expect((await mona.get(`/api/parent/children/${ids.Layla}/excuses`).expect(200)).body[0].id).toBe(ids.excuseLayla);
      // The other parent sees it too.
      expect((await amr.get(`/api/parent/children/${ids.Layla}/excuses`).expect(200)).body).toHaveLength(1);
    });

    it('the day shows the parent the excuse and its state', async () => {
      expect((await day(mona, ids.Layla)).excuse).toEqual(expect.objectContaining({ status: 'PENDING', reason: 'SICK' }));
    });

    it('refuses a second excuse over the same days while one is waiting', async () => {
      const res = await sendPlain(mona, ids.Layla, { fromDate: today, toDate: today, reason: 'FAMILY' }).expect(400);
      expect(res.body.message).toContain('already sent');
    });

    it('enforces the 7-day window, the 30-day horizon, the order and the reason', async () => {
      const old = (await sendPlain(nadia, ids.Omar, { fromDate: shift(today, -8), toDate: shift(today, -8), reason: 'SICK' }).expect(400)).body.message;
      expect(old).toContain('7 days');
      await sendPlain(nadia, ids.Omar, { fromDate: shift(today, -7), toDate: shift(today, -7), reason: 'SICK' }).expect(201);
      await sendPlain(nadia, ids.Omar, { fromDate: shift(today, 31), toDate: shift(today, 31), reason: 'SICK' }).expect(400);
      await sendPlain(nadia, ids.Omar, { fromDate: shift(today, 20), toDate: shift(today, 19), reason: 'SICK' }).expect(400);
      await sendPlain(nadia, ids.Omar, { fromDate: shift(today, 1), toDate: shift(today, 1), reason: 'HOLIDAY' }).expect(400);
      await sendPlain(nadia, ids.Omar, { fromDate: 'tomorrow', toDate: 'tomorrow', reason: 'SICK' }).expect(400);
    });

    it('takes a planned absence ahead of time', async () => {
      const res = await sendPlain(nadia, ids.Omar, { fromDate: shift(today, 3), toDate: shift(today, 5), reason: 'APPOINTMENT', note: 'Dentist' }).expect(201);
      expect(res.body.status).toBe('PENDING');
    });

    it('refuses an attachment that isn’t a photo or a PDF', async () => {
      const res = await send(rania, ids.Ali, { fromDate: today, toDate: today, reason: 'SICK' }, Buffer.from('not an image at all')).expect(400);
      expect(res.body.message).toContain('photo');
    });

    it('is only for a parent’s own, unrestricted child', async () => {
      await sendPlain(rania, ids.Layla, { fromDate: today, toDate: today, reason: 'SICK' }).expect(404);
      await admin.patch(`/api/students/${ids.Karim}/guardians/${(await prisma.user.findFirstOrThrow({ where: { email: 'p201700000005@test.eg' } })).id}`, { restricted: true }).expect(200);
      await sendPlain(hoda, ids.Karim, { fromDate: shift(today, 2), toDate: shift(today, 2), reason: 'SICK' }).expect(404);
      await admin.patch(`/api/students/${ids.Karim}/guardians/${(await prisma.user.findFirstOrThrow({ where: { email: 'p201700000005@test.eg' } })).id}`, { restricted: false }).expect(200);
    });

    it('is not for staff or strangers', async () => {
      await teacher.form(`/api/parent/children/${ids.Layla}/excuses`, { fromDate: today, toDate: today, reason: 'SICK' }).expect(403);
      await request(app.getHttpServer()).post(`/api/parent/children/${ids.Layla}/excuses`).expect(401);
    });
  });

  describe('the school’s decision', () => {
    it('lists excuses for Student Affairs only, with who sent them, and opens the attachment', async () => {
      const all = (await admin.get('/api/excuses?status=PENDING').expect(200)).body;
      const mine = all.find((e: any) => e.id === ids.excuseLayla);
      expect(mine).toEqual(expect.objectContaining({ hasFile: true, student: expect.objectContaining({ firstName: 'Layla' }), submittedBy: expect.objectContaining({ name: 'Mona' }) }));
      const file = await admin.get(`/api/excuses/${ids.excuseLayla}/file`).expect(200);
      expect(file.headers['content-type']).toContain('image/png');
      await teacher.get('/api/excuses').expect(403);
      await mona.get('/api/excuses').expect(403);
      await admin.get('/api/excuses?status=NOPE').expect(400);
    });

    it('a rejection needs a reason; the absence stays absent and shows as rejected', async () => {
      await mark(ids.Layla, 'ABSENT', yesterday);
      await admin.post(`/api/excuses/${ids.excuseLayla}/decision`, { approve: false }).expect(400);
      const res = await admin.post(`/api/excuses/${ids.excuseLayla}/decision`, { approve: false, note: 'We need a doctor’s note.' }).expect(201);
      expect(res.body.status).toBe('REJECTED');
      expect(await titles(mona)).toContain('excuse.rejected: Layla’s excuse was not accepted');
      const profile = (await admin.get(`/api/students/${ids.Layla}/absences`).expect(200)).body;
      expect(profile.days.find((d: any) => d.date === today)).toEqual(expect.objectContaining({ status: 'REJECTED', absentLessons: 1, excuse: expect.objectContaining({ status: 'REJECTED', decisionNote: 'We need a doctor’s note.' }) }));
      expect((await day(mona, ids.Layla)).excuse).toEqual(expect.objectContaining({ status: 'REJECTED', decisionNote: 'We need a doctor’s note.' }));
      await admin.post(`/api/excuses/${ids.excuseLayla}/decision`, { approve: true }).expect(400); // already decided
    });

    it('after a rejection the parent can send another', async () => {
      const res = await send(mona, ids.Layla, { fromDate: yesterday, toDate: today, reason: 'SICK', note: 'Doctor’s note attached.' }, PNG).expect(201);
      ids.excuseLayla2 = res.body.id;
    });

    it('an approval excuses the absent lessons on those days and tells the parents', async () => {
      const res = await admin.post(`/api/excuses/${ids.excuseLayla2}/decision`, { approve: true, note: 'Get well soon.' }).expect(201);
      expect(res.body.status).toBe('APPROVED');
      const records = await prisma.attendanceRecord.findMany({ where: { studentId: ids.Layla, date: { in: [new Date(`${yesterday}T00:00:00Z`), new Date(`${today}T00:00:00Z`)] } } });
      expect(records.map((r) => r.status)).toEqual(['EXCUSED', 'EXCUSED']);
      expect(records.every((r) => r.excuseId === ids.excuseLayla2)).toBe(true);
      for (const c of [mona, amr]) expect(await titles(c)).toContain('excuse.approved: Layla’s excuse was accepted');
      const summary = (await admin.get(`/api/attendance/summary?date=${today}`).expect(200)).body;
      expect(summary.periods.find((p: any) => p.number === 1).counts.EXCUSED).toBeGreaterThanOrEqual(1);
      const profile = (await admin.get(`/api/students/${ids.Layla}/absences`).expect(200)).body;
      expect(profile.days.filter((d: any) => d.date === today || d.date === yesterday).map((d: any) => d.status)).toEqual(['EXCUSED', 'EXCUSED']);
    });

    it('an absence marked later on an excused day is excused too', async () => {
      await mark(ids.Layla, 'PRESENT'); // changes nothing about the excuse...
      await mark(ids.Layla, 'ABSENT'); // ...and being marked absent again on an excused day stays excused
      expect((await prisma.attendanceRecord.findFirstOrThrow({ where: { studentId: ids.Layla, date: new Date(`${today}T00:00:00Z`) } })).status).toBe('EXCUSED');
    });

    it('the job excuses an absence that is recorded after the approval', async () => {
      await prisma.attendanceRecord.updateMany({ where: { studentId: ids.Layla, date: new Date(`${today}T00:00:00Z`) }, data: { status: 'ABSENT', excuseId: null } });
      await excuses().applyApproved();
      expect((await prisma.attendanceRecord.findFirstOrThrow({ where: { studentId: ids.Layla, date: new Date(`${today}T00:00:00Z`) } })).status).toBe('EXCUSED');
    });

    it('can’t send another excuse over days that are already excused', async () => {
      const res = await sendPlain(mona, ids.Layla, { fromDate: today, toDate: today, reason: 'SICK' }).expect(400);
      expect(res.body.message).toContain('already excused');
    });
  });

  describe('the student’s profile', () => {
    it('lists each absent day with its state: no excuse, pending, rejected, excused', async () => {
      await mark(ids.Ali, 'ABSENT', yesterday);
      await sendPlain(rania, ids.Ali, { fromDate: today, toDate: today, reason: 'FAMILY' }).expect(201);
      const p = (await admin.get(`/api/students/${ids.Ali}/absences`).expect(200)).body;
      const status = Object.fromEntries(p.days.map((d: any) => [d.date, d.status]));
      expect(status).toEqual({ [today]: 'PENDING', [yesterday]: 'NO_EXCUSE' });
      expect(p.totals).toEqual({ days: 2, excused: 0, pending: 1, rejected: 0, noExcuse: 1 });
      expect(p.days[0].lessons).toEqual([expect.objectContaining({ period: 1, status: 'ABSENT' })]);
    });

    it('shows the register where each child’s excuse stands', async () => {
      await mark(ids.Karim, 'ABSENT', today); // Karim's excuse is still waiting
      const roster = (await admin.get(`/api/attendance/classes/${classId}/periods/${periodId}?date=${today}`).expect(200)).body.students;
      const of = (name: string) => roster.find((s: any) => s.name.startsWith(name));
      expect(of('Ali')).toEqual(expect.objectContaining({ status: 'ABSENT', excuse: expect.objectContaining({ status: 'PENDING' }) }));
      expect(of('Layla')).toEqual(expect.objectContaining({ status: 'EXCUSED', excuse: expect.objectContaining({ status: 'APPROVED', reason: 'SICK' }) }));
      expect(of('Omar').excuse).toBeNull(); // present, nothing to excuse
    });

    it('lists excuses for upcoming days', async () => {
      const p = (await admin.get(`/api/students/${ids.Omar}/absences`).expect(200)).body;
      expect(p.upcoming.some((e: any) => e.reason === 'APPOINTMENT')).toBe(true);
    });

    it('is for school-wide staff only', async () => {
      await teacher.get(`/api/students/${ids.Ali}/absences`).expect(403);
      await mona.get(`/api/students/${ids.Layla}/absences`).expect(403);
      await admin.get('/api/students/nobody/absences').expect(404);
    });

    it('is closed when the school’s attendance module is off', async () => {
      await owner.put(`/api/owner/schools/${schoolId}/modules/attendance`, { enabled: false }).expect(200);
      await admin.get('/api/excuses').expect(403);
      await mona.get(`/api/parent/children/${ids.Layla}/excuses`).expect(403);
      await owner.put(`/api/owner/schools/${schoolId}/modules/attendance`, { enabled: true }).expect(200);
    });
  });
});
