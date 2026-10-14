// EXPLAIN (ANALYZE, BUFFERS) of the statements the audit suspects, on the seeded growth data.
// Each runs inside a transaction that is rolled back, so nothing changes.
//
//   npx ts-node --transpile-only scripts/perf/explain.ts [--full] [--json out.json]
import { PERF_DATE, PERF_TIME, PERF_URL, arg } from './env';
import { Client } from 'pg';
import { zonedTime } from '../../src/common/time';

const at = zonedTime(PERF_DATE, PERF_TIME, 'Africa/Cairo');
const dayStart = zonedTime(PERF_DATE, '00:00', 'Africa/Cairo');
const weekAgo = new Date(at.getTime() - 7 * 86_400_000);

const CASES: [string, string, unknown[]][] = [
  ['Weekly clean-up of old readings (every minute)', `DELETE FROM "Sighting" WHERE "seenAt" < $1`, [weekAgo]],
  [
    'On campus now: latest reading per band',
    `SELECT DISTINCT ON ("strapId") "strapId", "gatewayId", "seenAt" FROM "Sighting"
     WHERE "schoolId" = $1 AND "seenAt" >= $2 AND "seenAt" <= $3 AND rssi >= -85 ORDER BY "strapId", date_trunc('minute', "seenAt") DESC, rssi DESC`,
    ['ps01', dayStart, at],
  ],
  [
    'Gate arrivals of one school on one day (On campus now, left early)',
    `SELECT gp.* FROM "GatePresence" gp WHERE gp.date = $1 AND gp."studentId" IN (SELECT id FROM "Student" WHERE "schoolId" = $2)`,
    [PERF_DATE, 'ps01'],
  ],
  [
    'Left early: gate presences with a late gate reading',
    `SELECT gp.* FROM "GatePresence" gp WHERE gp.date = $1 AND gp."leftAt" IS NULL AND gp."lastGateAt" IS NOT NULL AND gp."lastGateAt" <= $2
       AND gp."studentId" IN (SELECT id FROM "Student" WHERE "schoolId" = $3 AND active)`,
    [PERF_DATE, at, 'ps01'],
  ],
  ['Follow-up alerts: unanswered absence questions (all schools)', `SELECT * FROM "AbsenceNotice" WHERE answer IS NULL AND "alertedAt" IS NULL AND "sentAt" <= $1`, [at]],
  ['Follow-up alerts: open "parents don\'t know" follow-ups (all schools, all days)', `SELECT * FROM "AttendanceException" WHERE type = 'ABSENT_UNKNOWN' AND status = 'OPEN' AND "studentId" IS NOT NULL`, []],
  [
    'Lesson in progress: is a child heard inside since the gate (once per child)',
    `SELECT count(*) FROM "Sighting" s JOIN "Strap" st ON st.id = s."strapId" WHERE st."studentId" = $1 AND s."seenAt" > $2 AND s."seenAt" <= $3 AND s."gatewayId" <> 'ps01-gw00'`,
    ['ps01-st0000', zonedTime(PERF_DATE, '08:00', 'Africa/Cairo'), at],
  ],
  [
    'Deciding a lesson: one class\'s readings in one period',
    `SELECT "strapId", "gatewayId", rssi, "seenAt" FROM "Sighting" WHERE "schoolId" = $1 AND "strapId" IN (SELECT id FROM "Strap" WHERE "studentId" IN (SELECT id FROM "Student" WHERE "classId" = $2))
       AND "seenAt" >= $3 AND "seenAt" < $4`,
    ['ps01', 'ps01-c00', zonedTime(PERF_DATE, '08:00', 'Africa/Cairo'), zonedTime(PERF_DATE, '08:45', 'Africa/Cairo')],
  ],
  ['Parent calendar: one child\'s clubs', `SELECT * FROM "ActivityEnrolment" WHERE "studentId" = $1`, ['ps01-st0040']],
  ['Trip reminders due', `SELECT * FROM "Trip" WHERE status = 'OPEN' AND "remindedAt" IS NULL AND "consentBy" > $1 AND "consentBy" <= $2`, [at, new Date(at.getTime() + 86_400_000)]],
  ['Push flush: notifications not sent yet', `SELECT * FROM "Notification" WHERE "sentAt" IS NULL ORDER BY "createdAt" LIMIT 500`, []],
  ['Students list of one school, with parents', `SELECT s.*, g.* FROM "Student" s LEFT JOIN "StudentGuardian" g ON g."studentId" = s.id WHERE s."schoolId" = $1 ORDER BY s."lastName", s."firstName"`, ['ps01']],
];

async function main() {
  const pg = new Client({ connectionString: PERF_URL });
  await pg.connect();
  const sizes = await pg.query(`
    SELECT relname AS table, n_live_tup AS rows, pg_size_pretty(pg_total_relation_size(relid)) AS total, pg_size_pretty(pg_indexes_size(relid)) AS indexes
    FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`);
  console.table(sizes.rows);

  const results: Record<string, unknown>[] = [];
  for (const [name, sql, params] of CASES) {
    await pg.query('BEGIN');
    try {
      const res = await pg.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
      const plan = res.rows[0]['QUERY PLAN'][0];
      const nodes: string[] = [];
      const walk = (n: { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: unknown[] }) => {
        if (n['Relation Name']) nodes.push(`${n['Node Type']} ${n['Relation Name']}${n['Index Name'] ? ` (${n['Index Name']})` : ''}`);
        (n.Plans as typeof n[] | undefined)?.forEach(walk);
      };
      walk(plan.Plan);
      const buffers = (plan.Plan['Shared Hit Blocks'] ?? 0) + (plan.Plan['Shared Read Blocks'] ?? 0);
      results.push({ name, ms: Math.round(plan['Execution Time'] * 10) / 10, rows: plan.Plan['Actual Rows'], pagesRead: buffers, plan: nodes.join(' > ') });
      if (process.argv.includes('--full')) console.log(name, JSON.stringify(plan.Plan, null, 1));
    } finally {
      await pg.query('ROLLBACK');
    }
  }
  console.table(results);
  const out = arg('json');
  if (out) require('fs').writeFileSync(out, JSON.stringify({ sizes: sizes.rows, results }, null, 2));
  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
