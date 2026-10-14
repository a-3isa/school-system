// Runs the API on the perf database, without the minute job, for the load scripts.
//
//   npx ts-node --transpile-only scripts/perf/serve.ts [--port 3100]
import { arg } from './env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';

async function main() {
  const port = Number(arg('port', '3100'));
  const app = configureApp(await NestFactory.create(AppModule, { logger: ['error', 'warn'] }));
  await app.listen(port);
  console.log(`Perf API on http://localhost:${port}/api`);
}

void main();
