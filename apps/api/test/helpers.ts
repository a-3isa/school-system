process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://school:school@localhost:5432/school_test';
process.env.JWT_SECRET = 'test-secret';
process.env.DISABLE_JOBS = '1';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { dbDate, isoDate, weekday } from '../src/common/dates';
import { localParts, zonedTime } from '../src/common/time';
import { configureApp } from '../src/main';

export type Client = ReturnType<typeof client>;

export function client(app: INestApplication, token: string) {
  const srv = () => app.getHttpServer();
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(srv()).get(url)),
    post: (url: string, body?: object) => auth(request(srv()).post(url)).send(body),
    put: (url: string, body?: object) => auth(request(srv()).put(url)).send(body),
    patch: (url: string, body?: object) => auth(request(srv()).patch(url)).send(body),
    delete: (url: string) => auth(request(srv()).delete(url)),
    /** A multipart form without a file. */
    form: (url: string, fields: Record<string, string>) => {
      let r = auth(request(srv()).post(url));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r;
    },
    upload: (url: string, fields: Record<string, string>, file: Buffer, name = 'file.png', method: 'post' | 'put' = 'post') => {
      let r = auth(request(srv())[method](url));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file, name);
    },
  };
}

/** Starts the whole app. A test can swap parts of it (e.g. the push sender) first. */
export async function startApp(customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b) {
  const moduleRef = await customize(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

export async function login(app: INestApplication, loginId: string, password: string) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ login: loginId, password }).expect(201);
  return client(app, res.body.token);
}

/** Creates a platform owner with a unique email and signs in. */
export async function ownerClient(app: INestApplication, prisma: PrismaClient, tag: string) {
  const email = `owner-${tag}@test.eg`;
  await prisma.user.create({ data: { email, name: 'Owner', role: Role.OWNER, passwordHash: await bcrypt.hash('owner-pass', 10) } });
  return login(app, email, 'owner-pass');
}

/** What every new student needs besides a name, code and parent. Not Egyptian, so no national number. */
export const KID = { gender: 'FEMALE', dateOfBirth: '2017-03-15', nationality: 'SD' };

/** The smallest real PNG (1×1 pixel). */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** KID plus the photo and birth certificate, uploaded for one new student. */
export async function kid(c: { upload: Client['upload'] }) {
  const files: string[] = [];
  for (const kind of ['PHOTO', 'BIRTH_CERTIFICATE']) files.push((await c.upload('/api/students/files', { kind }, PNG).expect(201)).body.id);
  return { ...KID, files };
}

// ---- dates -------------------------------------------------------------------
// Suites must pass on any day and at any hour, so none of them names a calendar date: they
// ask for a week that lies ahead of the real clock, or one that is already over.

const DAY_MS = 86_400_000;

/** A date (YYYY-MM-DD) `n` days after another; `n` may be negative. */
export const addDays = (date: string, n: number) => isoDate(new Date(dbDate(date).getTime() + n * DAY_MS));

/** Today's date in Cairo. */
export const todayCairo = () => localParts(new Date(), 'Africa/Cairo').date;

/** The instant a Cairo wall-clock time falls on (daylight saving included), as an ISO string. */
export const cairoAt = (date: string, hhmm: string) => zonedTime(date, hhmm, 'Africa/Cairo').toISOString();

/**
 * A school week, Sunday to Saturday, that starts on the first Sunday at least `daysAhead`
 * days from today in Cairo. Sunday to Thursday are school days; Friday and Saturday are not.
 */
export function schoolWeek(daysAhead = 60) {
  const from = addDays(todayCairo(), daysAhead);
  const sun = addDays(from, (7 - weekday(from)) % 7);
  return { sun, mon: addDays(sun, 1), tue: addDays(sun, 2), wed: addDays(sun, 3), thu: addDays(sun, 4), fri: addDays(sun, 5), sat: addDays(sun, 6) };
}

/** A Sunday between 7 and 13 days ago. */
export function pastSunday() {
  const back = addDays(todayCairo(), -7);
  return addDays(back, -weekday(back));
}

/** One school year that covers every date a suite uses: from 2025 to 50 years from now. */
export function wideYear(extra: object = {}) {
  const end = addDays(todayCairo(), 365 * 50);
  return { name: `2025/${end.slice(0, 4)}`, startsOn: '2025-01-01', endsOn: end, ...extra };
}

