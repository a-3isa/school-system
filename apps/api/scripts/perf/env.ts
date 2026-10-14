// Shared set-up for the performance scripts in this folder. They only ever touch a database whose
// name ends in "_perf", never school_dev or school_test.
//
//   PERF_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/school_perf
// Without it, the scripts use DATABASE_URL from apps/api/.env with the database name changed to school_perf.
try {
  process.loadEnvFile(`${__dirname}/../../.env`);
} catch {
  /* no .env file: use the environment as it is */
}

function defaultUrl() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://school:school@localhost:5432/school_dev');
  url.pathname = '/school_perf';
  return url.toString();
}

export const PERF_URL = process.env.PERF_DATABASE_URL ?? defaultUrl();
if (!/_perf$/.test(new URL(PERF_URL).pathname)) {
  throw new Error(`Refusing to use ${new URL(PERF_URL).pathname.slice(1)}: the perf database name must end in _perf.`);
}
// Everything below (Prisma, the Nest app) reads DATABASE_URL.
process.env.DATABASE_URL = PERF_URL;
process.env.DISABLE_JOBS = '1';
process.env.JWT_SECRET ??= 'perf-secret-perf-secret-perf-secret-perf';

/** The seeded day and time the scripts measure at: a Thursday in term, 10:05 in Cairo. */
export const PERF_DATE = process.env.PERF_DATE ?? '2026-10-15';
export const PERF_TIME = process.env.PERF_TIME ?? '10:05';

export const PASSWORD = 'perf-pass-1';
export const gatewaySecret = (serial: string) => `perf-secret-${serial}`;

/** p50, p95, p99 and max of a list of milliseconds. */
export function percentiles(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const at = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0);
  const r = (n: number) => Math.round(n * 10) / 10;
  return { n: s.length, p50: r(at(50)), p95: r(at(95)), p99: r(at(99)), max: r(s[s.length - 1] ?? 0) };
}

export function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
