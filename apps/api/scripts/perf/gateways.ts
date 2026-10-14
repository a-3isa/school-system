// Pretends to be every smart band reader of the seeded schools at once, against a running perf API
// (scripts/perf/serve.ts). Posts the same body the ESP32 publishes over MQTT to the HTTP endpoint,
// which runs the same ingest.
//
//   npx ts-node --transpile-only scripts/perf/gateways.ts [--mode steady|heartbeat|catchup] [--seconds 60]
//     [--schools 20] [--readers 10] [--every 5] [--spread 0] [--api http://localhost:3100]
//
// steady:    classroom readers send their class's 28 bands every 5 s; the gate reader sends a few arrivals.
// heartbeat: every reader sends an empty report every 5 s (a campus with nobody in it).
// catchup:   every reader comes back after an outage at the same moment and sends 10 reports of 150 at once.
//            With --spread 30, each comes back at a random moment within 30 s and sends its reports one
//            after another, as the firmware does with its reconnect backoff.
import { arg, gatewaySecret, percentiles } from './env';

const API = arg('api', 'http://localhost:3100') + '/api/gateway/sightings';
const MODE = arg('mode', 'steady');
const SECONDS = Number(arg('seconds', '60'));
const SCHOOLS = Number(arg('schools', '20'));
const READERS = Number(arg('readers', '10'));
const EVERY = Number(arg('every', '5')) * 1000;
const SPREAD = Number(arg('spread', '0')) * 1000;
const PER_CLASS = 28;
const pad = (n: number) => String(n).padStart(2, '0');
const mac = (k: number, n: number) => `DC:0D:${pad(k)}:${pad(Math.floor(n / 100))}:${pad(n % 100)}:01`;

const ms: number[] = [];
let errors = 0;
let inFlight = 0;
let maxInFlight = 0;
let late = 0;

async function post(serial: string, sightings: object[]) {
  const auth = 'Basic ' + Buffer.from(`${serial}:${gatewaySecret(serial)}`).toString('base64');
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  const t = performance.now();
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify({ firmware: 'perf', sightings }) });
    await res.text();
    if (!res.ok) errors++;
  } catch {
    errors++;
  } finally {
    const took = performance.now() - t;
    ms.push(took);
    if (took > EVERY) late++;
    inFlight--;
  }
}

function report(k: number, g: number) {
  if (MODE === 'heartbeat') return [];
  const at = Date.now();
  if (g === 0) return Array.from({ length: 3 }, () => ({ mac: mac(k, Math.floor(Math.random() * 36 * PER_CLASS)), rssi: -60, at }));
  const cls = g - 1;
  return Array.from({ length: PER_CLASS }, (_, i) => ({ mac: mac(k, cls * PER_CLASS + i), rssi: -55 - Math.round(Math.random() * 10), at }));
}

async function main() {
  const readers: [number, number][] = [];
  for (let k = 1; k <= SCHOOLS; k++) for (let g = 0; g < READERS; g++) readers.push([k, g]);
  const started = performance.now();

  if (MODE === 'catchup') {
    const now = Date.now();
    const chunk = (k: number, g: number, c: number) =>
      post(`PERF-${pad(k)}-GW${pad(g)}`, Array.from({ length: 150 }, (_, i) => ({ mac: mac(k, ((g || 1) - 1) * PER_CLASS + (i % PER_CLASS)), rssi: -60, at: now - (c * 150 + i) * 1000 })));
    if (!SPREAD) {
      await Promise.all(readers.flatMap(([k, g]) => Array.from({ length: 10 }, (_, c) => chunk(k, g, c))));
    } else {
      await Promise.all(
        readers.map(async ([k, g]) => {
          await new Promise((r) => setTimeout(r, Math.random() * SPREAD));
          for (let c = 0; c < 10; c++) await chunk(k, g, c);
        }),
      );
    }
  } else {
    // Readers start at random moments in the first window, as real ones do.
    const timers = readers.map(([k, g]) =>
      setTimeout(() => {
        const serial = `PERF-${pad(k)}-GW${pad(g)}`;
        void post(serial, report(k, g));
        const id = setInterval(() => void post(serial, report(k, g)), EVERY);
        setTimeout(() => clearInterval(id), SECONDS * 1000);
      }, Math.random() * EVERY),
    );
    await new Promise((r) => setTimeout(r, SECONDS * 1000 + EVERY));
    timers.forEach(clearTimeout);
    while (inFlight) await new Promise((r) => setTimeout(r, 100));
  }

  const seconds = (performance.now() - started) / 1000;
  const result = { mode: MODE, readers: readers.length, requests: ms.length, perMinute: Math.round((ms.length / seconds) * 60), errors, slowerThanWindow: late, maxInFlight, ...percentiles(ms) };
  console.table([result]);
  const out = arg('json');
  if (out) require('fs').writeFileSync(out, JSON.stringify(result, null, 2));
}

void main();
