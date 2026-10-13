import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { ChatGateway } from '../src/messaging/chat.gateway';
import { Client, kid, login, ownerClient, startApp } from './helpers';

const next = <T = any>(socket: Socket, event: string, ms = 5000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no “${event}” within ${ms} ms`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Two servers on one database, as in production behind a load balancer: a message sent
// through one must reach a phone that is connected to the other.
describe('Live chat across servers (e2e)', () => {
  const prisma = new PrismaClient();
  let a: INestApplication, b: INestApplication;
  let portA: number;
  let teacherB: Client, parentB: Client;
  let teacherId: string, parentId: string, threadId: string;

  const listen = async (app: INestApplication) => {
    await app.listen(0);
    return (app.getHttpServer().address() as AddressInfo).port;
  };
  const connect = (port: number, token: string) => io(`http://127.0.0.1:${port}`, { path: '/api/socket.io', auth: { token }, transports: ['websocket'], reconnection: false });

  beforeAll(async () => {
    process.env.CHAT_ADAPTER = 'postgres';
    a = await startApp();
    b = await startApp();
    portA = await listen(a);
    await listen(b);
    const owner = await ownerClient(a, prisma, 'cluster');
    await owner.post('/api/owner/schools', { name: 'Cluster School', plan: 'COMPLETE', admin: { name: 'Admin', email: 'admin@cluster.eg', password: 'admin-pass' } }).expect(201);
    const admin = await login(a, 'admin@cluster.eg', 'admin-pass');
    teacherId = (await admin.post('/api/staff', { name: 'Hana', role: 'TEACHER', email: 'hana@cluster.eg', password: 'teacher-pass' }).expect(201)).body.id;
    const grade = (await admin.post('/api/grades', { name: 'Grade 4', order: 4 })).body;
    const classId = (await admin.post('/api/classes', { name: '4-A', gradeId: grade.id })).body.id;
    const room = (await admin.post('/api/rooms', { name: 'Room A' })).body.id;
    const math = (await admin.post('/api/subjects', { name: 'Math' })).body.id;
    const period = (await admin.post('/api/periods', { number: 1, startTime: '08:00', endTime: '08:45' })).body.id;
    await admin.put(`/api/grades/${grade.id}/subjects/${math}`, {}).expect(200);
    await admin.post('/api/timetable', { classId, dayOfWeek: 0, periodId: period, roomId: room, subjectId: math, teacherId }).expect(201);
    const studentId = (await admin.post('/api/students', { ...(await kid(admin)), code: 'CL1', firstName: 'Ali', lastName: 'Test', classId, parent: { relation: 'MOTHER', name: 'Rania', email: 'rania@cluster.eg', phone: '+20200000001', password: 'parent-pass' } }).expect(201)).body.id;
    parentId = (await prisma.user.findFirstOrThrow({ where: { email: 'rania@cluster.eg' } })).id;
    teacherB = await login(b, 'hana@cluster.eg', 'teacher-pass');
    parentB = await login(b, 'rania@cluster.eg', 'parent-pass');
    threadId = (await parentB.post(`/api/parent/children/${studentId}/threads`, { staffId: teacherId }).expect(201)).body.id;
  });

  // A server learns who else is running from their heartbeats (every 5 seconds), so right after start-up it may
  // still look only at its own sockets. In production that costs a redundant push at worst; the test waits for it.
  const knowEachOther = async () => {
    for (const app of [a, b]) {
      const adapter = app.get(ChatGateway).server.of('/').adapter as unknown as { serverCount(): Promise<number> };
      for (let i = 0; i < 100 && (await adapter.serverCount()) < 2; i++) await wait(100);
      expect(await adapter.serverCount()).toBe(2);
    }
  };

  afterAll(async () => {
    delete process.env.CHAT_ADAPTER;
    await prisma.$disconnect();
    await a.close();
    await b.close();
  });

  const notified = () => prisma.notification.count({ where: { userId: parentId, type: 'message.new' } });

  it('delivers a message sent through one server to a phone connected to the other', async () => {
    await knowEachOther();
    const parentToken = (await request(a.getHttpServer()).post('/api/auth/login').send({ login: 'rania@cluster.eg', password: 'parent-pass' }).expect(201)).body.token as string;
    const socket = connect(portA, parentToken);
    await next(socket, 'connect');
    try {
      const incoming = next(socket, 'message');
      await teacherB.post(`/api/threads/${threadId}/messages`, { body: 'Hello from the other server' }).expect(201);
      expect((await incoming).message).toEqual(expect.objectContaining({ body: 'Hello from the other server', threadId }));
      // Connected on the other server, so no notification is sent for it.
      expect(await notified()).toBe(0);

      // The teacher opening a question from the parent tells the parent's phone, on the other server.
      await parentB.post(`/api/threads/${threadId}/messages`, { body: 'A question' }).expect(201);
      const seen = next(socket, 'read');
      await teacherB.post(`/api/threads/${threadId}/read`).expect(201);
      expect(await seen).toEqual(expect.objectContaining({ threadId, readerId: teacherId }));
    } finally {
      socket.close();
    }
    await wait(500);
    await teacherB.post(`/api/threads/${threadId}/messages`, { body: 'Now offline' }).expect(201);
    expect(await notified()).toBe(1);
  });
});
