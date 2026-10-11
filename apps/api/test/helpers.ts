process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://school:school@localhost:5432/school_test';
process.env.JWT_SECRET = 'test-secret';
process.env.DISABLE_JOBS = '1';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
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
