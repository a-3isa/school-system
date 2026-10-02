import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Client, login, ownerClient, startApp } from './helpers';
import { localParts } from '../src/common/time';
import { LocationsService } from '../src/devices/locations';

const MIN = 60_000;

describe('Where students are (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let admin: Client, parent: Client, owner: Client;
  let schoolId: string;
  const gw: Record<string, { serial: string; secret: string }> = {};
  const ids: Record<string, string> = {};
  const mac = (n: number) => `DC:0D:30:00:01:${String(n).padStart(2, '0')}`;
  const now = Date.now();
  const today = localParts(new Date(now), 'Africa/Cairo');

  const send = (key: string, sightings: object[]) =>
    request(app.getHttpServer()).post('/api/gateway/sightings').auth(gw[key].serial, gw[key].secret).send({ sightings }).expect(200);

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'loc');
    schoolId = (await owner.post('/api/owner/schools', { name: 'Location School', plan: 'SMART', admin: { name: 'Admin', email: 'admin@loc.eg', password: 'admin-pass' } }).expect(201)).body.id;
    admin = await login(app, 'admin@loc.eg', 'admin-pass');
    await admin.get('/api/locations').expect(403); // tracking comes with automatic attendance
    await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
    // School is on right now: every day is a school day and one period spans the present.
    await admin.patch('/api/school', { schoolDays: [0, 1, 2, 3, 4, 5, 6] }).expect(200);
    const hhmm = (ms: number) => localParts(new Date(ms), 'Africa/Cairo').time;
    const from = localParts(new Date(now - 60 * MIN), 'Africa/Cairo').date === today.date ? hhmm(now - 60 * MIN) : '00:00';
    const to = localParts(new Date(now + 60 * MIN), 'Africa/Cairo').date === today.date ? hhmm(now + 60 * MIN) : '23:59';
    await admin.post('/api/periods', { number: 1, startTime: from, endTime: to }).expect(201);
    const grade = (await admin.post('/api/grades', { name: 'Grade 5', order: 5 })).body;
    const cls = (await admin.post('/api/classes', { name: '5-A', gradeId: grade.id })).body.id;
    const rooms = { R1: (await admin.post('/api/rooms', { name: 'Room 101' })).body.id, R2: (await admin.post('/api/rooms', { name: 'Room 102' })).body.id };
    for (const [key, kind, name] of [['GATE', 'GATE', 'Main gate'], ['R1', 'ROOM', 'Room 101'], ['R2', 'ROOM', 'Room 102']] as const) {
      const g = (await owner.post('/api/owner/gateways', { serial: `LOC-${key}` }).expect(201)).body;
      gw[key] = g;
      await admin.post('/api/devices/gateways/claim', { claimCode: g.claimCode, name, kind, roomId: kind === 'ROOM' ? rooms[key as 'R1' | 'R2'] : undefined }).expect(201);
    }
    for (const [i, name] of ['Layla', 'Ali', 'Omar', 'Yara', 'Karim', 'Salma'].entries()) {
      ids[name] = (await admin.post('/api/students', { code: `L${i}`, firstName: name, lastName: 'Test', classId: cls, parent: { relation: 'GUARDIAN', name: 'Guardian', email: `g-L${i}@lo.test.eg` } })).body.id;
      if (name !== 'Salma') await admin.post('/api/devices/straps', { mac: mac(i), studentId: ids[name] }).expect(201);
    }
    await admin.post(`/api/students/${ids.Layla}/guardians`, { relation: 'MOTHER', name: 'Mona', email: 'p201400000001@test.eg', phone: '+201400000001', password: 'parent-pass' }).expect(201);
    parent = await login(app, 'p201400000001@test.eg', 'parent-pass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('shows where each student is now, by the loudest gateway', async () => {
    // Layla is heard by both rooms, louder in Room 101.
    await send('R1', [{ mac: mac(0), rssi: -60, at: now - 30_000 }]);
    await send('R2', [{ mac: mac(0), rssi: -80, at: now - 30_000 }]);
    await send('R2', [{ mac: mac(1), rssi: -62, at: now - 5 * MIN }]); // Ali: 5 minutes ago
    await send('R1', [{ mac: mac(2), rssi: -62, at: now - 20 * MIN }]); // Omar: not heard for 20 minutes
    await send('GATE', [{ mac: mac(3), rssi: -55, at: now - 15 * MIN }]); // Yara: last at the gate
    await send('R1', [{ mac: mac(4), rssi: -99, at: now - 10_000 }]); // Karim: too faint to count

    const res = await admin.get('/api/locations').expect(200);
    const by = Object.fromEntries(res.body.students.map((s: any) => [s.firstName, s]));
    const sameDay = (ms: number) => localParts(new Date(ms), 'Africa/Cairo').date === today.date;
    expect(by.Layla).toEqual(expect.objectContaining({ state: 'here', place: expect.objectContaining({ name: 'Room 101', room: 'Room 101' }) }));
    if (sameDay(now - 20 * MIN)) {
      expect(by.Ali).toEqual(expect.objectContaining({ state: 'recent', place: expect.objectContaining({ name: 'Room 102' }) }));
      expect(res.body.schoolHours).toBe(true);
      expect(by.Omar.state).toBe('missing');
      expect(by.Yara).toEqual(expect.objectContaining({ state: 'left', place: expect.objectContaining({ kind: 'GATE' }) }));
    }
    expect(by.Karim.state).toBe('notSeen');
    expect(by.Salma.state).toBe('noStrap');
    expect(res.body.places).toHaveLength(3);
  });

  it('tells a parent who agreed to tracking where their child is now, only with straps', async () => {
    const place = async () => (await parent.get(`/api/parent/children/${ids.Layla}/today?date=${today.date}`).expect(200)).body.place;
    expect(await place()).toBeNull(); // hasn't agreed yet
    await parent.post('/api/parent/consent').expect(201);
    expect(await place()).toEqual(expect.objectContaining({ name: 'Room 101', kind: 'ROOM' }));
    await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: false } }).expect(200);
    expect(await place()).toBeNull();
    await owner.patch(`/api/owner/schools/${schoolId}/modules/attendance/features`, { features: { automatic: true } }).expect(200);
  });

  it('stops worrying about children not heard once school is over', async () => {
    const later = new Date(now + 90 * MIN);
    // Omar was last heard 20 minutes ago: all of it has to be on the same Cairo day.
    if (localParts(later, 'Africa/Cairo').date !== today.date || localParts(new Date(now - 20 * MIN), 'Africa/Cairo').date !== today.date) return;
    const res = await app.get(LocationsService).now(schoolId, later);
    const by = Object.fromEntries(res.students.map((s) => [s.firstName, s]));
    expect(res.schoolHours).toBe(false);
    expect(by.Omar.state).toBe('away');
    expect(by.Yara.state).toBe('left');
  });

  it('gives a student’s day as visits, place by place', async () => {
    const start = now - 40 * MIN;
    if (localParts(new Date(start), 'Africa/Cairo').date !== today.date) return; // just after midnight in Cairo
    const minutes = (from: number, to: number, rssi: number) => Array.from({ length: to - from }, (_, i) => ({ mac: mac(0), rssi, at: start + (from + i) * MIN }));
    await send('R1', minutes(0, 10, -60)); // Room 101 for 10 minutes
    await send('R2', minutes(12, 20, -61)); // then Room 102
    await send('R1', minutes(12, 20, -84)); // (Room 101 still hears her faintly)
    const res = await admin.get(`/api/locations/students/${ids.Layla}?date=${today.date}`).expect(200);
    expect(res.body.map((v: any) => v.place.name)).toEqual(['Room 101', 'Room 102', 'Room 101']);
    expect(new Date(res.body[1].from).getTime()).toBe(start + 12 * MIN);
  });

  it('is for school staff only', async () => {
    await parent.get('/api/locations').expect(403);
    await admin.get(`/api/locations/students/${ids.Layla}?date=bad`).expect(400);
    await admin.get(`/api/locations/students/nope?date=${today.date}`).expect(404);
  });
});
