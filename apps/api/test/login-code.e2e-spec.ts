import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { login, ownerClient, startApp } from './helpers';
import { WhatsAppService } from '../src/auth/whatsapp';

describe('Sign-in codes by WhatsApp (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const phone = '+201300000001';
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await startApp();
    const owner = await ownerClient(app, prisma, 'otp');
    await owner.post('/api/owner/schools', { name: 'OTP School', plan: 'ESSENTIALS', admin: { name: 'A', email: 'admin@otp.eg', password: 'admin-pass' } }).expect(201);
    const admin = await login(app, 'admin@otp.eg', 'admin-pass');
    const s = await admin.post('/api/students', { code: 'O1', firstName: 'Mona', lastName: 'Ali' }).expect(201);
    await admin.post(`/api/students/${s.body.id}/guardians`, { relation: 'MOTHER', name: 'Heba', phone }).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('signs a parent in with the code sent by WhatsApp', async () => {
    await http().post('/api/auth/code').send({ phone }).expect(201);
    const code = app.get(WhatsAppService).outbox.get(phone)!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    await http().post('/api/auth/code/verify').send({ phone, code: wrong }).expect(401);
    const res = await http().post('/api/auth/code/verify').send({ phone, code }).expect(201);
    expect(res.body.user.role).toBe('PARENT');
    await http().post('/api/auth/code/verify').send({ phone, code }).expect(401); // used once only
  });

  it('answers the same for unknown numbers and sends nothing', async () => {
    const res = await http().post('/api/auth/code').send({ phone: '+201399999999' }).expect(201);
    expect(res.body.sent).toBe(true);
    expect(app.get(WhatsAppService).outbox.has('+201399999999')).toBe(false);
  });

  it('locks a code after five wrong tries', async () => {
    await http().post('/api/auth/code').send({ phone }).expect(201);
    const code = app.get(WhatsAppService).outbox.get(phone)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await http().post('/api/auth/code/verify').send({ phone, code: wrong }).expect(401);
    await http().post('/api/auth/code/verify').send({ phone, code }).expect(401);
  });

  it('limits how many codes one number can ask for', async () => {
    for (let i = 0; i < 3; i++) await http().post('/api/auth/code').send({ phone }).expect(201);
    await http().post('/api/auth/code').send({ phone }).expect(429);
    await http().post('/api/auth/code').send({ phone: '01000' }).expect(400);
  });
});
