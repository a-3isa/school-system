// Times the minute job, step by step, at a fixed Cairo time on the seeded day, so the numbers never
// depend on when the script runs. The first minute decides the lessons that have ended (heavy); the
// next minute is the steady state. Also times the weekly clean-up of old readings on its own.
//
//   npx ts-node --transpile-only scripts/perf/tick.ts [--minutes 2] [--json out.json]
//
// It writes what the job writes (registers, follow-ups, notifications) for PERF_DATE, and first removes
// what an earlier run of this script wrote for that day, so it can be run again.
import { PERF_DATE, PERF_TIME, arg } from './env';
import { startPerfApp, timed } from './app';
import { AttendanceEvaluator } from '../../src/devices/evaluator';
import { AttendanceService } from '../../src/attendance/attendance.service';
import { ExcusesService } from '../../src/excuses/excuses';
import { TripsService } from '../../src/activities/trips';
import { NotificationsService } from '../../src/notifications/notifications';
import { dbDate } from '../../src/common/dates';
import { zonedTime } from '../../src/common/time';

async function main() {
  const { app, prisma, queries } = await startPerfApp();
  const day = dbDate(PERF_DATE);
  const seededBefore = (await prisma.notification.aggregate({ _max: { createdAt: true }, where: { id: { endsWith: ':n1' } } }))._max.createdAt!;
  await prisma.evaluatedPeriod.deleteMany({ where: { date: day } });
  await prisma.attendanceRecord.deleteMany({ where: { date: day } });
  await prisma.attendanceException.deleteMany({ where: { date: day } });
  await prisma.notification.deleteMany({ where: { createdAt: { gt: seededBefore } } });
  await prisma.absenceNotice.updateMany({ where: { date: day }, data: { alertedAt: null } });
  await prisma.gatePresence.updateMany({ where: { date: day }, data: { leftAt: null } });

  const evaluator = app.get(AttendanceEvaluator);
  const attendance = app.get(AttendanceService);
  const excuses = app.get(ExcusesService);
  const trips = app.get(TripsService);
  const notifications = app.get(NotificationsService);

  const start = zonedTime(PERF_DATE, PERF_TIME, 'Africa/Cairo');
  const minutes = Number(arg('minutes', '2'));
  const results: Record<string, unknown>[] = [];
  for (let m = 0; m < minutes; m++) {
    const now = new Date(start.getTime() + m * 60_000);
    const steps: [string, () => Promise<unknown>][] = [
      ['evaluator (all schools + clean-up)', () => evaluator.tick(now)],
      ['absence notices', () => attendance.sendAbsenceNotices(now)],
      ['apply approved excuses', () => excuses.applyApproved()],
      ['follow-up alerts', () => excuses.checkAlerts(now)],
      ['trip reminders', () => trips.remind(now)],
      ['push flush', () => notifications.flush(500, now)],
    ];
    let total = 0;
    for (const [step, run] of steps) {
      queries.reset();
      const [ms] = await timed(run);
      total += ms;
      results.push({ minute: m + 1, step, ms: Math.round(ms), queries: queries.count });
    }
    results.push({ minute: m + 1, step: 'TOTAL', ms: Math.round(total), queries: '' });
  }

  // The weekly clean-up alone: nothing is older than a week in the seed, so this is its cost every minute.
  queries.reset();
  const [purgeMs] = await timed(() => prisma.sighting.deleteMany({ where: { seenAt: { lt: new Date(start.getTime() - 7 * 86_400_000) } } }));
  results.push({ minute: '-', step: 'clean-up of old readings alone', ms: Math.round(purgeMs), queries: queries.count });

  console.table(results);
  const out = arg('json');
  if (out) require('fs').writeFileSync(out, JSON.stringify(results, null, 2));
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
