import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { Client, login, ownerClient, startApp, kid } from './helpers';
import { AttendanceService } from '../src/attendance/attendance.service';
import { AttendanceEvaluator } from '../src/devices/evaluator';

/**
 * A school that bought the package WITHOUT automatic attendance and live
 * location (no straps, no gateways, no tracking). Everything else must work,
 * and nothing about straps or tracking may leak through any layer.
 */
describe('School without straps or live location (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, teacher: Client, parent: Client;
  let schoolId: string, classId: string, periodId: string, layla: string, ali: string, today: string;
  const MAC = 'DC:0D:30:99:00:01';

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'nostraps');
    // COMPLETE = every module. Straps are a separate subscription, so they must still be off.
    const school = await owner.post('/api/owner/schools', { name: 'Plain School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@plain.eg', password: 'admin-pass' } }).expect(201);
    schoolId = school.body.id;
    admin = await login(app, 'admin@plain.eg', 'admin-pass');
    await admin.patch('/api/school', { schoolDays: [0, 1, 2, 3, 4, 5, 6], absenceNoticeTime: '00:00' }).expect(200);

    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    const t = (await admin.post('/api/staff', { name: 'Hana', role: 'TEACHER', email: 'hana@plain.eg', password: 'teacher-pass' })).body;
    classId = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id })).body.id;
    const room = (await admin.post('/api/rooms', { name: 'Room 204' })).body.id;
    const subject = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    periodId = (await admin.post('/api/periods', { number: 1, startTime: '00:00', endTime: '23:59' })).body.id;
    today = await app.get(AttendanceService).today(schoolId);
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    await admin.put(`/api/grades/${grade.id}/subjects/${subject}`, {}).expect(200); // the year group studies it
    await admin.post('/api/timetable', { classId, dayOfWeek: dow, periodId, roomId: room, subjectId: subject, teacherId: t.id }).expect(201);

    layla = (await admin.post('/api/students', { ...(await kid(admin)), code: 'P1', firstName: 'Layla', lastName: 'Hussein', classId, parent: { relation: 'GUARDIAN', name: 'Guardian', email: 'g-P1@plain.test.eg' } })).body.id;
    ali = (await admin.post('/api/students', { ...(await kid(admin)), code: 'P2', firstName: 'Ali', lastName: 'Ramadan', classId, parent: { relation: 'GUARDIAN', name: 'Guardian', email: 'g-P2@plain.test.eg' } })).body.id;
    await admin.post(`/api/students/${layla}/guardians`, { relation: 'MOTHER', name: 'Nadia', email: 'p201900000001@test.eg', phone: '+201900000001', password: 'parent-pass' }).expect(201);
    teacher = await login(app, 'hana@plain.eg', 'teacher-pass');
    parent = await login(app, 'p201900000001@test.eg', 'parent-pass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('subscription state', () => {
    it.each(['ESSENTIALS', 'SMART', 'COMPLETE'] as const)('%s plan starts with straps off and manual attendance', async (plan) => {
      const res = await owner.post('/api/owner/schools', { name: `P ${plan}`, plan, admin: { name: 'A', email: `a-${plan}@plain.eg`, password: 'admin-pass' } }).expect(201);
      const mods = (await owner.get(`/api/owner/schools/${res.body.id}/modules`).expect(200)).body;
      const att = mods.find((m: any) => m.key === 'attendance');
      expect(att.enabled).toBe(true);
      expect(att.features.automatic).toBeFalsy();
      expect((await prisma.school.findUniqueOrThrow({ where: { id: res.body.id } })).attendanceMode).toBe('MANUAL');
      const me = (await (await login(app, `a-${plan}@plain.eg`, 'admin-pass')).get('/api/auth/me').expect(200)).body;
      expect(me.straps).toBe(false);
    });

    it('lets the school admin NOT switch automatic attendance on, by either route', async () => {
      await admin.patch('/api/modules/attendance/features', { features: { automatic: true } }).expect(403);
      await admin.patch('/api/school', { attendanceMode: 'AUTOMATIC' }).expect(400);
      expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).attendanceMode).toBe('MANUAL');
    });

    it('does not let a teacher or parent try either', async () => {
      await teacher.patch('/api/modules/attendance/features', { features: { automatic: true } }).expect(403);
      await parent.patch('/api/modules/attendance/features', { features: { automatic: true } }).expect(403);
    });
  });

  describe('live location is closed', () => {
    it('refuses the staff location map and a student’s day of visits', async () => {
      await admin.get('/api/locations').expect(403);
      await admin.get(`/api/locations/students/${layla}?date=${today}`).expect(403);
      await teacher.get('/api/locations').expect(403);
    });

    it('shows a parent no place for the child, even after consent and with leaked strap data', async () => {
      await parent.post('/api/parent/consent').expect(201);
      // Simulate stray data (e.g. left over from a trial): a strap with a fresh sighting.
      const gw = await prisma.gateway.create({ data: { serial: 'STRAY-1', claimCode: 'STRAYCODE1', secretHash: 'x', schoolId, kind: 'ROOM', name: 'Stray' } });
      const strap = await prisma.strap.create({ data: { schoolId, mac: 'DC:0D:30:99:00:77', studentId: layla } });
      await prisma.sighting.create({ data: { schoolId, gatewayId: gw.id, strapId: strap.id, rssi: -50, seenAt: new Date() } });
      const day = (await parent.get(`/api/parent/children/${layla}/today?date=${today}`).expect(200)).body;
      expect(day.place).toBeNull();
      await prisma.sighting.deleteMany({ where: { strapId: strap.id } });
      await prisma.strap.delete({ where: { id: strap.id } });
      await prisma.gateway.delete({ where: { id: gw.id } });
    });
  });

  describe('manual attendance still works', () => {
    it('teacher marks without a reason and the parent sees it', async () => {
      const roster = await teacher.get(`/api/attendance/classes/${classId}/periods/${periodId}?date=${today}`).expect(200);
      expect(roster.body.mode).toBe('MANUAL');
      await teacher
        .put(`/api/attendance/classes/${classId}/periods/${periodId}`, { date: today, marks: [{ studentId: layla, status: 'PRESENT' }, { studentId: ali, status: 'ABSENT' }] })
        .expect(200);
      const day = (await parent.get(`/api/parent/children/${layla}/today?date=${today}`).expect(200)).body;
      expect(day.lessons[0].status).toBe('PRESENT');
      const summary = (await admin.get(`/api/attendance/summary?date=${today}`).expect(200)).body;
      expect(summary.periods[0].counts).toEqual(expect.objectContaining({ PRESENT: 1, ABSENT: 1 }));
    });

    it('the evaluator never touches this school', async () => {
      const before = await prisma.attendanceRecord.count({ where: { student: { schoolId } } });
      await app.get(AttendanceEvaluator).tick(new Date());
      expect(await prisma.attendanceRecord.count({ where: { student: { schoolId } } })).toBe(before);
      expect(await prisma.attendanceRecord.count({ where: { student: { schoolId }, source: 'AUTOMATIC' } })).toBe(0);
    });
  });

  describe('device management is not usable without the subscription', () => {
    it('admin cannot register straps', async () => {
      await admin.post('/api/devices/straps', { mac: MAC, studentId: ali }).expect(403);
      expect(await prisma.strap.count({ where: { schoolId } })).toBe(0);
    });

    it('admin cannot claim a gateway', async () => {
      const g = (await owner.post('/api/owner/gateways', { serial: 'PLAIN-GATE' }).expect(201)).body;
      await admin.post('/api/devices/gateways/claim', { claimCode: g.claimCode, name: 'Gate', kind: 'GATE' }).expect(403);
    });

    it('admin cannot change or even read detection rules, gateways and straps', async () => {
      await admin.put('/api/devices/rules', { rules: {} }).expect(403);
      await admin.get('/api/devices/rules').expect(403);
      await admin.get('/api/devices/gateways').expect(403);
      await admin.get('/api/devices/straps').expect(403);
      await teacher.get('/api/devices/gateways').expect(403);
      await teacher.get('/api/devices/straps').expect(403);
    });
  });

  describe('the Excel import', () => {
    const sheet = async (strap?: string) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Students');
      ws.columns = [{ header: 'Student code' }, { header: 'First name' }, { header: 'Last name' }, { header: 'Class' }, { header: 'Mother name' }, { header: 'Mother email' }, { header: 'Strap' }];
      ws.addRow(['IMP-1', 'Imported', 'Kid', '4-A', 'Nadia Kid', 'imp.mother@plain.test.eg', strap ?? '']);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };

    it('has no Strap column in the template', async () => {
      const res = await admin.get('/api/students/import/template').buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect((wb.worksheets[0].getRow(1).values as string[]).filter(Boolean)).not.toContain('Strap');
    });

    it('refuses a strap in a row, and imports the same row without one', async () => {
      const bad = await admin.upload('/api/students/import', {}, await sheet('DC:0D:30:99:00:55'), 's.xlsx').expect(201);
      expect(bad.body.imported).toBe(false);
      expect(bad.body.errors.map((e: any) => e.message).join(' ')).toContain('subscription');
      const ok = await admin.upload('/api/students/import', {}, await sheet(), 's.xlsx').expect(201);
      expect(ok.body).toEqual(expect.objectContaining({ imported: true, create: 1, straps: 0 }));
      expect(await prisma.strap.count({ where: { schoolId } })).toBe(0);
    });
  });

  describe('login is slowed down for someone guessing', () => {
    it('answers 429 after ten wrong passwords for one account from one address', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) codes.push((await request(app.getHttpServer()).post('/api/auth/login').send({ login: 'guess@plain.test.eg', password: `wrong-${i}` })).status);
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes[10]).toBe(429);
    });
  });

  describe('a gateway that reaches the API anyway does nothing', () => {
    it('stores no readings, no arrival, no automatic record and sends no “arrived” message', async () => {
      const g = (await owner.post('/api/owner/gateways', { serial: 'PLAIN-GATE2' }).expect(201)).body;
      const gw = await prisma.gateway.update({ where: { serial: 'PLAIN-GATE2' }, data: { schoolId, kind: 'GATE', name: 'Gate' } });
      await prisma.strap.deleteMany({ where: { studentId: ali } });
      const strap = await prisma.strap.create({ data: { schoolId, mac: MAC.replace('01', '02'), studentId: ali } });
      const notesBefore = await prisma.notification.count({ where: { schoolId } });
      await request(app.getHttpServer()).post('/api/gateway/sightings').auth(g.serial, g.secret).send({ sightings: [{ mac: strap.mac, rssi: -50, at: Date.now() }] }).expect(200);
      expect(await prisma.sighting.count({ where: { schoolId } })).toBe(0);
      expect(await prisma.gatePresence.count({ where: { studentId: ali } })).toBe(0);
      expect(await prisma.notification.count({ where: { schoolId } })).toBe(notesBefore);
      expect(gw.id).toBeTruthy();
    });
  });

  describe('buying it later, and stopping', () => {
    it('owner switches it on: map and devices open; off: they close and open follow-ups are closed', async () => {
      await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
      await admin.get('/api/locations').expect(200);
      await admin.get('/api/devices/gateways').expect(200);
      await prisma.attendanceException.create({ data: { schoolId, type: 'GATEWAY_OFFLINE', date: new Date(`${today}T00:00:00Z`), message: 'test', dedupeKey: 'test-offline' } });
      await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: false } }).expect(200);
      await admin.get('/api/locations').expect(403);
      await admin.get('/api/devices/gateways').expect(403);
      expect(await prisma.attendanceException.count({ where: { schoolId, status: 'OPEN' } })).toBe(0);
      expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).attendanceMode).toBe('MANUAL');
    });
  });
});
