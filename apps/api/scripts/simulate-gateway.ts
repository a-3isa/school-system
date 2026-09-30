// Pretends to be a gateway so the system can be tried without hardware.
//
//   npx ts-node scripts/simulate-gateway.ts --serial NV-GW-0001 --secret <secret> \
//     --macs DC:0D:30:00:00:01,DC:0D:30:00:00:02 [--rssi -60] [--every 5] [--api http://localhost:3000]
//
// Sends every strap once per interval to the HTTP endpoint, the same body the
// ESP32 publishes over MQTT.
const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const api = args.api ?? 'http://localhost:3000';
const macs = (args.macs ?? '').split(',').filter(Boolean);
if (!args.serial || !args.secret || !macs.length) {
  console.error('Usage: --serial <serial> --secret <secret> --macs <mac,mac,...> [--rssi -60] [--every 5] [--api url]');
  process.exit(1);
}
const rssi = Number(args.rssi ?? -60);
const every = Number(args.every ?? 5) * 1000;
const auth = 'Basic ' + Buffer.from(`${args.serial}:${args.secret}`).toString('base64');

async function send() {
  const sightings = macs.map((mac) => ({ mac, rssi: rssi + Math.round(Math.random() * 6 - 3), at: Date.now() }));
  const res = await fetch(`${api}/api/gateway/sightings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({ firmware: 'simulator', sightings }),
  });
  console.log(new Date().toISOString(), res.status, await res.text());
}

void send();
setInterval(() => void send(), every);
