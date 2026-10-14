// Creates the perf database and brings it up to the current migrations.
//
//   npx ts-node scripts/perf/create-db.ts           # create it if missing, then migrate
//   npx ts-node scripts/perf/create-db.ts --fresh   # drop and recreate it first (only ever the _perf database)
import { execSync } from 'child_process';
import { Client } from 'pg';
import { PERF_URL } from './env';

async function main() {
  const name = new URL(PERF_URL).pathname.slice(1);
  const admin = new URL(PERF_URL);
  admin.pathname = '/postgres';
  const pg = new Client({ connectionString: admin.toString() });
  await pg.connect();
  if (process.argv.includes('--fresh')) {
    await pg.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    console.log(`Dropped ${name}.`);
  }
  const exists = await pg.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rowCount) {
    await pg.query(`CREATE DATABASE "${name}"`);
    console.log(`Created ${name}.`);
  }
  await pg.end();
  execSync('npx prisma migrate deploy', { cwd: `${__dirname}/../..`, env: { ...process.env, DATABASE_URL: PERF_URL }, stdio: 'inherit' });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
