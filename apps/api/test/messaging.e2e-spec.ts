import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { Client, kid, login, ownerClient, PNG, startApp } from './helpers';
import { localParts } from '../src/common/time';
import { MeetingsService } from '../src/messaging/meetings';

const DAY = 86400_000;
const future = (days = 1) => new Date(Date.now() + days * DAY).toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The next open school day (Sunday to Thursday in Cairo), `skip` open days from tomorrow. */
function openDay(skip = 0): string {
  let n = 0;
  for (let d = 1; d < 30; d++) {
    const p = localParts(new Date(Date.now() + d * DAY), 'Africa/Cairo');
    if (p.dayOfWeek <= 4 && n++ === skip) return p.date;
  }
  throw new Error('no open day');
}
function nextFriday(): string {
  for (let d = 1; d < 10; d++) {
    const p = localParts(new Date(Date.now() + d * DAY), 'Africa/Cairo');
    if (p.dayOfWeek === 5) return p.date;
  }
  throw new Error('no friday');
}

/** Waits for one event on a socket, or fails after a while. */
function next<T = any>(socket: Socket, event: string, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no “${event}” within ${ms} ms`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

describe('Messaging (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client, admin: Client, t1: Client, t2: Client, ht: Client;
  let p1: Client, p2: Client, p3: Client, p4: Client;
  let schoolId: string, port: number;
  const id: Record<string, string> = {};

  const tokenOf = async (email: string, password: string) =>
    (await request(app.getHttpServer()).post('/api/auth/login').send({ login: email, password }).expect(201)).body.token as string;
  const connect = (token: string) => io(`http://127.0.0.1:${port}`, { path: '/api/socket.io', auth: { token }, transports: ['websocket'], reconnection: false });
  const notes = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    app = await startApp();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    owner = await ownerClient(app, prisma, 'msg');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Messaging School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@msg.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@msg.eg', 'admin-pass');

    for (const [key, name, role] of [['t1', 'Hana', 'TEACHER'], ['t2', 'Sherif', 'TEACHER'], ['ht', 'Mona Teacher', 'TEACHER']]) {
      id[key] = (await admin.post('/api/staff', { name, role, email: `${key}@msg.eg`, password: 'teacher-pass' }).expect(201)).body.id;
    }
    t1 = await login(app, 't1@msg.eg', 'teacher-pass');
    t2 = await login(app, 't2@msg.eg', 'teacher-pass');
    ht = await login(app, 'ht@msg.eg', 'teacher-pass');

    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    id.classA = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id, homeroomTeacherId: id.ht })).body.id;
    id.classB = (await admin.post('/api/classes', { name: '4-B', gradeId: grade.id })).body.id;
    const roomA = (await admin.post('/api/rooms', { name: 'Room A' })).body.id;
    const roomB = (await admin.post('/api/rooms', { name: 'Room B' })).body.id;
    const math = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    const art = (await admin.post('/api/subjects', { name: 'Art' })).body.id;
    const period = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' })).body.id;
    await admin.post('/api/timetable', { classId: id.classA, dayOfWeek: 0, periodId: period, roomId: roomA, subjectId: math, teacherId: id.t1 }).expect(201);
    await admin.post('/api/timetable', { classId: id.classB, dayOfWeek: 0, periodId: period, roomId: roomB, subjectId: art, teacherId: id.t2 }).expect(201);

    const student = async (key: string, code: string, classId: string, gender: string, parent: object) => {
      id[key] = (await admin.post('/api/students', { ...(await kid(admin)), gender, code, firstName: key, lastName: 'Test', classId, parent }).expect(201)).body.id;
    };
    const mother = (n: number, name: string) => ({ relation: 'MOTHER', name, email: `p${n}@msg.eg`, phone: `+2018000000${n}`, password: 'parent-pass' });
    await student('Ali', 'M1', id.classA, 'MALE', mother(1, 'Rania'));
    await student('Layla', 'M2', id.classA, 'FEMALE', mother(3, 'Nadia'));
    await student('Omar', 'M3', id.classA, 'MALE', mother(4, 'Hoda'));
    await student('Salma', 'M4', id.classB, 'FEMALE', mother(2, 'Dina'));
    // Salma has a father too: p5.
    await admin.post(`/api/students/${id.Salma}/guardians`, { relation: 'FATHER', name: 'Karim', email: 'p5@msg.eg', phone: '+20180000005', password: 'parent-pass' }).expect(201);
    p1 = await login(app, 'p1@msg.eg', 'parent-pass');
    p2 = await login(app, 'p2@msg.eg', 'parent-pass');
    p3 = await login(app, 'p3@msg.eg', 'parent-pass');
    p4 = await login(app, 'p4@msg.eg', 'parent-pass');
    for (const [key, email] of [['p1', 'p1@msg.eg'], ['p2', 'p2@msg.eg'], ['p3', 'p3@msg.eg'], ['p4', 'p4@msg.eg'], ['p5', 'p5@msg.eg']]) {
      id[key] = (await prisma.user.findFirstOrThrow({ where: { email } })).id;
    }
    // Nadia (p3) is Layla's mother and the school restricts what she sees about Layla.
    await admin.patch(`/api/students/${id.Layla}/guardians/${id.p3}`, { restricted: true }).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('announcements', () => {
    it('reach the parents of the chosen classes only, never a restricted parent', async () => {
      const draft = (await t1.post('/api/announcements', { title: 'Trip money', body: 'Please send 50 EGP.', audience: { kind: 'CLASSES', ids: [id.classA] } }).expect(201)).body;
      expect(draft.sentAt).toBeNull();
      expect((await p1.get('/api/parent/announcements').expect(200)).body).toHaveLength(0); // a draft isn't sent
      const sent = (await t1.post(`/api/announcements/${draft.id}/send`).expect(201)).body;
      expect(sent.recipients).toBe(2); // Ali's and Omar's mothers; Layla's mother is restricted
      id.announcement = draft.id;

      const mine = (await p1.get('/api/parent/announcements').expect(200)).body;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toEqual(expect.objectContaining({ title: 'Trip money', readAt: null, hasFile: false }));
      expect((await p4.get('/api/parent/announcements').expect(200)).body).toHaveLength(1);
      for (const other of [p2, p3]) expect((await other.get('/api/parent/announcements').expect(200)).body).toHaveLength(0);

      const note = (await notes(id.p1, 'announcement.new'))[0];
      expect(note.title).toBe('New from the school: Trip money');
      expect(note.data).toEqual(expect.objectContaining({ announcementId: draft.id, studentId: id.Ali }));
    });

    it('can be read and counted', async () => {
      await p1.post(`/api/parent/announcements/${id.announcement}/read`).expect(201);
      await p1.post(`/api/parent/announcements/${id.announcement}/read`).expect(201); // idempotent
      const detail = (await admin.get(`/api/announcements/${id.announcement}`).expect(200)).body;
      expect(detail.readCount).toBe(1);
      expect(detail.reads).toHaveLength(2);
      await p2.post(`/api/parent/announcements/${id.announcement}/read`).expect(404);
    });

    it('can’t be changed or deleted once sent, and send only once', async () => {
      await t1.patch(`/api/announcements/${id.announcement}`, { title: 'Changed' }).expect(400);
      await t1.delete(`/api/announcements/${id.announcement}`).expect(400);
      await t1.post(`/api/announcements/${id.announcement}/send`).expect(400);
    });

    it('lets a teacher write only to their own classes', async () => {
      await t1.post('/api/announcements', { title: 'x', body: 'y', audience: { kind: 'CLASSES', ids: [id.classB] } }).expect(403);
      await t1.post('/api/announcements', { title: 'x', body: 'y', audience: { kind: 'SCHOOL' } }).expect(403);
      await t1.post('/api/announcements/preview', { audience: { kind: 'SCHOOL' } }).expect(403);
      // The class teacher can, though they teach no lesson there.
      await ht.post('/api/announcements', { title: 'From the class teacher', body: 'Hello', audience: { kind: 'CLASSES', ids: [id.classA] } }).expect(201);
    });

    it('stay between the teacher and Student Affairs while a draft', async () => {
      const mineOnly = (await t1.get('/api/announcements').expect(200)).body;
      expect(mineOnly.map((a: any) => a.title)).toEqual(['Trip money']);
      const draftId = (await ht.get('/api/announcements?status=DRAFT').expect(200)).body[0].id;
      await t2.get(`/api/announcements/${draftId}`).expect(404);
      await t1.patch(`/api/announcements/${draftId}`, { title: 'Not mine' }).expect(403);
      expect((await admin.get('/api/announcements?status=DRAFT').expect(200)).body.length).toBeGreaterThanOrEqual(1);
      await admin.delete(`/api/announcements/${draftId}`).expect(200);
    });

    it('can carry a photo or PDF, checked by its bytes, and only the parents it reached can open it', async () => {
      const draft = (await admin.post('/api/announcements', { title: 'Menu', body: 'This week’s menu', audience: { kind: 'GRADES', ids: [(await admin.get('/api/grades')).body[0].id] } }).expect(201)).body;
      await admin.upload(`/api/announcements/${draft.id}/file`, {}, Buffer.from('just text'), 'menu.png', 'put').expect(400);
      expect((await admin.upload(`/api/announcements/${draft.id}/file`, {}, PNG, 'menu.png', 'put').expect(200)).body.hasFile).toBe(true);
      await admin.post(`/api/announcements/${draft.id}/send`).expect(201);
      const res = await p2.get(`/api/parent/announcements/${draft.id}/file`).expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      await admin.get(`/api/announcements/${draft.id}/file`).expect(200);
    });

    it('says how many parents it will reach before sending', async () => {
      expect((await admin.post('/api/announcements/preview', { audience: { kind: 'SCHOOL' } }).expect(201)).body).toEqual({ parents: 4, students: 4 });
      expect((await t1.post('/api/announcements/preview', { audience: { kind: 'CLASSES', ids: [id.classA] } }).expect(201)).body.parents).toBe(2);
      await admin.post('/api/announcements', { title: 'x', body: 'y', audience: { kind: 'CLASSES', ids: [] } }).expect(400);
      await admin.post('/api/announcements', { title: 'x', body: 'y', audience: { kind: 'CLASSES', ids: ['nope'] } }).expect(400);
    });
  });

  describe('the emergency message', () => {
    it('is for Student Affairs, goes to every parent, and stays pinned until confirmed', async () => {
      await t1.post('/api/announcements/emergency', { title: 'Evacuation', body: 'Please collect your child.' }).expect(403);
      const sent = (await admin.post('/api/announcements/emergency', { title: 'Early closing', body: 'The school closes at 11:00 today.' }).expect(201)).body;
      expect(sent).toEqual(expect.objectContaining({ priority: 'EMERGENCY', recipients: 4 }));
      id.emergency = sent.id;
      // Layla's mother (p3) is restricted for Layla, her only child here, so she isn't sent it.
      const pinned = async (c: Client) => (await c.get('/api/parent/announcements/emergency').expect(200)).body;
      expect(await pinned(p1)).toHaveLength(1);
      expect(await pinned(p2)).toHaveLength(1);
      expect(await pinned(p3)).toHaveLength(0);
      expect((await notes(id.p1, 'announcement.emergency'))[0].title).toBe('Urgent from the school: Early closing');

      await p1.post(`/api/parent/announcements/${id.emergency}/acknowledge`).expect(201);
      expect(await pinned(p1)).toHaveLength(0);
      expect((await admin.get('/api/announcements?priority=EMERGENCY').expect(200)).body[0]).toEqual(expect.objectContaining({ acknowledgedCount: 1 }));
      // A routine announcement doesn't need confirming.
      await p1.post(`/api/parent/announcements/${id.announcement}/acknowledge`).expect(400);
    });
  });

  describe('polls', () => {
    const poll = (extra: object = {}) => ({ question: 'Lunch?', options: ['Pasta', 'Rice'], closesAt: future(), audience: { kind: 'CLASSES', ids: [id.classA] }, ...extra });

    it('take one vote per parent, which they can change', async () => {
      const created = (await admin.post('/api/polls', poll()).expect(201)).body;
      id.poll = created.id;
      expect(created).toEqual(expect.objectContaining({ open: true, targets: 2, voters: 0 }));
      const [pasta, rice] = created.options;
      const vote = (c: Client, ...optionIds: string[]) => c.post(`/api/parent/polls/${id.poll}/vote`, { optionIds });

      await vote(p1, pasta.id).expect(201);
      await vote(p1, rice.id).expect(201); // changed their mind
      await vote(p1, pasta.id, rice.id).expect(400); // single choice
      await vote(p1, 'nope').expect(400);
      await vote(p2, pasta.id).expect(404); // not asked
      await vote(p4, pasta.id).expect(201);

      const result = (await admin.get(`/api/polls/${id.poll}`).expect(200)).body;
      expect(result.voters).toBe(2);
      expect(Object.fromEntries(result.options.map((o: any) => [o.label, o.votes]))).toEqual({ Pasta: 1, Rice: 1 });
      expect(result.byOption).toBeUndefined(); // anonymous
      expect((await notes(id.p1, 'poll.new'))[0].data).toEqual(expect.objectContaining({ pollId: id.poll }));
    });

    it('show results after voting when allowed, and always once closed', async () => {
      const hidden = (await admin.post('/api/polls', poll({ question: 'Secret?', showResults: false })).expect(201)).body;
      const before = (await p1.get('/api/parent/polls').expect(200)).body.find((p: any) => p.id === hidden.id);
      expect(before.options[0].votes).toBeUndefined();
      await p1.post(`/api/parent/polls/${hidden.id}/vote`, { optionIds: [hidden.options[0].id] }).expect(201);
      const after = (await p1.get('/api/parent/polls').expect(200)).body.find((p: any) => p.id === hidden.id);
      expect(after.options[0].votes).toBeUndefined(); // voted, but results are off
      expect(after.myVotes).toEqual([hidden.options[0].id]);
      await admin.post(`/api/polls/${hidden.id}/close`).expect(201);
      const closed = (await p1.get('/api/parent/polls').expect(200)).body.find((p: any) => p.id === hidden.id);
      expect(closed).toEqual(expect.objectContaining({ open: false, voters: 1 }));
      await p4.post(`/api/parent/polls/${hidden.id}/vote`, { optionIds: [hidden.options[0].id] }).expect(400);
    });

    it('let Student Affairs see who voted for what only when not anonymous', async () => {
      const named = (await admin.post('/api/polls', poll({ question: 'Named?', anonymous: false })).expect(201)).body;
      await p1.post(`/api/parent/polls/${named.id}/vote`, { optionIds: [named.options[1].id] }).expect(201);
      expect((await admin.get(`/api/polls/${named.id}`).expect(200)).body.byOption[named.options[1].id]).toEqual(['Rania']);
      const teacherPoll = (await t1.post('/api/polls', poll({ question: 'Mine', anonymous: false })).expect(201)).body;
      expect((await t1.get(`/api/polls/${teacherPoll.id}`).expect(200)).body.byOption).toBeUndefined();
    });

    it('are checked when created', async () => {
      await admin.post('/api/polls', poll({ closesAt: new Date(Date.now() - 1000).toISOString() })).expect(400);
      await admin.post('/api/polls', poll({ options: ['Same', 'same'] })).expect(400);
      await admin.post('/api/polls', poll({ options: ['Only one'] })).expect(400);
      await t1.post('/api/polls', poll({ audience: { kind: 'SCHOOL' } })).expect(403);
      await t2.get(`/api/polls/${id.poll}`).expect(404); // not their poll
      expect((await t2.get('/api/polls').expect(200)).body).toHaveLength(0);
    });
  });

  describe('parent–teacher chat', () => {
    it('lets a parent write to their child’s teachers and Student Affairs, not to other teachers', async () => {
      const { contacts, chatFrom, chatTo } = (await p1.get(`/api/parent/children/${id.Ali}/contacts`).expect(200)).body;
      expect(contacts.map((c: any) => c.name)).toEqual(['Hana', 'Mona Teacher', 'Admin']);
      expect(contacts[0]).toEqual(expect.objectContaining({ subjects: ['Math'], homeroom: false }));
      expect(contacts[1].homeroom).toBe(true);
      expect([chatFrom, chatTo]).toEqual(['08:00', '15:00']);

      const thread = (await p1.post(`/api/parent/children/${id.Ali}/threads`, { staffId: id.t1 }).expect(201)).body;
      expect((await p1.post(`/api/parent/children/${id.Ali}/threads`, { staffId: id.t1 }).expect(201)).body.id).toBe(thread.id); // the same one
      id.thread = thread.id;
      await p1.post(`/api/parent/children/${id.Ali}/threads`, { staffId: id.t2 }).expect(403);
      await p2.post(`/api/parent/children/${id.Ali}/threads`, { staffId: id.t1 }).expect(404); // not their child
      await p3.get(`/api/parent/children/${id.Layla}/contacts`).expect(404); // restricted
    });

    it('delivers messages both ways and counts what is unread', async () => {
      await p1.post(`/api/threads/${id.thread}/messages`, { body: '  Is Ali doing well in Math?  ' }).expect(201);
      expect((await t1.get('/api/threads/unread-count').expect(200)).body.count).toBe(1);
      const listed = (await t1.get('/api/threads').expect(200)).body;
      expect(listed[0]).toEqual(expect.objectContaining({ unread: 1, parent: expect.objectContaining({ name: 'Rania' }) }));
      expect(listed[0].last.body).toBe('Is Ali doing well in Math?');

      await t1.post(`/api/threads/${id.thread}/read`).expect(201);
      expect((await t1.get('/api/threads/unread-count').expect(200)).body.count).toBe(0);
      await t1.post(`/api/threads/${id.thread}/messages`, { body: 'Yes, very well.' }).expect(201);
      expect((await p1.get('/api/parent/threads').expect(200)).body[0].unread).toBe(1);
      await p1.post(`/api/threads/${id.thread}/read`).expect(201);
      expect((await p1.get('/api/parent/threads').expect(200)).body[0].unread).toBe(0);

      const messages = (await p1.get(`/api/threads/${id.thread}/messages`).expect(200)).body;
      expect(messages.map((m: any) => m.body)).toEqual(['Yes, very well.', 'Is Ali doing well in Math?']); // newest first
      const older = (await p1.get(`/api/threads/${id.thread}/messages?before=${encodeURIComponent(messages[0].createdAt)}`).expect(200)).body;
      expect(older.map((m: any) => m.body)).toEqual(['Is Ali doing well in Math?']);
      expect((await t1.get(`/api/threads/${id.thread}`).expect(200)).body.canReply).toBe(true);
    });

    it('keeps a conversation between its two people, with Student Affairs able to read but not answer', async () => {
      for (const other of [t2, ht, p2, p4]) await other.get(`/api/threads/${id.thread}/messages`).expect(404);
      expect((await admin.get(`/api/threads/${id.thread}/messages`).expect(200)).body).toHaveLength(2);
      expect((await admin.get(`/api/threads/${id.thread}`).expect(200)).body.canReply).toBe(false);
      await admin.post(`/api/threads/${id.thread}/messages`, { body: 'Chiming in' }).expect(403);
      expect((await admin.get('/api/threads?scope=school').expect(200)).body).toHaveLength(1);
      await t1.get('/api/threads?scope=school').expect(403);
      expect((await t2.get('/api/threads').expect(200)).body).toHaveLength(0);
    });

    it('treats Student Affairs as one inbox that any admin can answer', async () => {
      await admin.post('/api/staff', { name: 'Zeinab', role: 'SCHOOL_ADMIN', email: 'admin2@msg.eg', password: 'admin-pass' }).expect(201);
      const admin2 = await login(app, 'admin2@msg.eg', 'admin-pass');
      const thread = (await p4.post(`/api/parent/children/${id.Omar}/threads`, { staffId: (await prisma.user.findFirstOrThrow({ where: { email: 'admin@msg.eg' } })).id }).expect(201)).body;
      await p4.post(`/api/threads/${thread.id}/messages`, { body: 'A question for the office' }).expect(201);
      expect((await admin2.get('/api/threads').expect(200)).body.map((t: any) => t.id)).toContain(thread.id);
      expect((await admin2.get('/api/threads/unread-count').expect(200)).body.count).toBe(1);
      await admin2.post(`/api/threads/${thread.id}/messages`, { body: 'We will call you.' }).expect(201);
      // The second admin isn't offered as a contact: Student Affairs is one name.
      const names = (await p4.get(`/api/parent/children/${id.Omar}/contacts`).expect(200)).body.contacts.map((c: any) => c.name);
      expect(names.filter((n: string) => n === 'Zeinab' || n === 'Admin')).toEqual(['Admin']);
    });

    it('checks what is sent', async () => {
      await p1.post(`/api/threads/${id.thread}/messages`, { body: '   ' }).expect(400);
      await p1.post(`/api/threads/${id.thread}/messages`, { body: 'x'.repeat(2001) }).expect(400);
      await p1.upload(`/api/threads/${id.thread}/messages`, { body: 'See this' }, Buffer.from('not an image'), 'a.png').expect(400);
      const withFile = (await p1.upload(`/api/threads/${id.thread}/messages`, { body: 'See this' }, PNG, 'a.png').expect(201)).body;
      expect(withFile.hasFile).toBe(true);
      const file = await t1.get(`/api/threads/${id.thread}/messages/${withFile.id}/file`).expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      await t2.get(`/api/threads/${id.thread}/messages/${withFile.id}/file`).expect(404);
    });

    it('is closed to a parent the school restricts, and stays closed for replies', async () => {
      await admin.patch(`/api/students/${id.Ali}/guardians/${id.p1}`, { restricted: true }).expect(200);
      await p1.get(`/api/threads/${id.thread}/messages`).expect(404);
      expect((await p1.get('/api/parent/threads').expect(200)).body).toHaveLength(0);
      await t1.post(`/api/threads/${id.thread}/messages`, { body: 'Hello?' }).expect(403);
      expect((await t1.get(`/api/threads/${id.thread}`).expect(200)).body.canReply).toBe(false); // teachers can still read it
      await admin.patch(`/api/students/${id.Ali}/guardians/${id.p1}`, { restricted: false }).expect(200);
      await p1.get(`/api/threads/${id.thread}/messages`).expect(200);
    });

    it('pushes live to whoever is connected, and notifies only those who are not', async () => {
      const socket = connect(await tokenOf('t1@msg.eg', 'teacher-pass'));
      await next(socket, 'connect');
      const incoming = next(socket, 'message');
      await p1.post(`/api/threads/${id.thread}/messages`, { body: 'Live message' }).expect(201);
      expect((await incoming).message).toEqual(expect.objectContaining({ body: 'Live message', threadId: id.thread }));
      expect((await notes(id.t1, 'message.new')).filter((n) => (n.body as string).includes('Live'))).toHaveLength(0);

      // The teacher opening the thread tells the parent's connected phone.
      const parentSocket = connect(await tokenOf('p1@msg.eg', 'parent-pass'));
      await next(parentSocket, 'connect');
      const seen = next(parentSocket, 'read');
      await t1.post(`/api/threads/${id.thread}/read`).expect(201);
      expect(await seen).toEqual(expect.objectContaining({ threadId: id.thread, readerId: id.t1 }));
      parentSocket.close();
      socket.close();
      await wait(300);
      await p1.post(`/api/threads/${id.thread}/messages`, { body: 'Offline message' }).expect(201);
      const offline = (await notes(id.t1, 'message.new')).filter((n) => (n.body as string).includes('Offline'));
      expect(offline).toHaveLength(1);
      expect(offline[0].title).toBe('New message from Rania about Ali');
    });

    it('turns away a socket without a good login or without the chat feature', async () => {
      const bad = connect('not-a-token');
      await next(bad, 'disconnect');
      const parent = connect(await tokenOf('p1@msg.eg', 'parent-pass'));
      await next(parent, 'connect');
      parent.close();
    });
  });

  describe('meetings', () => {
    const slots = async (c: Client) => (await c.get(`/api/parent/children/${id.Ali}/meetings`).expect(200)).body;
    const window = (date: string, extra: object = {}) => ({ date, fromTime: '14:00', toTime: '15:00', slotMinutes: 20, place: 'Room A', ...extra });

    it('lets a teacher offer meeting times, cut into slots', async () => {
      const w = (await t1.post('/api/meetings/windows', window(openDay(0))).expect(201)).body;
      id.window = w.id;
      expect(w.slots).toHaveLength(3);
      expect(new Date(w.slots[1].startsAt).getTime() - new Date(w.slots[0].startsAt).getTime()).toBe(20 * 60_000);
      await t1.post('/api/meetings/windows', window(openDay(0), { fromTime: '14:30', toTime: '15:30' })).expect(400); // overlaps
      await t1.post('/api/meetings/windows', window(nextFriday())).expect(400); // closed
      await t1.post('/api/meetings/windows', window('2020-01-06')).expect(400); // passed
      await t1.post('/api/meetings/windows', window(openDay(3), { fromTime: '14:00', toTime: '14:10' })).expect(400); // too short for one
      await t1.post('/api/meetings/windows', window(openDay(3), { teacherId: id.t2 })).expect(403);
      await admin.post('/api/meetings/windows', window(openDay(3))).expect(400); // an admin has to say whose
      await admin.post('/api/meetings/windows', window(openDay(3), { teacherId: id.t2 })).expect(201);
    });

    it('offers a parent only the free times of their child’s teachers', async () => {
      const { teachers, booked } = await slots(p1);
      expect(booked).toEqual([]);
      const hana = teachers.find((t: any) => t.teacher.name === 'Hana');
      expect(hana.slots).toHaveLength(3);
      expect(teachers.find((t: any) => t.teacher.name === 'Sherif')).toBeUndefined(); // teaches class B
      await p2.get(`/api/parent/children/${id.Ali}/meetings`).expect(404);
    });

    it('books a slot once, with a note, and tells the teacher', async () => {
      const slot = (await slots(p1)).teachers.find((t: any) => t.teacher.name === 'Hana').slots[0];
      await p1.post(`/api/parent/children/${id.Ali}/meetings/${slot.id}/book`, { note: 'About his homework' }).expect(201);
      id.slot = slot.id;
      const { booked } = await slots(p1);
      expect(booked).toEqual([expect.objectContaining({ id: slot.id, note: 'About his homework' })]);
      expect((await notes(id.t1, 'meeting.booked'))[0].data).toEqual(expect.objectContaining({ slotId: slot.id, studentId: id.Ali }));
      const staff = (await t1.get('/api/meetings').expect(200)).body[0].slots.find((s: any) => s.id === slot.id);
      expect(staff).toEqual(expect.objectContaining({ bookedBy: expect.objectContaining({ name: 'Rania' }) }));
      // One meeting per teacher per day, and not a time someone else has.
      const second = (await slots(p1)).teachers.find((t: any) => t.teacher.name === 'Hana').slots[0];
      await p1.post(`/api/parent/children/${id.Ali}/meetings/${second.id}/book`, {}).expect(400);
      await p4.post(`/api/parent/children/${id.Omar}/meetings/${slot.id}/book`, {}).expect(409);
      await p2.post(`/api/parent/children/${id.Salma}/meetings/${second.id}/book`, {}).expect(404); // not Salma's teacher
    });

    it('gives a time to only one of two parents who ask together', async () => {
      const day2 = (await t1.post('/api/meetings/windows', window(openDay(1))).expect(201)).body;
      const slot = day2.slots[0].id;
      const results = await Promise.all([
        p1.post(`/api/parent/children/${id.Ali}/meetings/${slot}/book`, {}),
        p4.post(`/api/parent/children/${id.Omar}/meetings/${slot}/book`, {}),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const taken = await prisma.meetingSlot.findUniqueOrThrow({ where: { id: slot } });
      expect(taken.bookedById).not.toBeNull();
    });

    it('lets a parent cancel until two hours before, and the teacher at any time', async () => {
      const slot = await prisma.meetingSlot.findUniqueOrThrow({ where: { id: id.slot } });
      const svc = app.get(MeetingsService);
      const parent = { id: id.p1, schoolId, role: Role.PARENT };
      await expect(svc.cancelOwn(parent, id.slot, new Date(slot.startsAt.getTime() - 60 * 60_000))).rejects.toThrow('too late to cancel online');
      await svc.cancelOwn(parent, id.slot, new Date(slot.startsAt.getTime() - 3 * 60 * 60_000));
      expect((await prisma.meetingSlot.findUniqueOrThrow({ where: { id: id.slot } })).bookedById).toBeNull();
      expect((await notes(id.t1, 'meeting.cancelled')).length).toBe(1);

      // The teacher cancels another booking: the parent is told.
      const other = (await prisma.meetingSlot.findFirstOrThrow({ where: { bookedById: { in: [id.p1, id.p4] } } })).id;
      await t2.post(`/api/meetings/slots/${other}/cancel`).expect(404); // not their slot
      await t1.post(`/api/meetings/slots/${other}/cancel`).expect(201);
      await t1.post(`/api/meetings/slots/${other}/cancel`).expect(400); // no longer booked
      expect((await prisma.notification.count({ where: { type: 'meeting.cancelled', userId: { in: [id.p1, id.p4] } } }))).toBe(1);
    });

    it('tells parents when a teacher removes a whole window', async () => {
      const w = (await t1.post('/api/meetings/windows', window(openDay(5))).expect(201)).body;
      await p1.post(`/api/parent/children/${id.Ali}/meetings/${w.slots[0].id}/book`, {}).expect(201);
      await t2.delete(`/api/meetings/windows/${w.id}`).expect(404);
      expect((await t1.delete(`/api/meetings/windows/${w.id}`).expect(200)).body).toEqual({ ok: true, cancelled: 1 });
      expect(await prisma.meetingSlot.count({ where: { windowId: w.id } })).toBe(0);
    });
  });

  describe('office hours', () => {
    it('are set in school settings and must end after they start', async () => {
      await admin.patch('/api/school', { chatFrom: '09:00', chatTo: '14:00' }).expect(200);
      expect((await p1.get(`/api/parent/children/${id.Ali}/contacts`).expect(200)).body).toEqual(expect.objectContaining({ chatFrom: '09:00', chatTo: '14:00' }));
      await admin.patch('/api/school', { chatFrom: '15:00' }).expect(400);
      await admin.patch('/api/school', { chatTo: '08:30' }).expect(400);
    });
  });

  describe('the plan and the module switch', () => {
    it('Essentials has announcements but not chat, polls or meetings', async () => {
      await owner.post('/api/owner/schools', { name: 'Small School', plan: 'ESSENTIALS', admin: { name: 'Small Admin', email: 'admin@small.eg', password: 'admin-pass' } }).expect(201);
      const small = await login(app, 'admin@small.eg', 'admin-pass');
      await small.get('/api/announcements').expect(200);
      for (const url of ['/api/polls', '/api/threads', '/api/meetings']) {
        const res = await small.get(url).expect(403);
        expect(res.body.message).toBe('This isn’t part of this school’s subscription.');
      }
    });

    it('switching chat off closes the chat but not the announcements', async () => {
      await owner.patch(`/api/owner/schools/${schoolId}/modules/messaging/features`, { features: { chat: false } }).expect(200);
      await t1.get('/api/threads').expect(403);
      await p1.get('/api/parent/threads').expect(403);
      await t1.get('/api/announcements').expect(200);
      const refused = connect(await tokenOf('t1@msg.eg', 'teacher-pass'));
      await next(refused, 'disconnect');
      await owner.patch(`/api/owner/schools/${schoolId}/modules/messaging/features`, { features: { chat: true } }).expect(200);
    });

    it('switching the module off closes everything', async () => {
      await owner.put(`/api/owner/schools/${schoolId}/modules/messaging`, { enabled: false }).expect(200);
      await t1.get('/api/announcements').expect(403);
      await p1.get('/api/parent/announcements').expect(403);
      await owner.put(`/api/owner/schools/${schoolId}/modules/messaging`, { enabled: true }).expect(200);
    });
  });

  it('keeps one school’s messages from another’s', async () => {
    await owner.post('/api/owner/schools', { name: 'Other School', plan: 'COMPLETE', admin: { name: 'Other Admin', email: 'admin@other.eg', password: 'admin-pass' } }).expect(201);
    const other = await login(app, 'admin@other.eg', 'admin-pass');
    expect((await other.get('/api/announcements').expect(200)).body).toEqual([]);
    expect((await other.get('/api/polls').expect(200)).body).toEqual([]);
    expect((await other.get('/api/threads?scope=school').expect(200)).body).toEqual([]);
    await other.get(`/api/announcements/${id.announcement}`).expect(404);
    await other.get(`/api/polls/${id.poll}`).expect(404);
    await other.get(`/api/threads/${id.thread}/messages`).expect(404);
    await other.delete(`/api/meetings/windows/${id.window}`).expect(404);
  });
});
