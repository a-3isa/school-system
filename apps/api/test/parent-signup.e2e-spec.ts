import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Client, login, ownerClient, startApp } from './helpers';
import { EmailService } from '../src/auth/email';

// The school registers a parent's email; the parent signs up in the app with
// it, proving it with a code sent there, and chooses a password.
describe('Parents sign up with the email the school registered (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let admin: Client;
  let studentId: string;
  const http = () => request(app.getHttpServer());
  const codeIn = (to: string) => app.get(EmailService).last(to)?.text.match(/\b(\d{6})\b/)?.[1];

  beforeAll(async () => {
    app = await startApp();
    const owner = await ownerClient(app, prisma, 'signup');
    await owner.post('/api/owner/schools', { name: 'Signup School', plan: 'ESSENTIALS', admin: { name: 'A', email: 'admin@signup.eg', password: 'admin-pass' } }).expect(201);
    admin = await login(app, 'admin@signup.eg', 'admin-pass');
    studentId = (await admin.post('/api/students', { code: 'S1', firstName: 'Mona', lastName: 'Ali' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('needs an email and a mobile with country code to register a parent', async () => {
    await admin.post(`/api/students/${studentId}/guardians`, { relation: 'MOTHER', name: 'Heba', phone: '+201600000001' }).expect(400);
    await admin.post(`/api/students/${studentId}/guardians`, { relation: 'MOTHER', name: 'Heba', email: 'heba@x.eg', phone: '01600000001' }).expect(400);
    const res = await admin
      .post(`/api/students/${studentId}/guardians`, { relation: 'MOTHER', name: 'Heba', email: 'Heba@X.eg', phone: '+201600000001', phoneChecked: true })
      .expect(201);
    expect(res.body.guardians[0].user).toEqual(expect.objectContaining({ email: 'heba@x.eg', phoneVerifiedAt: expect.any(String), emailVerifiedAt: null }));
  });

  it('answers the same for an email the school didn’t register, and sends nothing', async () => {
    const res = await http().post('/api/auth/signup').send({ email: 'stranger@x.eg' }).expect(201);
    expect(res.body.sent).toBe(true);
    expect(app.get(EmailService).last('stranger@x.eg')).toBeUndefined();
  });

  it('signs a parent up with the emailed code and their own password', async () => {
    await http().post('/api/auth/signup').send({ email: 'heba@x.eg' }).expect(201);
    const code = codeIn('heba@x.eg')!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    await http().post('/api/auth/password/set').send({ email: 'heba@x.eg', code: wrong, password: 'heba-pass-1' }).expect(401);
    await http().post('/api/auth/password/set').send({ email: 'heba@x.eg', code, password: 'short' }).expect(400);
    const res = await http().post('/api/auth/password/set').send({ email: 'heba@x.eg', code, password: 'heba-pass-1' }).expect(201);
    expect(res.body.user.role).toBe('PARENT');
    await http().post('/api/auth/password/set').send({ email: 'heba@x.eg', code, password: 'heba-pass-2' }).expect(401); // once only
    const parent = await login(app, 'heba@x.eg', 'heba-pass-1');
    expect((await parent.get('/api/parent/children').expect(200)).body.map((c: any) => c.firstName)).toEqual(['Mona']);
    expect((await admin.get(`/api/students/${studentId}`)).body.guardians[0].user.emailVerifiedAt).toBeTruthy();
  });

  it('signs in with email only, not the mobile number', async () => {
    await http().post('/api/auth/login').send({ login: '+201600000001', password: 'heba-pass-1' }).expect(401);
    await http().post('/api/auth/login').send({ login: 'HEBA@x.eg', password: 'heba-pass-1' }).expect(201);
  });

  it('tells a parent who already signed up to sign in instead', async () => {
    await http().post('/api/auth/signup').send({ email: 'heba@x.eg' }).expect(201);
    expect(app.get(EmailService).last('heba@x.eg')!.subject).toBe('You already have an account');
  });

  it('resets a forgotten password with an emailed code', async () => {
    await http().post('/api/auth/password/forgot').send({ email: 'heba@x.eg' }).expect(201);
    const code = codeIn('heba@x.eg')!;
    await http().post('/api/auth/password/set').send({ email: 'heba@x.eg', code, password: 'heba-new-pass' }).expect(201);
    await http().post('/api/auth/login').send({ login: 'heba@x.eg', password: 'heba-pass-1' }).expect(401);
    await login(app, 'heba@x.eg', 'heba-new-pass');
    // Staff can reset too.
    await http().post('/api/auth/password/forgot').send({ email: 'admin@signup.eg' }).expect(201);
    expect(codeIn('admin@signup.eg')).toMatch(/^\d{6}$/);
  });

  it('counts every guess, even when many arrive at once', async () => {
    await http().post('/api/auth/password/forgot').send({ email: 'admin@signup.eg' }).expect(201);
    const code = codeIn('admin@signup.eg')!;
    const guesses = Array.from({ length: 20 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const results = await Promise.all(guesses.map((g) => http().post('/api/auth/password/set').send({ email: 'admin@signup.eg', code: g, password: 'whatever-1' })));
    expect(results.every((r) => r.status === 401)).toBe(true);
    await http().post('/api/auth/password/set').send({ email: 'admin@signup.eg', code, password: 'whatever-1' }).expect(401);
  });

  it('limits how many codes one email can ask for', async () => {
    for (let i = 0; i < 3; i++) await http().post('/api/auth/password/forgot').send({ email: 'admin@signup.eg' }).expect(201);
    await http().post('/api/auth/password/forgot').send({ email: 'admin@signup.eg' }).expect(429);
    await http().post('/api/auth/signup').send({ email: 'not-an-email' }).expect(400);
  });
});
