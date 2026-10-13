import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client, login, ownerClient, startApp } from './helpers';

describe('Plan features (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let owner: Client;

  const make = async (tag: string, plan: 'ESSENTIALS' | 'SMART' | 'COMPLETE') => {
    const school = (await owner.post('/api/owner/schools', { name: `Plan ${tag}`, plan, admin: { name: 'Admin', email: `admin@${tag}.plan.eg`, password: 'admin-pass' } }).expect(201)).body;
    return { id: school.id as string, admin: await login(app, `admin@${tag}.plan.eg`, 'admin-pass') };
  };
  const me = async (c: Client) => (await c.get('/api/auth/me').expect(200)).body;

  beforeAll(async () => {
    app = await startApp();
    owner = await ownerClient(app, prisma, 'plan');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('gives Essentials and Smart announcements only, and Complete the full Messaging', async () => {
    const off = { chat: false, polls: false, meetings: false };
    expect((await me((await make('ess', 'ESSENTIALS')).admin)).features.messaging).toEqual(off);
    expect((await me((await make('smart', 'SMART')).admin)).features.messaging).toEqual(off);
    const complete = await me((await make('full', 'COMPLETE')).admin);
    expect(complete.features.messaging).toEqual({ chat: true, polls: true, meetings: true });
    expect(complete.features.activities).toEqual({ paidActivities: false, trips: true, events: true });
    expect(complete.features.behavior).toEqual({ merits: true });
    // Only enabled modules are listed.
    expect(Object.keys(complete.features).sort()).toEqual([...complete.modules].sort());
  });

  it('lists, and switches on, only the modules that are built', async () => {
    const built = ['academics', 'activities', 'attendance', 'behavior', 'core', 'messaging'];
    const smart = await make('smartmods', 'SMART');
    expect([...(await me(smart.admin)).modules].sort()).toEqual(['attendance', 'core', 'messaging']);
    const full = await make('fullmods', 'COMPLETE');
    const profile = await me(full.admin);
    expect([...profile.modules].sort()).toEqual(built);
    expect(Object.keys(profile.features).sort()).toEqual(built);
    // Not even the switch for clinic visits shows, though its saved value stays.
    expect(profile.features.behavior).toEqual({ merits: true });
    const listed = (await full.admin.get('/api/modules').expect(200)).body;
    expect(listed.map((m: any) => m.key).sort()).toEqual(built);
    expect(listed.find((m: any) => m.key === 'behavior').features).toEqual({ merits: true });
    const row = (await owner.get('/api/owner/schools').expect(200)).body.find((s: any) => s.id === full.id);
    expect([...row.modules].sort()).toEqual(built);
    const ownerView = (await owner.get(`/api/owner/schools/${full.id}/modules`).expect(200)).body;
    expect(ownerView.map((m: any) => m.key).sort()).toEqual(built);
    const clinic = await full.admin.patch('/api/modules/behavior/features', { features: { clinic: false } }).expect(400);
    expect(clinic.body.message).toBe('Unknown feature: clinic.');
  });

  it('lets only the platform owner switch a subscription feature', async () => {
    const { id, admin } = await make('own', 'ESSENTIALS');
    const res = await admin.patch('/api/modules/messaging/features', { features: { chat: true } }).expect(403);
    expect(res.body.message).toBe('This comes with the subscription. Ask the platform owner.');
    expect((await me(admin)).features.messaging.chat).toBe(false);

    await owner.patch(`/api/owner/schools/${id}/modules/messaging/features`, { features: { chat: true } }).expect(200);
    expect((await me(admin)).features.messaging.chat).toBe(true);
    // Features that aren't part of the subscription stay the school's own to switch.
    await admin.patch('/api/modules/attendance/features', { features: { leaveEarlyAlerts: false } }).expect(200);
  });

  it('applies the new plan’s features when the plan changes, and keeps the school’s own choices', async () => {
    const { id, admin } = await make('chg', 'ESSENTIALS');
    await admin.patch('/api/modules/attendance/features', { features: { leaveEarlyAlerts: false } }).expect(200);

    await owner.put(`/api/owner/schools/${id}/plan`, { plan: 'COMPLETE' }).expect(200);
    let now = await me(admin);
    expect(now.features.messaging).toEqual({ chat: true, polls: true, meetings: true });
    expect(now.features.attendance.leaveEarlyAlerts).toBe(false);
    expect(now.modules).toEqual(expect.arrayContaining(['activities', 'academics', 'behavior']));

    await owner.put(`/api/owner/schools/${id}/plan`, { plan: 'ESSENTIALS' }).expect(200);
    now = await me(admin);
    expect(now.features.messaging).toEqual({ chat: false, polls: false, meetings: false });
    expect(now.features.attendance.leaveEarlyAlerts).toBe(false);
    expect(now.modules).not.toContain('academics');
  });

  it('answers a missing subscription feature with a plain message', async () => {
    const { admin } = await make('msg', 'ESSENTIALS');
    // Straps stay a separate subscription: the old wording is kept for them.
    const res = await admin.get('/api/devices/gateways');
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Smart bands and readers');
  });
});
