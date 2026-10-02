import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, login, ownerClient, startApp, KID, kid } from './helpers';
import { AttendanceService } from '../src/attendance/attendance.service';

describe('Manual attendance (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, teacher: Client, other: Client, parent: Client;
  let schoolId: string, classId: string, class2Id: string, p1: string, p2: string, roomId: string, subjectId: string;
  let laylaId: string, aliId: string, omarId: string, sherifId: string;
  let today: string, yesterday: string, tomorrow: string;

  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'att');
    const school = await owner
      .post('/api/owner/schools', { name: 'Attendance School', plan: 'ESSENTIALS', admin: { name: 'Admin', email: 'admin@att.eg', password: 'admin-pass' } })
      .expect(201);
    schoolId = school.body.id;
    admin = await login(app, 'admin@att.eg', 'admin-pass');
    // Every weekday is a school day so the tests pass whatever day they run.
    await admin.patch('/api/school', { schoolDays: [0, 1, 2, 3, 4, 5, 6], absenceNoticeTime: '00:00' }).expect(200);

    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    const t = (await admin.post('/api/staff', { name: 'Hana', role: 'TEACHER', email: 'hana@att.eg', password: 'teacher-pass' })).body;
    sherifId = (await admin.post('/api/staff', { name: 'Sherif', role: 'TEACHER', email: 'sherif@att.eg', password: 'teacher-pass' }).expect(201)).body.id;
    classId = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id })).body.id;
    class2Id = (await admin.post('/api/classes', { name: '4-B', gradeId: grade.id })).body.id;
    roomId = (await admin.post('/api/rooms', { name: 'Room 204' })).body.id;
    subjectId = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    p1 = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' })).body.id;
    p2 = (await admin.post('/api/periods', { number: 2, startTime: '08:45', endTime: '09:30' })).body.id;

    const svc = app.get(AttendanceService);
    today = await svc.today(schoolId);
    yesterday = shift(today, -1);
    tomorrow = shift(today, 1);
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    await admin.post('/api/timetable', { classId, dayOfWeek: dow, periodId: p1, roomId, subjectId, teacherId: t.id }).expect(201);
    await admin.post('/api/timetable', { classId, dayOfWeek: (dow + 6) % 7, periodId: p1, roomId, subjectId, teacherId: t.id }).expect(201);

    laylaId = (await admin.post('/api/students', { ...(await kid(admin)), code: 'S1', firstName: 'Layla', lastName: 'Hussein', classId, parent: { relation: 'GUARDIAN', name: 'Guardian', email: `g-S1@at.test.eg` } })).body.id;
    aliId = (await admin.post('/api/students', { ...(await kid(admin)), code: 'S2', firstName: 'Ali', lastName: 'Ramadan', classId, parent: { relation: 'GUARDIAN', name: 'Guardian', email: `g-S2@at.test.eg` } })).body.id;
    omarId = (await admin.post('/api/students', { ...(await kid(admin)), code: 'S3', firstName: 'Omar', lastName: 'Kamal', classId: class2Id, parent: { relation: 'GUARDIAN', name: 'Guardian', email: `g-S3@at.test.eg` } })).body.id;
    await admin.post(`/api/students/${aliId}/guardians`, { relation: 'MOTHER', name: 'Rania', email: 'p201100000001@test.eg', phone: '+201100000001', password: 'parent-pass' }).expect(201);
    await admin.post(`/api/students/${laylaId}/guardians`, { relation: 'MOTHER', name: 'Nadia', email: 'p201100000002@test.eg', phone: '+201100000002', password: 'parent-pass' }).expect(201);

    teacher = await login(app, 'hana@att.eg', 'teacher-pass');
    other = await login(app, 'sherif@att.eg', 'teacher-pass');
    parent = await login(app, 'p201100000001@test.eg', 'parent-pass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('lists a teacher’s lessons for today', async () => {
    const res = await teacher.get(`/api/attendance/my-lessons?date=${today}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual(expect.objectContaining({ className: '4-A', period: 1, students: 2, marked: 0 }));
  });

  it('lets the class’s teacher mark today and nobody else', async () => {
    const roster = await teacher.get(`/api/attendance/classes/${classId}/periods/${p1}?date=${today}`).expect(200);
    expect(roster.body.canEdit).toBe(true);
    expect(roster.body.students.map((s: any) => s.name)).toEqual(['Layla Hussein', 'Ali Ramadan']);

    const res = await teacher
      .put(`/api/attendance/classes/${classId}/periods/${p1}`, { date: today, marks: [{ studentId: laylaId, status: 'PRESENT' }, { studentId: aliId, status: 'ABSENT' }] })
      .expect(200);
    expect(res.body.students.find((s: any) => s.id === aliId)).toEqual(expect.objectContaining({ status: 'ABSENT', source: 'MANUAL', markedBy: 'Hana' }));

    await other.get(`/api/attendance/classes/${classId}/periods/${p1}?date=${today}`).expect(403);
    await other.put(`/api/attendance/classes/${classId}/periods/${p1}`, { date: today, marks: [{ studentId: laylaId, status: 'ABSENT' }] }).expect(403);
  });

  it('rejects students from another class and future days', async () => {
    await teacher.put(`/api/attendance/classes/${classId}/periods/${p1}`, { date: today, marks: [{ studentId: omarId, status: 'PRESENT' }] }).expect(400);
    await admin.put(`/api/attendance/classes/${classId}/periods/${p1}`, { date: tomorrow, marks: [{ studentId: laylaId, status: 'PRESENT' }] }).expect(403);
  });

  it('leaves past days to admins', async () => {
    const view = await teacher.get(`/api/attendance/classes/${classId}/periods/${p1}?date=${yesterday}`).expect(200);
    expect(view.body.canEdit).toBe(false);
    await teacher.put(`/api/attendance/classes/${classId}/periods/${p1}`, { date: yesterday, marks: [{ studentId: laylaId, status: 'PRESENT' }] }).expect(403);
    await admin.put(`/api/attendance/classes/${classId}/periods/${p1}`, { date: yesterday, marks: [{ studentId: laylaId, status: 'LATE', reason: 'Traffic' }] }).expect(200);
  });

  it('sends one absence notice to the parent of an absent child', async () => {
    const svc = app.get(AttendanceService);
    // The job covers every school; other test files may have absent children too.
    const ours = () => prisma.absenceNotice.count({ where: { student: { schoolId } } });
    await svc.sendAbsenceNotices();
    expect(await ours()).toBe(1);
    expect(await svc.sendAbsenceNotices()).toBe(0); // not twice
    expect(await ours()).toBe(1);
    const notes = await parent.get('/api/notifications').expect(200);
    expect(notes.body[0]).toEqual(expect.objectContaining({ type: 'attendance.absent', title: 'Ali is absent today' }));
    await parent.post(`/api/notifications/${notes.body[0].id}/read`).expect(201);
  });

  it('shows a parent their own child’s day only', async () => {
    const day = await parent.get(`/api/parent/children/${aliId}/attendance?date=${today}`).expect(200);
    expect(day.body).toEqual([expect.objectContaining({ period: 1, subject: 'Math', status: 'ABSENT' })]);
    await parent.get(`/api/parent/children/${laylaId}/attendance?date=${today}`).expect(404);
  });

  it('gives a parent the whole day, lessons to come included', async () => {
    const day = await parent.get(`/api/parent/children/${aliId}/today?date=${today}`).expect(200);
    expect(day.body).toEqual(expect.objectContaining({ date: today, arrivedAt: null, place: null }));
    expect(day.body.lessons).toContainEqual(expect.objectContaining({ period: 1, subject: 'Math', status: 'ABSENT' }));
    await parent.get(`/api/parent/children/${laylaId}/today?date=${today}`).expect(404);
  });

  it('marks a class away so nobody is flagged absent', async () => {
    await other.post('/api/attendance/aways', { classId: class2Id, date: today, reason: 'Museum trip' }).expect(403);
    const res = await admin.post('/api/attendance/aways', { classId: class2Id, date: today, fromPeriod: 1, toPeriod: 2, reason: 'Museum trip' }).expect(201);
    expect(res.body).toEqual(expect.objectContaining({ periods: 2, students: 1 }));
    const summary = await admin.get(`/api/attendance/summary?date=${today}`).expect(200);
    const period1 = summary.body.periods.find((p: any) => p.number === 1);
    expect(period1.counts).toEqual(expect.objectContaining({ PRESENT: 1, ABSENT: 1, ON_TRIP: 1 }));
  });

  it('needs a reason for manual marks when attendance is automatic', async () => {
    await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
    await admin.patch('/api/school', { attendanceMode: 'AUTOMATIC' }).expect(200);
    const res = await teacher.put(`/api/attendance/classes/${classId}/periods/${p1}`, { date: today, marks: [{ studentId: aliId, status: 'PRESENT' }] }).expect(400);
    expect(res.body.message).toContain('needs a reason');
    await teacher.put(`/api/attendance/classes/${classId}/periods/${p1}`, { date: today, marks: [{ studentId: aliId, status: 'PRESENT', reason: 'Strap forgotten' }] }).expect(200);
    await admin.patch('/api/school', { attendanceMode: 'MANUAL' }).expect(200);
  });

  it('is unavailable when the school’s attendance module is off', async () => {
    await owner.put(`/api/owner/schools/${schoolId}/modules/attendance`, { enabled: false }).expect(200);
    const res = await teacher.get(`/api/attendance/my-lessons?date=${today}`).expect(403);
    expect(res.body.message).toBe('Attendance isn’t switched on for this school.');
    await owner.put(`/api/owner/schools/${schoolId}/modules/attendance`, { enabled: true }).expect(200);
  });

  it('keeps a student’s history', async () => {
    const res = await admin.get(`/api/attendance/students/${laylaId}?from=${yesterday}&to=${today}`).expect(200);
    expect(res.body.map((r: any) => r.status)).toEqual(['PRESENT', 'LATE']);
  });

  it('leaves marking a class away on a past day to admins', async () => {
    const grade = (await admin.get('/api/grades')).body[0];
    const homeroom = (await admin.post('/api/classes', { name: '4-C', gradeId: grade.id, homeroomTeacherId: sherifId }).expect(201)).body.id;
    await other.post('/api/attendance/aways', { classId: homeroom, date: yesterday, reason: 'Trip' }).expect(403);
    await other.post('/api/attendance/aways', { classId: homeroom, date: today, reason: 'Trip' }).expect(201);
    await admin.post('/api/attendance/aways', { classId: homeroom, date: yesterday, reason: 'Trip' }).expect(201);
  });

  it('stops a deactivated account at once, even with a token it already has', async () => {
    await other.get(`/api/attendance/my-lessons?date=${today}`).expect(200);
    await admin.patch(`/api/staff/${sherifId}`, { active: false }).expect(200);
    await other.get(`/api/attendance/my-lessons?date=${today}`).expect(401);
    await other.get('/api/auth/me').expect(401);
  });
});
