// Pretends to be a gateway so the system can be tried without hardware.
//
//   npx ts-node scripts/simulate-gateway.ts --serial NV-GW-0001 --secret <secret> \
//     --macs DC:0D:30:00:00:01,DC:0D:30:00:00:02 [--rssi -60] [--every 5] [--api http://localhost:3000]
//
// Sends every strap once per interval to the HTTP endpoint, the same body the
// ESP32 publishes over MQTT.
//
// With --mqtt mqtt://localhost:1883 it goes the way a real gateway does instead: it logs in to
// the broker with its serial and secret and publishes to gw/<serial>/sightings
// (see dev/mqtt/compose.yml). --topic publishes somewhere else, to check the broker refuses it.
import { connect } from 'mqtt';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const api = args.api ?? 'http://localhost:3000';
const macs = (args.macs ?? '').split(',').filter(Boolean);
if (!args.serial || !args.secret || !macs.length) {
  console.error('Usage: --serial <serial> --secret <secret> --macs <mac,mac,...> [--rssi -60] [--every 5] [--api url | --mqtt url [--topic t]]');
  process.exit(1);
}
const rssi = Number(args.rssi ?? -60);
const every = Number(args.every ?? 5) * 1000;
const auth = 'Basic ' + Buffer.from(`${args.serial}:${args.secret}`).toString('base64');

function body() {
  const sightings = macs.map((mac) => ({ mac, rssi: rssi + Math.round(Math.random() * 6 - 3), at: Date.now() }));
  return JSON.stringify({ firmware: 'simulator', sightings });
}

async function send() {
  const res = await fetch(`${api}/api/gateway/sightings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: body(),
  });
  console.log(new Date().toISOString(), res.status, await res.text());
}

if (args.mqtt) {
  const topic = args.topic ?? `gw/${args.serial}/sightings`;
  const client = connect(args.mqtt, { username: args.serial, password: args.secret, clientId: `sim-${args.serial}`, reconnectPeriod: 0 });
  client.on('error', (e) => {
    console.error('Broker refused:', e.message);
    process.exit(1);
  });
  client.on('connect', () => {
    console.log(`Connected to ${args.mqtt}, publishing to ${topic}`);
    const publish = () =>
      client.publish(topic, body(), { qos: 1 }, (e) => console.log(new Date().toISOString(), e ? `failed: ${e.message}` : 'sent'));
    publish();
    setInterval(publish, every);
  });
} else {
  void send();
  setInterval(() => void send(), every);
}
