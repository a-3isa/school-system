process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://school:school@localhost:5432/school_test';
process.env.JWT_SECRET = 'test-secret';
process.env.DISABLE_JOBS = '1';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { KID, kid, PNG } from './helpers';

describe('Phase 1 core (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let http: ReturnType<typeof request>;

  const login = async (loginId: string, password: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ login: loginId, password }).expect(201);
    return res.body.token as string;
  };
  const as = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body?: object) => request(app.getHttpServer()).put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body?: object) => request(app.getHttpServer()).patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', `Bearer ${token}`),
    upload: (url: string, fields: Record<string, string>, file: Buffer, name = 'file.png') => {
      let r = request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file, name);
    },
  });

  let owner: ReturnType<typeof as>;
  let admin: ReturnType<typeof as>;
  let schoolId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    await prisma.user.create({
      data: { email: 'owner@test.eg', name: 'Owner', role: Role.OWNER, passwordHash: await bcrypt.hash('owner-pass', 10) },
    });
    owner = as(await login('owner@test.eg', 'owner-pass'));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects requests without a login', async () => {
    await http.get('/api/students').expect(401);
  });

  it('lets the owner create a school on a plan', async () => {
    const res = await owner
      .post('/api/owner/schools', { name: 'Nile Valley School', plan: 'ESSENTIALS', admin: { name: 'Samia Adel', email: 'Admin@NV.eg', password: 'admin-pass' } })
      .expect(201);
    schoolId = res.body.id;
    const on = res.body.modules.filter((m: any) => m.enabled).map((m: any) => m.key);
    expect(on.sort()).toEqual(['attendance', 'core', 'messaging']);
    admin = as(await login('admin@nv.eg', 'admin-pass'));
  });

  it('switches built modules on and off, and refuses the ones that are not built yet', async () => {
    const off = await owner.put(`/api/owner/schools/${schoolId}/modules/behavior`, { enabled: false }).expect(200);
    expect(off.body.modules.find((m: any) => m.key === 'behavior').enabled).toBe(false);
    const on = await owner.put(`/api/owner/schools/${schoolId}/modules/behavior`, { enabled: true }).expect(200);
    expect(on.body.alsoEnabled).toEqual([]);
    expect(on.body.modules.find((m: any) => m.key === 'behavior').enabled).toBe(true);
    const canteen = await owner.put(`/api/owner/schools/${schoolId}/modules/canteen`, { enabled: true }).expect(400);
    expect(canteen.body.message).toBe('Canteen & wallet isn’t available yet.');
    await owner.put(`/api/owner/schools/${schoolId}/modules/core`, { enabled: false }).expect(400);
  });

  it('keeps module switching away from school admins', async () => {
    await admin.put(`/api/owner/schools/${schoolId}/modules/transport`, { enabled: true }).expect(403);
    const me = await admin.get('/api/auth/me').expect(200);
    expect(me.body.modules).toContain('attendance');
  });

  it('allows automatic attendance only when the feature is on', async () => {
    await admin.patch('/api/school', { attendanceMode: 'AUTOMATIC' }).expect(400);
    // Automatic attendance (straps) comes with the subscription: the owner switches it on, not the school.
    await admin.patch('/api/modules/attendance/features', { features: { automatic: true } }).expect(403);
    expect((await admin.get('/api/auth/me').expect(200)).body.straps).toBe(false);
    await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
    const me = (await admin.get('/api/auth/me').expect(200)).body;
    expect(me.straps).toBe(true);
    expect(me.attendanceMode).toBe('AUTOMATIC'); // the subscription sets it
    await admin.patch('/api/modules/attendance/features', { features: { flying: true } }).expect(400);
  });

  let classId: string, roomId: string, room2Id: string, subjectId: string, period1: string, teacherId: string;

  it('sets up grades, classes, rooms, subjects and periods', async () => {
    const grade = await admin.post('/api/grades', { name: 'Grade 4', order: 4 }).expect(201);
    const teacher = await admin.post('/api/staff', { name: 'Hana Nabil', role: 'TEACHER', email: 'hana@nv.eg', password: 'teacher-pass' }).expect(201);
    teacherId = teacher.body.id;
    const cls = await admin.post('/api/classes', { name: '4-A', gradeId: grade.body.id, homeroomTeacherId: teacherId }).expect(201);
    classId = cls.body.id;
    await admin.post('/api/classes', { name: '4-A', gradeId: grade.body.id }).expect(409);
    roomId = (await admin.post('/api/rooms', { name: 'Room 204' }).expect(201)).body.id;
    room2Id = (await admin.post('/api/rooms', { name: 'Lab 1', kind: 'LAB' }).expect(201)).body.id;
    subjectId = (await admin.post('/api/subjects', { name: 'Math' }).expect(201)).body.id;
    await admin.put(`/api/grades/${grade.body.id}/subjects/${subjectId}`, {}).expect(200); // the year group studies it
    period1 = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' }).expect(201)).body.id;
    const overlap = await admin.post('/api/periods', { number: 2, startTime: '08:30', endTime: '09:15' }).expect(400);
    expect(overlap.body.message).toContain('Overlaps period 1');
    await admin.post('/api/periods', { number: 2, startTime: '08:45', endTime: '09:30' }).expect(201);
    await admin.post('/api/periods', { number: 3, startTime: '9:00', endTime: '09:45' }).expect(400);
  });

  it('builds a timetable and explains clashes', async () => {
    // Wednesday = 3
    await admin.post('/api/timetable', { classId, dayOfWeek: 3, periodId: period1, roomId, subjectId, teacherId }).expect(201);
    const clash = await admin.post('/api/timetable', { classId, dayOfWeek: 3, periodId: period1, roomId: room2Id, subjectId, teacherId }).expect(409);
    expect(clash.body.message).toBe('4-A already has Math in period 1.');
    await admin.post('/api/timetable', { classId, dayOfWeek: 5, periodId: period1, roomId, subjectId, teacherId }).expect(400); // Friday
    expect(await admin.post('/api/timetable', { classId, dayOfWeek: 2, periodId: period1, roomId, subjectId }).expect(201)).toBeDefined(); // the subject already has its teacher, so the lesson takes it
  });

  it('finds the lesson happening in a room right now', async () => {
    // 08:10 in Cairo on Wednesday 30 Sep 2026.
    const res = await admin.get(`/api/timetable/now?roomId=${roomId}&at=2026-09-30T05:10:00Z`).expect(200);
    expect(res.body.period.number).toBe(1);
    expect(res.body.lesson.class.name).toBe('4-A');
    const between = await admin.get(`/api/timetable/now?roomId=${roomId}&at=2026-09-30T04:00:00Z`).expect(200);
    expect(between.body.lesson).toBeNull();
  });

  let laylaId: string;
  let omarFile: [string, string];

  it('manages students, who always have a parent or guardian', async () => {
    const nadia = { relation: 'MOTHER', name: 'Nadia Hussein', email: 'p201000000001@test.eg', phone: '+201000000001', password: 'parent-pass' };
    await admin.post('/api/students', { ...(await kid(admin)), code: '2019-0412', firstName: 'Layla', lastName: 'Hussein', classId }).expect(400); // no parent
    const layla = await admin.post('/api/students', { ...(await kid(admin)), code: '2019-0412', firstName: 'Layla', lastName: 'Hussein', classId, parent: nadia }).expect(201);
    laylaId = layla.body.id;
    expect(layla.body.guardians).toEqual([expect.objectContaining({ relation: 'MOTHER', user: expect.objectContaining({ name: 'Nadia Hussein' }) })]);
    await admin.post('/api/students', { ...(await kid(admin)), code: '2019-0412', firstName: 'X', lastName: 'Y', parent: { relation: 'MOTHER', name: 'X', email: 'x@test.eg' } }).expect(409);
    expect(await prisma.user.findUnique({ where: { email: 'x@test.eg' } })).toBeNull(); // nothing left behind
    await admin.post(`/api/students/${laylaId}/guardians`, { relation: 'MOTHER', name: 'Other', email: 'p201000000009@test.eg', phone: '+201000000009' }).expect(400);
    const both = await admin.post(`/api/students/${laylaId}/guardians`, { relation: 'FATHER', name: 'Ibrahim Hussein', email: 'p201000000002@test.eg', phone: '+201000000002' }).expect(201);
    expect(both.body.guardians).toHaveLength(2);
    // A grandmother looks after her too; one guardian at most.
    const three = await admin.post(`/api/students/${laylaId}/guardians`, { relation: 'GUARDIAN', name: 'Samira Hussein', email: 'samira@test.eg' }).expect(201);
    expect(three.body.guardians).toHaveLength(3);
    await admin.post(`/api/students/${laylaId}/guardians`, { relation: 'GUARDIAN', name: 'Uncle', email: 'uncle@test.eg' }).expect(400);
    const samiraId = three.body.guardians.find((g: any) => g.relation === 'GUARDIAN').userId;
    await admin.delete(`/api/students/${laylaId}/guardians/${samiraId}`).expect(200);

    // A sibling reuses the mother's existing account.
    const karim = await admin.post('/api/students', { ...(await kid(admin)), code: '2022-0133', firstName: 'Karim', lastName: 'Hussein', parent: { ...nadia, password: undefined } }).expect(201);
    // The only parent can't be removed.
    const res = await admin.delete(`/api/students/${karim.body.id}/guardians/${karim.body.guardians[0].userId}`).expect(400);
    expect(res.body.message).toContain('at least one parent or guardian');

    // The parent's page: their children, each with its class.
    const nadiaId = karim.body.guardians[0].userId;
    const page = await admin.get(`/api/parents/${nadiaId}`).expect(200);
    expect(page.body).toEqual(expect.objectContaining({ name: 'Nadia Hussein', email: 'p201000000001@test.eg' }));
    expect(page.body.children.map((c: any) => c.student.firstName).sort()).toEqual(['Karim', 'Layla']);
    expect(page.body.children.find((c: any) => c.student.firstName === 'Layla').student.class).toEqual({ id: classId, name: '4-A' });
    const found = await admin.get('/api/parents?q=karim').expect(200);
    expect(found.body.map((p: any) => p.name)).toEqual(['Nadia Hussein']);
    // The class page: its students, each with their parents.
    const cls = await admin.get(`/api/classes/${classId}`).expect(200);
    expect(cls.body.students.map((st: any) => st.firstName)).toEqual(['Layla']);
    expect(cls.body.students[0].guardians.map((g: any) => g.relation).sort()).toEqual(['FATHER', 'MOTHER']);

    const parent = as(await login('p201000000001@test.eg', 'parent-pass'));
    expect((await parent.get('/api/auth/me').expect(200)).body.consentAt).toBeNull();
    await parent.post('/api/parent/consent').expect(201);
    expect((await parent.get('/api/auth/me').expect(200)).body.consentAt).not.toBeNull();
    const kids = await parent.get('/api/parent/children').expect(200);
    expect(kids.body.map((k: any) => k.firstName).sort()).toEqual(['Karim', 'Layla']);
    await parent.get('/api/students').expect(403);
    await parent.get('/api/timetable').expect(403);
    await parent.get('/api/classes').expect(403);
    await parent.get('/api/parents').expect(403);
    await parent.get(`/api/parents/${nadiaId}`).expect(403);

    // The school restricts Layla for this parent.
    await admin.patch(`/api/students/${laylaId}/guardians/${nadiaId}`, { restricted: true }).expect(200);
    const after = await parent.get('/api/parent/children').expect(200);
    expect(after.body.map((k: any) => k.firstName)).toEqual(['Karim']);
  });

  it('records who a new student is, and checks the national number', async () => {
    const base = { firstName: 'Omar', lastName: 'Saeed', classId, gender: 'MALE', nationality: 'EG', parent: { relation: 'FATHER', name: 'Saeed Ali', email: 'saeed@test.eg' }, files: [] as string[] };
    // An Egyptian student needs a national number, and it must agree with the date of birth and gender.
    const missing = await admin.post('/api/students', { ...base, code: 'E-1', dateOfBirth: '2017-03-15' }).expect(400);
    expect(missing.body.message).toContain('national number');
    const wrongDay = await admin.post('/api/students', { ...base, code: 'E-1', dateOfBirth: '2017-03-16', nationalId: '31703150101234' }).expect(400);
    expect(wrongDay.body.message).toContain('born on 2017-03-15');
    const wrongGender = await admin.post('/api/students', { ...base, code: 'E-1', gender: 'FEMALE', dateOfBirth: '2017-03-15', nationalId: '31703150101234' }).expect(400);
    expect(wrongGender.body.message).toContain('boy');
    await admin.post('/api/students', { ...base, code: 'E-1', dateOfBirth: '2017-03-15', nationalId: '3170315' }).expect(400);
    await admin.post('/api/students', { ...base, code: 'E-1', dateOfBirth: '2030-01-01', nationalId: '33001010101234' }).expect(400); // not born yet

    // The photo and birth certificate are uploaded first, checked by their content, and required.
    const up = (kind: string, file: Buffer, name?: string) => admin.upload('/api/students/files', { kind }, file, name);
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
    expect((await up('PHOTO', pdf, 'photo.pdf').expect(400)).body.message).toContain('must be an image');
    expect((await up('BIRTH_CERTIFICATE', Buffer.from('hello'), 'cert.png').expect(400)).body.message).toContain('JPG');
    await up('DIPLOMA', PNG).expect(400);
    await up('PHOTO', Buffer.alloc(6 * 1024 * 1024, 0xff)).expect(413);
    const photo = (await up('PHOTO', PNG).expect(201)).body;
    expect(photo).toEqual(expect.objectContaining({ kind: 'PHOTO', mime: 'image/png' }));
    const noCert = await admin.post('/api/students', { ...base, code: 'E-1', dateOfBirth: '2017-03-15', nationalId: '31703150101234', files: [photo.id] }).expect(400);
    expect(noCert.body.message).toBe('Add the birth certificate.');
    const cert = (await up('BIRTH_CERTIFICATE', pdf, 'cert.pdf').expect(201)).body;
    const vaccines = (await up('VACCINATION_RECORD', PNG).expect(201)).body;

    // Everything the office records, with both parents at once.
    const omar = await admin.post('/api/students', {
      ...base, code: 'E-1', dateOfBirth: '2017-03-15', nationalId: '31703150101234', nameAr: 'عمر سعيد علي حسن',
      religion: 'MUSLIM', placeOfBirth: 'Cairo', address: '12 Nile St, Maadi', previousSchool: 'Sunrise School',
      bloodType: 'O+', allergies: 'Peanuts', emergencyName: 'Hoda Ali', emergencyRelation: 'Aunt', emergencyPhone: '+201011112222',
      files: [photo.id, cert.id, vaccines.id],
      moreParents: [{ relation: 'MOTHER', name: 'Mona Saeed', email: 'mona.saeed@test.eg' }],
    }).expect(201);
    expect(omar.body).toEqual(expect.objectContaining({
      nationalId: '31703150101234', gender: 'MALE', nationality: 'EG', religion: 'MUSLIM', bloodType: 'O+', allergies: 'Peanuts',
      emergencyPhone: '+201011112222', enrolledOn: expect.any(String),
    }));
    expect(omar.body.dateOfBirth.slice(0, 10)).toBe('2017-03-15');
    expect(omar.body.guardians.map((g: any) => g.relation)).toEqual(['MOTHER', 'FATHER']);
    expect(omar.body.files.map((f: any) => f.kind)).toEqual(['PHOTO', 'BIRTH_CERTIFICATE', 'VACCINATION_RECORD']);
    expect(omar.body.files[0].data).toBeUndefined(); // the bytes only come from the file's own address
    // An upload can be used once.
    await admin.post('/api/students', { ...base, code: 'E-9', dateOfBirth: '2017-03-15', nationalId: '31703150101279', files: [photo.id, cert.id] }).expect(400);
    // Staff see the scan; it comes back as it went in.
    const seen = await admin.get(`/api/students/${omar.body.id}/files/${cert.id}`).expect(200);
    expect(seen.headers['content-type']).toBe('application/pdf');
    expect(seen.headers['x-content-type-options']).toBe('nosniff');
    // A required paper can't be removed without a replacement; an optional one can.
    await admin.delete(`/api/students/${omar.body.id}/files/${photo.id}`).expect(400);
    const newPhoto = (await admin.upload(`/api/students/${omar.body.id}/files`, { kind: 'PHOTO' }, PNG).expect(201)).body;
    // Other staff see the photo, not the papers.
    await admin.post('/api/staff', { name: 'Nadia Nurse', role: 'NURSE', email: 'nurse@nv.eg', password: 'nurse-pass-1' }).expect(201);
    const nurse = as(await login('nurse@nv.eg', 'nurse-pass-1'));
    await nurse.get(`/api/students/${omar.body.id}/files/${newPhoto.id}`).expect(200);
    await nurse.get(`/api/students/${omar.body.id}/files/${vaccines.id}`).expect(200);
    await nurse.get(`/api/students/${omar.body.id}/files/${cert.id}`).expect(403);
    await nurse.upload(`/api/students/${omar.body.id}/files`, { kind: 'OTHER' }, PNG).expect(403);
    await admin.delete(`/api/students/${omar.body.id}/files/${photo.id}`).expect(200);
    await admin.delete(`/api/students/${omar.body.id}/files/${vaccines.id}`).expect(200);

    // Two students can't share a national number; a failed add leaves no parent behind.
    const twin = await admin.post('/api/students', { ...base, ...(await kid(admin)), nationality: 'EG', gender: 'MALE', code: 'E-2', dateOfBirth: '2017-03-15', nationalId: '31703150101234', parent: { relation: 'FATHER', name: 'X', email: 'x2@test.eg' } }).expect(409);
    expect(twin.body.message).toContain('E-1');
    expect(await prisma.user.findUnique({ where: { email: 'x2@test.eg' } })).toBeNull();
    // The same parent twice is refused.
    await admin.post('/api/students', { ...base, ...(await kid(admin)), nationality: 'EG', gender: 'MALE', code: 'E-3', dateOfBirth: '2017-03-15', nationalId: '31703150101250', moreParents: [{ relation: 'GUARDIAN', name: 'Saeed Ali', email: 'saeed@test.eg' }] }).expect(400);

    // Edits are checked the same way; blank text clears a field.
    await admin.patch(`/api/students/${omar.body.id}`, { dateOfBirth: '2016-03-15' }).expect(400);
    const edited = await admin.patch(`/api/students/${omar.body.id}`, { allergies: '', bloodType: 'A+' }).expect(200);
    expect(edited.body).toEqual(expect.objectContaining({ allergies: null, bloodType: 'A+' }));
    omarFile = [omar.body.id, cert.id];
  });

  it('keeps each school’s data separate', async () => {
    await owner.post('/api/owner/schools', { name: 'Other School', plan: 'SMART', admin: { name: 'B', email: 'b@other.eg', password: 'other-pass' } }).expect(201);
    const other = as(await login('b@other.eg', 'other-pass'));
    await other.get(`/api/students/${laylaId}`).expect(404);
    await other.get(`/api/classes/${classId}`).expect(404);
    await other.get(`/api/students/${omarFile[0]}/files/${omarFile[1]}`).expect(404);
    expect((await other.get('/api/parents').expect(200)).body).toEqual([]);
    expect((await other.get('/api/students').expect(200)).body).toEqual([]);
    await other.post('/api/timetable', { classId, dayOfWeek: 0, periodId: period1, roomId, subjectId, teacherId }).expect(400);
  });

  it('limits writes by role and records an audit trail', async () => {
    const teacher = as(await login('hana@nv.eg', 'teacher-pass'));
    await teacher.post('/api/students', { ...KID, code: 'T-1', firstName: 'A', lastName: 'B' }).expect(403);
    // A teacher sees only their own lessons, not the whole school.
    await teacher.get('/api/students').expect(403);
    await teacher.get('/api/locations').expect(403);
    await teacher.get('/api/attendance/summary?date=2026-09-30').expect(403);
    const mine = await teacher.get('/api/timetable').expect(200);
    const me = (await teacher.get('/api/auth/me').expect(200)).body;
    expect(mine.body.every((e: any) => e.teacher?.id === me.id)).toBe(true);
    const audit = await admin.get('/api/audit').expect(200);
    const actions = audit.body.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['student.create', 'guardian.add', 'timetable.create', 'module.features']));
  });

  it('compresses replies for clients that accept it', async () => {
    const res = await admin.get('/api/audit').set('Accept-Encoding', 'gzip').expect(200);
    expect(JSON.stringify(res.body).length).toBeGreaterThan(1024); // big enough to be worth it
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body.length).toBeGreaterThan(0); // and still reads as before
  });

  it('validates input', async () => {
    const res = await admin.post('/api/students', { ...(await kid(admin)), code: 'X', firstName: 'A', lastName: 'B', hacker: true }).expect(400);
    expect(JSON.stringify(res.body.message)).toContain('hacker');
  });
});
