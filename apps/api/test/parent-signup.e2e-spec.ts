import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Client, login, ownerClient, startApp } from './helpers';
import { EmailService } from '../src/auth/email';
import { WhatsAppService } from '../src/auth/whatsapp';

// The school registers a parent's email. The parent signs up in the app:
// a code to that email, then their mobile with a code by WhatsApp, then a
// password. The checked mobile is saved and the school is told if it changed.
describe('Parents sign up in the app (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let admin: Client;
  let studentId: string;
  const http = () => request(app.getHttpServer());
  const emailCode = (to: string) => app.get(EmailService).last(to)?.text.match(/\b(\d{6})\b/)?.[1];
  const whatsappCode = (to: string) => app.get(WhatsAppService).outbox.get(to);
  const guardian = async () => (await admin.get(`/api/students/${studentId}`)).body.guardians[0].user;

  beforeAll(async () => {
    app = await startApp();
    const owner = await ownerClient(app, prisma, 'signup');
    await owner.post('/api/owner/schools', { name: 'Signup School', plan: 'ESSENTIALS', admin: { name: 'A', email: 'admin@signup.eg', password: 'admin-pass' } }).expect(201);
    admin = await login(app, 'admin@signup.eg', 'admin-pass');
    studentId = (await admin.post('/api/students', { code: 'S1', firstName: 'Mona', lastName: 'Ali' }).expect(201)).body.id;
    // Someone else already uses this mobile.
    const other = (await admin.post('/api/students', { code: 'S2', firstName: 'Ziad', lastName: 'Omar' }).expect(201)).body.id;
    await admin.post(`/api/students/${other}/guardians`, { relation: 'MOTHER', name: 'Dina', email: 'dina@x.eg', phone: '+201600000777' }).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('registers a parent by email; the mobile is optional', async () => {
    await admin.post(`/api/students/${studentId}/guardians`, { relation: 'MOTHER', name: 'Heba', phone: '+201600000001' }).expect(400);
    await admin.post(`/api/students/${studentId}/guardians`, { relation: 'MOTHER', name: 'Heba', email: 'heba@x.eg', phone: '01600000001' }).expect(400);
    await admin.post(`/api/students/${studentId}/guardians`, { relation: 'MOTHER', name: 'Heba', email: 'Heba@X.eg', phone: '+201600000001' }).expect(201);
    expect(await guardian()).toEqual(expect.objectContaining({ email: 'heba@x.eg', phone: '+201600000001', phoneVerifiedAt: null, emailVerifiedAt: null }));
  });

  it('answers the same for an email the school didn’t register, and sends nothing', async () => {
    const res = await http().post('/api/auth/signup').send({ email: 'stranger@x.eg' }).expect(201);
    expect(res.body.sent).toBe(true);
    expect(app.get(EmailService).last('stranger@x.eg')).toBeUndefined();
    await http().post('/api/auth/password/forgot').send({ email: 'heba@x.eg' }).expect(201); // not signed up yet: nothing
    expect(app.get(EmailService).last('heba@x.eg')).toBeUndefined();
  });

  it('signs a parent up: email code, then a WhatsApp code to their mobile, then a password', async () => {
    await http().post('/api/auth/signup').send({ email: 'heba@x.eg' }).expect(201);
    const code = emailCode('heba@x.eg')!;
    const wrong = code === '000000' ? '111111' : '000000';
    await http().post('/api/auth/signup/phone').send({ email: 'heba@x.eg', emailCode: wrong, phone: '+201600000099' }).expect(401);
    await http().post('/api/auth/signup/phone').send({ email: 'heba@x.eg', emailCode: code, phone: '01600000099' }).expect(400);
    const step2 = await http().post('/api/auth/signup/phone').send({ email: 'heba@x.eg', emailCode: code, phone: '+201600000099' }).expect(201);
    await http().get('/api/auth/me').set('Authorization', `Bearer ${step2.body.ticket}`).expect(401); // a ticket isn't a sign-in
    // Wrong number typed: send the WhatsApp code again to the right one.
    const step2b = await http().post('/api/auth/signup/resend').send({ ticket: step2.body.ticket, phone: '+201600000099' }).expect(201);
    const ticket = step2b.body.ticket;
    await http().post('/api/auth/signup/resend').send({ ticket: 'forged', phone: '+201600000099' }).expect(401);

    const phoneCode = whatsappCode('+201600000099')!;
    expect(phoneCode).toMatch(/^\d{6}$/);
    await http().post('/api/auth/signup/complete').send({ ticket, phoneCode: phoneCode === '000000' ? '111111' : '000000', password: 'heba-pass-1' }).expect(401);
    const done = await http().post('/api/auth/signup/complete').send({ ticket, phoneCode, password: 'heba-pass-1' }).expect(201);
    expect(done.body.user.role).toBe('PARENT');
    await http().post('/api/auth/signup/complete').send({ ticket, phoneCode, password: 'heba-pass-2' }).expect(401); // once only

    // The checked mobile replaced the school's, and the school was told.
    expect(await guardian()).toEqual(expect.objectContaining({ phone: '+201600000099', phoneVerifiedAt: expect.any(String), emailVerifiedAt: expect.any(String) }));
    const notes = (await admin.get('/api/notifications').expect(200)).body;
    expect(notes[0]).toEqual(expect.objectContaining({ type: 'parent.phoneChanged', title: 'Heba changed their mobile' }));
    expect(notes[0].body).toContain('+201600000001');

    const parent = await login(app, 'heba@x.eg', 'heba-pass-1');
    expect((await parent.get('/api/parent/children').expect(200)).body.map((c: any) => c.firstName)).toEqual(['Mona']);
  });

  it('refuses a mobile another account already uses', async () => {
    await admin.post(`/api/students/${studentId}/guardians`, { relation: 'FATHER', name: 'Amr', email: 'amr@x.eg' }).expect(201);
    await http().post('/api/auth/signup').send({ email: 'amr@x.eg' }).expect(201);
    const res = await http().post('/api/auth/signup/phone').send({ email: 'amr@x.eg', emailCode: emailCode('amr@x.eg'), phone: '+201600000777' }).expect(400);
    expect(res.body.message).toBe('This mobile number is already used by another account.');
  });

  it('signs in with email only, not the mobile number', async () => {
    await http().post('/api/auth/login').send({ login: '+201600000099', password: 'heba-pass-1' }).expect(401);
    await http().post('/api/auth/login').send({ login: 'HEBA@x.eg', password: 'heba-pass-1' }).expect(201);
  });

  it('tells a parent who already signed up to sign in instead', async () => {
    await http().post('/api/auth/signup').send({ email: 'heba@x.eg' }).expect(201);
    expect(app.get(EmailService).last('heba@x.eg')!.subject).toBe('You already have an account');
  });

  it('lets a parent change their mobile with a WhatsApp code, and tells the school', async () => {
    const parent = await login(app, 'heba@x.eg', 'heba-pass-1');
    await parent.post('/api/auth/phone', { phone: '+201600000777' }).expect(400); // someone else's
    await parent.post('/api/auth/phone', { phone: '+201600000123' }).expect(201);
    const code = whatsappCode('+201600000123')!;
    await parent.post('/api/auth/phone/verify', { phone: '+201600000123', code: code === '000000' ? '111111' : '000000' }).expect(401);
    const res = await parent.post('/api/auth/phone/verify', { phone: '+201600000123', code }).expect(201);
    expect(res.body.phone).toBe('+201600000123');
    expect((await guardian()).phone).toBe('+201600000123');
    const notes = (await admin.get('/api/notifications').expect(200)).body;
    expect(notes[0].body).toContain('+201600000123');
    await admin.post('/api/auth/phone', { phone: '+201600000124' }).expect(403); // parents only
  });

  it('resets a forgotten password with an emailed code', async () => {
    await http().post('/api/auth/password/forgot').send({ email: 'heba@x.eg' }).expect(201);
    const code = emailCode('heba@x.eg')!;
    await http().post('/api/auth/password/reset').send({ email: 'heba@x.eg', code, password: 'heba-new-pass' }).expect(201);
    await http().post('/api/auth/login').send({ login: 'heba@x.eg', password: 'heba-pass-1' }).expect(401);
    await login(app, 'heba@x.eg', 'heba-new-pass');
  });

  it('counts every guess, even when many arrive at once', async () => {
    await http().post('/api/auth/password/forgot').send({ email: 'admin@signup.eg' }).expect(201);
    const code = emailCode('admin@signup.eg')!;
    const guesses = Array.from({ length: 20 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const results = await Promise.all(guesses.map((g) => http().post('/api/auth/password/reset').send({ email: 'admin@signup.eg', code: g, password: 'whatever-1' })));
    expect(results.every((r) => r.status === 401)).toBe(true);
    await http().post('/api/auth/password/reset').send({ email: 'admin@signup.eg', code, password: 'whatever-1' }).expect(401);
  });

  it('limits how many codes one email can ask for', async () => {
    for (let i = 0; i < 4; i++) await http().post('/api/auth/password/forgot').send({ email: 'admin@signup.eg' }).expect(201);
    await http().post('/api/auth/password/forgot').send({ email: 'admin@signup.eg' }).expect(429);
    await http().post('/api/auth/signup').send({ email: 'not-an-email' }).expect(400);
  });
});
