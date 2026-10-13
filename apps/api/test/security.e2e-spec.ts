import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { EmailService } from '../src/auth/email';
import { Client, client, kid, login, ownerClient, startApp } from './helpers';

// How long a sign-in lasts, and how a person ends every sign-in they have.
describe('Sign-in hardening (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let admin: Client;
  const http = () => request(app.getHttpServer());

  const signIn = async (email: string, password: string) => (await http().post('/api/auth/login').send({ login: email, password }).expect(201)).body as { token: string; user: { id: string } };
  const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { sub: string; iat: number; exp: number };
  const days = (token: string) => (claims(token).exp - claims(token).iat) / 86400;
  /** A token the person signed in with a minute ago, on another device. */
  const earlier = async (userId: string) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return app.get(JwtService).signAsync({ sub: user.id, schoolId: user.schoolId, role: user.role, iat: Math.floor(Date.now() / 1000) - 60 });
  };
  const status = async (token: string) => (await http().get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status;

  beforeAll(async () => {
    app = await startApp();
    const owner = await ownerClient(app, prisma, 'sec');
    await owner.post('/api/owner/schools', { name: 'Security School', plan: 'ESSENTIALS', admin: { name: 'Admin', email: 'admin@sec.eg', password: 'admin-pass' } }).expect(201);
    admin = await login(app, 'admin@sec.eg', 'admin-pass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('keeps staff and the platform owner signed in for 7 days, and parents for 30', async () => {
    expect(days((await signIn('admin@sec.eg', 'admin-pass')).token)).toBe(7);
    expect(days((await signIn('owner-sec@test.eg', 'owner-pass')).token)).toBe(7);
    const studentId = (await admin.post('/api/students', { ...(await kid(admin)), code: 'SEC1', firstName: 'Nour', lastName: 'Adel', parent: { relation: 'MOTHER', name: 'Dalia', email: 'dalia@sec.eg' } }).expect(201)).body.id;
    expect(studentId).toBeTruthy();
    await prisma.user.update({ where: { email: 'dalia@sec.eg' }, data: { passwordHash: await bcrypt.hash('parent-pass-1', 10) } });
    expect(days((await signIn('dalia@sec.eg', 'parent-pass-1')).token)).toBe(30);
  });

  it('signs a person out of every device', async () => {
    await admin.post('/api/staff', { name: 'Mona', role: 'SOCIAL_WORKER', email: 'mona@sec.eg', password: 'worker-pass-1' }).expect(201);
    const { token, user } = await signIn('mona@sec.eg', 'worker-pass-1');
    const other = await earlier(user.id);
    expect(await status(other)).toBe(200);
    await client(app, token).post('/api/auth/sign-out-everywhere').expect(201);
    expect(await status(other)).toBe(401);
    // Signing in again works.
    expect(await status((await signIn('mona@sec.eg', 'worker-pass-1')).token)).toBe(200);
  });

  it('signs a member of staff out everywhere when Student Affairs changes their password', async () => {
    const teacher = (await admin.post('/api/staff', { name: 'Hala', role: 'TEACHER', email: 'hala@sec.eg', password: 'teacher-pass-1' }).expect(201)).body;
    const other = await earlier(teacher.id);
    expect(await status(other)).toBe(200);
    await admin.patch(`/api/staff/${teacher.id}`, { name: 'Hala Samir' }).expect(200);
    expect(await status(other)).toBe(200); // a rename keeps them signed in
    await admin.patch(`/api/staff/${teacher.id}`, { password: 'teacher-pass-2' }).expect(200);
    expect(await status(other)).toBe(401);
    await http().post('/api/auth/login').send({ login: 'hala@sec.eg', password: 'teacher-pass-1' }).expect(401);
    expect(await status((await signIn('hala@sec.eg', 'teacher-pass-2')).token)).toBe(200);
  });

  it('signs a person out everywhere when they reset a forgotten password', async () => {
    const { user } = await signIn('hala@sec.eg', 'teacher-pass-2');
    const other = await earlier(user.id);
    await http().post('/api/auth/password/forgot').send({ email: 'hala@sec.eg' }).expect(201);
    const code = app.get(EmailService).last('hala@sec.eg')!.text.match(/\b(\d{6})\b/)![1];
    const reset = await http().post('/api/auth/password/reset').send({ email: 'hala@sec.eg', code, password: 'teacher-pass-3' }).expect(201);
    expect(await status(other)).toBe(401);
    expect(await status(reset.body.token)).toBe(200); // the new sign-in from the reset itself
  });

  it('lets only the dashboard and the parent app’s own origins call the API from a browser', async () => {
    const preflight = (origin: string) => http().options('/api/auth/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST');
    expect((await preflight('http://localhost:3001')).headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect((await preflight('http://127.0.0.1:3012')).headers['access-control-allow-origin']).toBe('http://127.0.0.1:3012');
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    const answer = await http().post('/api/auth/login').set('Origin', 'https://evil.example').send({ login: 'admin@sec.eg', password: 'admin-pass' });
    expect(answer.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('applies the same origin rule to live chat connections', async () => {
    const handshake = (origin: string) => http().get('/api/socket.io/?EIO=4&transport=polling').set('Origin', origin);
    expect((await handshake('http://localhost:3001')).headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect((await handshake('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends the usual protective headers, and still lets the dashboard load crests and photos', async () => {
    const res = await http().get('/api/auth/me');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('counts wrong passwords across servers, so a guesser cannot spread the tries', async () => {
    const second = await startApp();
    try {
      const wrong = (a: INestApplication) => request(a.getHttpServer()).post('/api/auth/login').send({ login: 'spread@sec.eg', password: 'nope' });
      for (let i = 0; i < 10; i++) await wrong(i % 2 ? second : app).expect(401);
      const blocked = await wrong(second).expect(429);
      expect(blocked.body.message).toMatch(/^Too many wrong passwords\. Try again in \d+ minutes?\.$/);
      await wrong(app).expect(429);
    } finally {
      await second.close();
    }
  });
});
