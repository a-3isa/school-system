// Starts the API in this process against the perf database, with a counter of SQL statements.
import { PERF_URL } from './env';
process.env.PRISMA_QUERY_EVENTS = '1';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';

export type Counter = { count: number; statements: string[]; reset(): void };

export function countQueries(prisma: PrismaService): Counter {
  const c: Counter = {
    count: 0,
    statements: [],
    reset() {
      c.count = 0;
      c.statements = [];
    },
  };
  (prisma as unknown as { $on(e: 'query', cb: (ev: { query: string }) => void): void }).$on('query', (ev) => {
    c.count++;
    c.statements.push(ev.query);
  });
  return c;
}

export async function startPerfApp(listen?: number): Promise<{ app: INestApplication; prisma: PrismaService; queries: Counter }> {
  if (!PERF_URL) throw new Error('No perf database.');
  const app = configureApp(await NestFactory.create(AppModule, { logger: ['error', 'warn'] }));
  if (listen) await app.listen(listen);
  else await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, queries: countQueries(prisma) };
}

/** Milliseconds a promise took, and its result. */
export async function timed<T>(work: () => Promise<T>): Promise<[number, T]> {
  const t = performance.now();
  const r = await work();
  return [performance.now() - t, r];
}
