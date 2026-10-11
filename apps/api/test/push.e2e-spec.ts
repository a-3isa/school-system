import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, kid, login, ownerClient, startApp } from './helpers';
import { MAX_DEVICES, NotificationsService } from '../src/notifications/notifications';
import { PushMessage, PushOutcome, PushSender } from '../src/notifications/push';

/** A push sender that remembers what it was asked to send, and answers as a test tells it to. */
class FakeSender extends PushSender {
  enabled = true;
  sent: PushMessage[] = [];
  /** What happens to a token: delivered by default. */
  answer: (token: string) => 'ok' | 'gone' | 'failed' = () => 'ok';
  failWith: Error | null = null;
  async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    if (this.failWith) throw this.failWith;
    this.sent.push(...messages);
    return messages.map((m) => {
      const a = this.answer(m.token);
      return { token: m.token, ok: a === 'ok', invalid: a === 'gone' };
    });
  }
}

const tok = (n: number | string) => `fcm-token-${String(n).padStart(4, '0')}-`.padEnd(40, 'x');

describe('Push notifications (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const fake = new FakeSender();
  let admin: Client, mona: Client, hoda: Client;
  const id: Record<string, string> = {};
  const svc = () => app.get(NotificationsService);

  const notify = (userId: string, type: string, data: object = {}, title = 'English title') =>
    svc().notify([{ schoolId: id.school, userId, type, title, body: 'English body', data }]);
  const sentAt = async (userId: string) => (await prisma.notification.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } })).sentAt;
  const device = (c: Client, token: string, lang = 'en', platform = 'android') => c.post('/api/notifications/devices', { token, platform, lang });

  beforeAll(async () => {
    app = await startApp((b) => b.overrideProvider(PushSender).useValue(fake));
    const owner = await ownerClient(app, prisma, 'push');
    id.school = (await owner.post('/api/owner/schools', { name: 'Nile School', nameAr: 'مدرسة النيل', plan: 'ESSENTIALS', admin: { name: 'Admin', email: 'admin@push.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@push.eg', 'admin-pass');
    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    const classId = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id })).body.id;
    const student = async (key: string, code: string, gender: string, parent: object) => {
      id[key] = (await admin.post('/api/students', { ...(await kid(admin)), gender, code, firstName: key, lastName: 'Test', classId, parent }).expect(201)).body.id;
    };
    await student('Layla', 'P1', 'FEMALE', { relation: 'MOTHER', name: 'Mona', email: 'mona@push.eg', phone: '+20190000001', password: 'parent-pass' });
    await student('Omar', 'P2', 'MALE', { relation: 'MOTHER', name: 'Hoda', email: 'hoda@push.eg', phone: '+20190000002', password: 'parent-pass' });
    mona = await login(app, 'mona@push.eg', 'parent-pass');
    hoda = await login(app, 'hoda@push.eg', 'parent-pass');
    id.mona = (await prisma.user.findFirstOrThrow({ where: { email: 'mona@push.eg' } })).id;
    id.hoda = (await prisma.user.findFirstOrThrow({ where: { email: 'hoda@push.eg' } })).id;
    id.admin = (await prisma.user.findFirstOrThrow({ where: { email: 'admin@push.eg' } })).id;
  });

  beforeEach(() => {
    fake.sent = [];
    fake.enabled = true;
    fake.failWith = null;
    fake.answer = () => 'ok';
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('registering a phone', () => {
    it('remembers it with its language, and updates it when the app registers again', async () => {
      await device(mona, tok('a'), 'ar', 'android').expect(201);
      expect(await prisma.deviceToken.findUniqueOrThrow({ where: { token: tok('a') } })).toEqual(expect.objectContaining({ userId: id.mona, platform: 'android', lang: 'ar' }));
      await device(mona, tok('a'), 'en', 'android').expect(201);
      expect(await prisma.deviceToken.count({ where: { token: tok('a') } })).toBe(1);
      expect((await prisma.deviceToken.findUniqueOrThrow({ where: { token: tok('a') } })).lang).toBe('en');
    });

    it('is for parents, and checks what it is given', async () => {
      await device(admin, tok('b')).expect(403);
      await mona.post('/api/notifications/devices', { token: 'short', platform: 'android' }).expect(400);
      await mona.post('/api/notifications/devices', { token: tok('b'), platform: 'windows' }).expect(400);
      await mona.post('/api/notifications/devices', { token: tok('b'), platform: 'ios', lang: 'fr' }).expect(400);
      await mona.post('/api/notifications/devices', { token: tok('b'), platform: 'ios' }).expect(201); // the language is optional
    });

    it('moves with the phone, so it never rings for the parent before', async () => {
      await device(mona, tok('shared')).expect(201);
      await device(hoda, tok('shared')).expect(201);
      expect((await prisma.deviceToken.findUniqueOrThrow({ where: { token: tok('shared') } })).userId).toBe(id.hoda);
    });

    it('keeps the latest few phones for one parent', async () => {
      for (let i = 0; i < MAX_DEVICES + 3; i++) await svc().registerDevice(id.hoda, { token: tok(`cap${i}`), platform: 'android' }, new Date(Date.now() + i * 1000));
      expect(await prisma.deviceToken.count({ where: { userId: id.hoda } })).toBe(MAX_DEVICES);
      expect(await prisma.deviceToken.findUnique({ where: { token: tok('cap0') } })).toBeNull(); // the oldest went
      expect(await prisma.deviceToken.findUnique({ where: { token: tok(`cap${MAX_DEVICES + 2}`) } })).not.toBeNull();
    });

    it('can forget a phone when the parent signs out', async () => {
      await device(mona, tok('out')).expect(201);
      await mona.delete(`/api/notifications/devices/${tok('out')}`).expect(200);
      expect(await prisma.deviceToken.findUnique({ where: { token: tok('out') } })).toBeNull();
      // Someone else's phone isn't theirs to forget.
      await prisma.deviceToken.deleteMany({ where: { userId: id.hoda } });
      await device(hoda, tok('hers')).expect(201);
      await mona.delete(`/api/notifications/devices/${tok('hers')}`).expect(200);
      expect(await prisma.deviceToken.findUnique({ where: { token: tok('hers') } })).not.toBeNull();
    });
  });

  describe('sending', () => {
    beforeEach(async () => {
      await prisma.deviceToken.deleteMany({});
      await prisma.notification.updateMany({ data: { sentAt: new Date() } });
    });

    it('words each push in the language of the phone, titled with the school’s name', async () => {
      await device(mona, tok('ar'), 'ar').expect(201);
      await device(mona, tok('en'), 'en').expect(201);
      await notify(id.mona, 'excuse.approved', { studentId: id.Layla });
      expect(await svc().flush()).toBe(1);
      const byToken = Object.fromEntries(fake.sent.map((m) => [m.token, m]));
      expect(byToken[tok('ar')]).toEqual(expect.objectContaining({ title: 'مدرسة النيل', body: 'قبلت المدرسة عذر Layla' }));
      expect(byToken[tok('en')]).toEqual(expect.objectContaining({ title: 'Nile School', body: 'The school accepted Layla’s excuse' }));
      expect(byToken[tok('en')].data).toEqual(expect.objectContaining({ type: 'excuse.approved', studentId: id.Layla }));
      expect(await sentAt(id.mona)).not.toBeNull();
    });

    it('agrees with the child’s gender in Arabic', async () => {
      await device(mona, tok('girl'), 'ar').expect(201);
      await device(hoda, tok('boy'), 'ar').expect(201);
      await notify(id.mona, 'attendance.arrived', { studentId: id.Layla });
      await notify(id.hoda, 'attendance.arrived', { studentId: id.Omar });
      await svc().flush();
      const body = (token: string) => fake.sent.find((m) => m.token === token)!.body;
      expect(body(tok('girl'))).toBe('وصلت Layla المدرسة بالسلامة');
      expect(body(tok('boy'))).toBe('وصل Omar المدرسة بالسلامة');
    });

    it('falls back to the server’s English for a type it has no wording for', async () => {
      await device(mona, tok('x'), 'ar').expect(201);
      await notify(id.mona, 'something.new', {}, 'A new thing happened');
      await svc().flush();
      expect(fake.sent[0].body).toBe('A new thing happened');
    });

    it('sends nothing for staff or for a parent without a phone, and still marks them sent', async () => {
      await notify(id.admin, 'excuse.submitted', { studentId: id.Layla });
      await notify(id.hoda, 'excuse.approved', { studentId: id.Omar }); // no phone registered
      expect(await svc().flush()).toBe(2);
      expect(fake.sent).toHaveLength(0);
      expect(await sentAt(id.admin)).not.toBeNull();
      expect(await sentAt(id.hoda)).not.toBeNull();
    });

    it('forgets a phone that no longer has the app, and doesn’t keep trying', async () => {
      await device(mona, tok('dead')).expect(201);
      fake.answer = () => 'gone';
      await notify(id.mona, 'excuse.approved', { studentId: id.Layla });
      await svc().flush();
      expect(await prisma.deviceToken.findUnique({ where: { token: tok('dead') } })).toBeNull();
      expect(await sentAt(id.mona)).not.toBeNull();
    });

    it('is done when it reached one of two phones, even if the other is gone', async () => {
      await device(mona, tok('good')).expect(201);
      await device(mona, tok('stale')).expect(201);
      fake.answer = (t) => (t === tok('stale') ? 'gone' : 'ok');
      await notify(id.mona, 'excuse.approved', { studentId: id.Layla });
      await svc().flush();
      expect(await sentAt(id.mona)).not.toBeNull();
      expect(await prisma.deviceToken.findUnique({ where: { token: tok('stale') } })).toBeNull();
      expect(await prisma.deviceToken.findUnique({ where: { token: tok('good') } })).not.toBeNull();
    });

    it('tries again when delivery fails for now, and gives up after a day', async () => {
      await device(mona, tok('slow')).expect(201);
      fake.answer = () => 'failed';
      await notify(id.mona, 'excuse.approved', { studentId: id.Layla });
      await svc().flush();
      expect(await sentAt(id.mona)).toBeNull();
      expect(await prisma.deviceToken.findUnique({ where: { token: tok('slow') } })).not.toBeNull(); // not forgotten

      fake.answer = () => 'ok';
      expect(await svc().flush()).toBe(1);
      expect(await sentAt(id.mona)).not.toBeNull();

      fake.answer = () => 'failed';
      await notify(id.mona, 'excuse.approved', { studentId: id.Layla });
      await svc().flush();
      expect(await sentAt(id.mona)).toBeNull();
      await svc().flush(500, new Date(Date.now() + 25 * 3600_000));
      expect(await sentAt(id.mona)).not.toBeNull();
    });

    it('keeps them for the next round when Firebase can’t be reached', async () => {
      await device(mona, tok('net')).expect(201);
      fake.failWith = new Error('network down');
      await notify(id.mona, 'excuse.approved', { studentId: id.Layla });
      await expect(svc().flush()).resolves.toBe(0);
      expect(await sentAt(id.mona)).toBeNull();
      fake.failWith = null;
      await svc().flush();
      expect(await sentAt(id.mona)).not.toBeNull();
      expect(fake.sent).toHaveLength(1);
    });

    it('only logs, and marks them sent, when Firebase isn’t set up', async () => {
      fake.enabled = false;
      await device(mona, tok('off')).expect(201);
      await notify(id.mona, 'excuse.approved', { studentId: id.Layla });
      expect(await svc().flush()).toBe(1);
      expect(fake.sent).toHaveLength(0);
      expect(await sentAt(id.mona)).not.toBeNull();
    });

    it('leaves the app’s own list as it was', async () => {
      await notify(id.mona, 'excuse.approved', { studentId: id.Layla });
      const list = (await mona.get('/api/notifications').expect(200)).body;
      expect(list[0]).toEqual(expect.objectContaining({ type: 'excuse.approved', title: 'English title' }));
    });
  });
});
