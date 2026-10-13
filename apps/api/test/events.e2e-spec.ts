import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { addDays, cairoAt, Client, PNG, kid, login, ownerClient, schoolWeek, startApp, wideYear } from './helpers';

// A school week far ahead, so every date here is a school day (or a Friday) whenever the suite runs.
// The mid-year break and term 2 sit before it, at the same distance from that Sunday every time.
const W = schoolWeek();
const SUNDAY = W.sun;
const TUESDAY = W.tue;
const THURSDAY = W.thu;
const SATURDAY = W.sat;
const TERM2 = addDays(SUNDAY, -54);
const BREAK_FROM = addDays(SUNDAY, -37);
const BREAK_TO = addDays(SUNDAY, -31);
const THURSDAY_BEFORE_BREAK = addDays(SUNDAY, -38);
const SUNDAY_AFTER_BREAK = addDays(SUNDAY, -28);

describe('Activities: events, photos and the calendar (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, teacher: Client, p1: Client, p2: Client, p3: Client, p4: Client, other: Client;
  let schoolId: string;
  const id: Record<string, string> = {};

  const event = (extra: object = {}) => ({ title: 'Sports day', startsAt: cairoAt(SUNDAY, '09:00'), endsAt: cairoAt(SUNDAY, '12:00'), place: 'The yard', audience: { kind: 'SCHOOL' }, ...extra });
  const told = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type } });
  const calendar = async (c: Client, query = `from=${SUNDAY}&to=${SATURDAY}`) => (await c.get(`/api/parent/calendar?${query}`).expect(200)).body;
  const photo = (c: Client, eventId: string, bytes: Buffer = PNG, name = 'a.png', caption = 'Relay race') => c.upload(`/api/events/${eventId}/photos`, { caption }, bytes, name);

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'evt');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Events School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@evt.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@evt.eg', 'admin-pass');
    await owner.post('/api/owner/schools', { name: 'Other Events School', plan: 'COMPLETE', admin: { name: 'Other', email: 'admin@other-evt.eg', password: 'admin-pass' } }).expect(201);
    other = await login(app, 'admin@other-evt.eg', 'admin-pass');
    id.teacher = (await admin.post('/api/staff', { name: 'Hana', role: 'TEACHER', email: 'teacher@evt.eg', password: 'staff-pass' }).expect(201)).body.id;
    teacher = await login(app, 'teacher@evt.eg', 'staff-pass');
    id.year = (await admin.post('/api/school/years', wideYear({ term2StartsOn: TERM2, breakFrom: BREAK_FROM, breakTo: BREAK_TO })).expect(201)).body.id;

    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body.id;
    id.classA = (await admin.post('/api/classes', { name: '4-A', gradeId: grade })).body.id;
    id.classB = (await admin.post('/api/classes', { name: '4-B', gradeId: grade })).body.id;
    id.period = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' })).body.id;
    id.math = (await admin.post('/api/subjects', { name: 'Math', nameAr: 'الرياضيات' })).body.id;

    const student = async (key: string, code: string, classId: string, parent: object) => {
      id[key] = (await admin.post('/api/students', { ...(await kid(admin)), code, firstName: key, lastName: 'Test', classId, parent }).expect(201)).body.id;
    };
    const mother = (n: number, name: string) => ({ relation: 'MOTHER', name, email: `p${n}@evt.eg`, phone: `+20132000${String(n).padStart(3, '0')}`, password: 'parent-pass' });
    await student('Ali', 'E1', id.classA, mother(1, 'Rania'));
    await student('Layla', 'E2', id.classA, mother(3, 'Nadia'));
    await student('Salma', 'E3', id.classB, mother(2, 'Dina'));
    await admin.post(`/api/students/${id.Ali}/guardians`, { relation: 'FATHER', name: 'Amr', email: 'p4@evt.eg', phone: '+20132000004', password: 'parent-pass' }).expect(201);
    p1 = await login(app, 'p1@evt.eg', 'parent-pass');
    p2 = await login(app, 'p2@evt.eg', 'parent-pass');
    p3 = await login(app, 'p3@evt.eg', 'parent-pass');
    p4 = await login(app, 'p4@evt.eg', 'parent-pass');
    for (const n of [1, 2, 3, 4]) id[`p${n}`] = (await prisma.user.findFirstOrThrow({ where: { email: `p${n}@evt.eg` } })).id;
    await admin.patch(`/api/students/${id.Layla}/guardians/${id.p3}`, { restricted: true }).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('events', () => {
    it('are made by Student Affairs for an audience, and stay private until published', async () => {
      await teacher.post('/api/events', event()).expect(403);
      const res = (await admin.post('/api/events', event({ audience: { kind: 'CLASSES', ids: [id.classA] } })).expect(201)).body;
      expect(res).toEqual(expect.objectContaining({ title: 'Sports day', place: 'The yard', allDay: false, publishedAt: null, photoCount: 0, audience: { kind: 'CLASSES', ids: [id.classA] } }));
      id.event = res.id;
      expect((await calendar(p1)).items.filter((i: any) => i.kind === 'EVENT')).toEqual([]); // a draft is not on the calendar
      await p1.get(`/api/parent/events/${id.event}`).expect(404);
      expect((await teacher.get(`/api/events?from=${SUNDAY}&to=${SUNDAY}`).expect(200)).body).toHaveLength(1);
    });

    it('refuse an end before the start, a missing audience and a stranger’s class', async () => {
      expect((await admin.post('/api/events', event({ endsAt: cairoAt(SUNDAY, '08:00') })).expect(400)).body.message).toBe('The event must start before it ends.');
      expect((await admin.post('/api/events', event({ audience: { kind: 'CLASSES', ids: [] } })).expect(400)).body.message).toBe('Choose at least one year group or class.');
      expect((await admin.post('/api/events', event({ audience: { kind: 'CLASSES', ids: ['nope'] } })).expect(400)).body.message).toBe('Year group or class not found.');
      await admin.post('/api/events', event({ title: '' })).expect(400);
    });

    it('tell each parent in the audience once when published, and not the restricted parent or other classes', async () => {
      const res = (await admin.post(`/api/events/${id.event}/publish`).expect(201)).body;
      expect(res.told).toBe(2); // Ali's mother and father; Layla's mother is restricted; Salma is in 4-B
      for (const parent of [id.p1, id.p4]) {
        const notes = await told(parent, 'event.new');
        expect(notes).toHaveLength(1);
        expect(notes[0].title).toBe(`School event: Sports day on ${SUNDAY}`);
        expect(notes[0].data).toEqual(expect.objectContaining({ eventId: id.event, title: 'Sports day' }));
      }
      expect(await told(id.p2, 'event.new')).toHaveLength(0);
      expect(await told(id.p3, 'event.new')).toHaveLength(0);
      expect((await admin.post(`/api/events/${id.event}/publish`).expect(400)).body.message).toBe('This event is already published.');
    });

    it('open to the parents in the audience with their photos, and to no one else', async () => {
      const detail = (await p1.get(`/api/parent/events/${id.event}`).expect(200)).body;
      expect(detail).toEqual(expect.objectContaining({ title: 'Sports day', place: 'The yard', photos: [] }));
      await p2.get(`/api/parent/events/${id.event}`).expect(404); // Salma is in 4-B
      await p3.get(`/api/parent/events/${id.event}`).expect(404); // restricted for Layla
    });
  });

  describe('photos', () => {
    it('take JPEG, PNG and WebP up to 2 MB, and refuse a PDF by its bytes', async () => {
      const first = (await photo(admin, id.event).expect(201)).body;
      expect(first).toEqual(expect.objectContaining({ mime: 'image/png', caption: 'Relay race' }));
      id.photo = first.id;
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
      expect((await photo(admin, id.event, pdf, 'a.png').expect(400)).body.message).toBe('Photos must be JPEG, PNG or WebP.'); // a PDF named .png is still a PDF
      expect((await photo(admin, id.event, Buffer.from('not an image'), 'a.jpg').expect(400)).body.message).toBe('Photos must be JPEG, PNG or WebP.');
      await photo(teacher, id.event).expect(403);
      const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
      await photo(admin, id.event, big).expect(413);
    });

    it('stop at 30 for an event', async () => {
      for (let i = 1; i < 30; i++) await photo(admin, id.event, PNG, `p${i}.png`, `Photo ${i}`).expect(201);
      expect((await photo(admin, id.event).expect(400)).body.message).toBe('An event can have up to 30 photos.');
      expect((await admin.get(`/api/events/${id.event}`).expect(200)).body.photoCount).toBe(30);
    });

    it('are served privately to staff and to parents in the audience, and 404 to a parent outside it', async () => {
      const res = await p1.get(`/api/events/${id.event}/photos/${id.photo}`).expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('private, max-age=86400');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(res.body).equals(PNG)).toBe(true);
      await teacher.get(`/api/events/${id.event}/photos/${id.photo}`).expect(200);
      await p2.get(`/api/events/${id.event}/photos/${id.photo}`).expect(404);
      await p3.get(`/api/events/${id.event}/photos/${id.photo}`).expect(404);
      await other.get(`/api/events/${id.event}/photos/${id.photo}`).expect(404);
      const detail = (await p1.get(`/api/parent/events/${id.event}`).expect(200)).body;
      expect(detail.photos).toHaveLength(30);
      expect(detail.photos[0]).toEqual({ id: id.photo, caption: 'Relay race' });
    });

    it('can be deleted one by one, with the event, by Student Affairs only', async () => {
      await teacher.delete(`/api/events/${id.event}/photos/${id.photo}`).expect(403);
      await admin.delete(`/api/events/${id.event}/photos/${id.photo}`).expect(200);
      await admin.delete(`/api/events/${id.event}/photos/${id.photo}`).expect(404);
      expect((await admin.get(`/api/events/${id.event}`).expect(200)).body.photoCount).toBe(29);
    });
  });

  describe('the parent’s calendar', () => {
    it('merges events, a child’s trip, an exam, a holiday and the club’s sessions into one dated list', async () => {
      // A trip for 4-A on the Tuesday, a holiday on the Thursday, an exam for 4-B, and a club meeting Sunday and Thursday.
      const trip = (await admin.post('/api/trips', { title: 'Pyramids', destination: 'Giza', date: TUESDAY, departTime: '08:00', returnTime: '14:00', consentBy: `${addDays(SUNDAY, -2)}T10:00:00.000Z`, classIds: [id.classA] }).expect(201)).body.id;
      await admin.post(`/api/trips/${trip}/open`).expect(201);
      await admin.post('/api/school/holidays', { name: 'Sinai Liberation Day', fromDate: THURSDAY, toDate: THURSDAY }).expect(201);
      await prisma.assessment.create({ data: { schoolId, yearId: id.year, term: 2, classId: id.classB, subjectId: id.math, kind: 'MIDTERM', title: 'Midterm', date: new Date(`${TUESDAY}T00:00:00Z`), startTime: '09:00', endTime: '10:30', maxScore: 50 } });
      const chess = (await admin.post('/api/activities', { name: 'Chess', nameAr: 'الشطرنج', days: [0, 4], startTime: '14:30', endTime: '15:30', capacity: 5 }).expect(201)).body.id;
      await p1.post(`/api/parent/children/${id.Ali}/activities/${chess}/join`).expect(201);
      await p2.post(`/api/parent/children/${id.Salma}/activities/${chess}/join`).expect(201);

      const mine = (await calendar(p1)).items;
      expect(mine.map((i: any) => [i.date, i.kind, i.title])).toEqual([
        [SUNDAY, 'EVENT', 'Sports day'],
        [SUNDAY, 'CLUB', 'Chess'], // 14:30, after the event's morning hours
        [TUESDAY, 'TRIP', 'Pyramids'],
        [THURSDAY, 'HOLIDAY', 'Sinai Liberation Day'],
      ]);
      expect(mine.find((i: any) => i.kind === 'EVENT')).toEqual(expect.objectContaining({ start: '09:00', end: '12:00', id: id.event }));
      expect(mine.find((i: any) => i.kind === 'CLUB')).toEqual(expect.objectContaining({ start: '14:30', end: '15:30', studentId: id.Ali, id: chess, titleAr: 'الشطرنج' }));
      expect(mine.find((i: any) => i.kind === 'TRIP')).toEqual(expect.objectContaining({ studentId: id.Ali, start: '08:00', end: '14:00', id: trip }));
      // No club session on the holiday, and Salma's mother sees Salma's exam but not the event or the trip.
      expect(mine.some((i: any) => i.kind === 'CLUB' && i.date === THURSDAY)).toBe(false);
      const salma = (await calendar(p2)).items;
      expect(salma.map((i: any) => [i.date, i.kind])).toEqual([[TUESDAY, 'EXAM'], [SUNDAY, 'CLUB'], [THURSDAY, 'HOLIDAY']].sort((a, b) => (a[0] as string).localeCompare(b[0] as string)));
      expect(salma.find((i: any) => i.kind === 'EXAM')).toEqual(expect.objectContaining({ title: 'Math: Midterm', titleAr: 'الرياضيات: Midterm', start: '09:00', end: '10:30', studentId: id.Salma }));
    });

    it('decides which events are for the parent without a query for each event', async () => {
      const prisma2 = app.get(PrismaService);
      const counts = jest.spyOn(prisma2.student, 'count');
      try {
        const items = (await calendar(p1)).items;
        expect(items.filter((i: any) => i.kind === 'EVENT').length).toBeGreaterThan(0);
        expect(counts).not.toHaveBeenCalled();
      } finally {
        counts.mockRestore();
      }
    });

    it('can be narrowed to one child, and refuses a child who is not theirs or a parent who is restricted', async () => {
      const items = (await calendar(p1, `from=${SUNDAY}&to=${SATURDAY}&childId=${id.Ali}`)).items;
      expect(items.filter((i: any) => i.studentId).every((i: any) => i.studentId === id.Ali)).toBe(true);
      await p1.get(`/api/parent/calendar?from=${SUNDAY}&to=${SATURDAY}&childId=${id.Salma}`).expect(404);
      await p3.get(`/api/parent/calendar?from=${SUNDAY}&to=${SATURDAY}&childId=${id.Layla}`).expect(404);
      expect((await calendar(p3)).items.some((i: any) => i.studentId === id.Layla)).toBe(false);
    });

    it('shows the mid-year break once for its days, and holds to about three months', async () => {
      const around = (await calendar(p1, `from=${addDays(SUNDAY, -41)}&to=${SUNDAY_AFTER_BREAK}`)).items;
      expect(around.filter((i: any) => i.kind === 'BREAK')).toEqual([expect.objectContaining({ kind: 'BREAK', date: BREAK_FROM, until: BREAK_TO, title: 'Mid-year break', titleAr: 'إجازة منتصف العام' })]);
      // The club meets Sundays and Thursdays, but not while the school is on its break.
      expect(around.filter((i: any) => i.kind === 'CLUB').map((i: any) => i.date)).toEqual([THURSDAY_BEFORE_BREAK, SUNDAY_AFTER_BREAK]);
      expect((await p1.get(`/api/parent/calendar?from=${addDays(SUNDAY, -68)}&to=${addDays(SUNDAY, 112)}`).expect(400)).body.message).toBe('Ask for about three months at a time.');
      expect((await p1.get(`/api/parent/calendar?from=${SUNDAY}&to=${addDays(SUNDAY, -9)}`).expect(400)).body.message).toBe('The end of the range is before its start.');
      await p1.get('/api/parent/calendar?from=soon').expect(400);
      expect((await p1.get('/api/parent/calendar').expect(200)).body.from).toMatch(/^\d{4}-\d{2}-01$/); // this month by default
    });

    it('goes on working with trips and events switched off, minus those kinds', async () => {
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { trips: false, events: false } }).expect(200);
      const kinds = (await calendar(p1)).items.map((i: any) => i.kind);
      expect(kinds).toEqual(expect.arrayContaining(['CLUB', 'HOLIDAY']));
      expect(kinds).not.toContain('TRIP');
      expect(kinds).not.toContain('EVENT');
      await admin.get('/api/events').expect(403);
      await p1.get(`/api/parent/events/${id.event}`).expect(403);
      await owner.patch(`/api/owner/schools/${schoolId}/modules/activities/features`, { features: { trips: true, events: true } }).expect(200);
    });
  });

  describe('deleting and other schools', () => {
    it('removes an event with its photos, and is invisible to another school', async () => {
      await other.get(`/api/events/${id.event}`).expect(404);
      await other.post(`/api/events/${id.event}/publish`).expect(404);
      await teacher.delete(`/api/events/${id.event}`).expect(403);
      await admin.delete(`/api/events/${id.event}`).expect(200);
      expect(await prisma.eventPhoto.count({ where: { eventId: id.event } })).toBe(0);
      await admin.get(`/api/events/${id.event}`).expect(404);
    });
  });
});
