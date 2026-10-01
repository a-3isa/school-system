import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

// Brings the test database up to date and empties it before the e2e run.
// Only ever touches a database whose name ends in "_test".
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://school:school@localhost:5432/school_test';
  if (!/_test(\?|$)/.test(new URL(url).pathname + new URL(url).search)) {
    throw new Error(`Refusing to clean ${url}: the database name must end in _test.`);
  }
  execSync('npx prisma migrate deploy', { cwd: `${__dirname}/..`, env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await prisma.$disconnect();
}
