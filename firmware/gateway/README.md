# Gateway firmware (ESP32)

Listens for student straps (FSC-BP107D BLE beacons) and publishes what it hears to
MQTT topic `gw/<serial>/sightings` every few seconds. The platform turns these reports
into arrivals and lesson attendance. Same firmware for gate and classroom gateways;
what a gateway *is* (gate, room) is set when the school claims it on the dashboard.

> Status: compiles in CI (GitHub Actions builds it on every pull request). Not yet run
> on real hardware.

## Build and flash

```bash
pip install platformio
cd firmware/gateway
pio run                 # compile
pio run -t upload       # flash over USB
pio device monitor      # serial console at 115200
```

## Set up a gateway

1. In the owner console, register the gateway's serial. You get a **claim code** (for the
   label) and a **secret** (shown once).
2. On the serial console:
   ```
   set ssid SchoolWiFi
   set pass ********
   set serial NV-GW-0001
   set secret <secret from step 1>
   set mqttHost mqtt.example.com
   set mqttPort 8883
   save
   reboot
   ```
   `show` prints the settings; `help` lists them all (`prefix`, `minRssi`, `reportMs`).
3. The school admin claims it on the Devices screen with the claim code and picks the
   gate or room.

## What it sends

```json
{"firmware":"1.0.0","sightings":[{"mac":"DC:0D:30:AA:4A:11","rssi":-61,"at":1759212000000,"battery":82}]}
```

- One entry per strap per report window: its loudest reading and when it happened.
- `at` is milliseconds since 1970 (time from NTP); left out until the clock is set.
- `battery` comes from Eddystone-TLM frames if the strap is configured to send them.
- An empty `sightings` list is sent when nothing was heard, as a heartbeat.
- Up to 1,500 readings are kept while the network is down and sent when it's back.

## Desk test with two ESP32s

One ESP32 runs this firmware; the other runs `firmware/fake-strap` and pretends to be a
student's band. Everything else runs on your computer. The broker asks the API to check every
login and topic, as it will in production; only TLS is left out.

```
fake strap ──Bluetooth──► gateway ──Wi-Fi, MQTT──► broker (Docker) ──► API ──► dashboard
```

**1. API and demo school.** Follow `docs/TESTING.md` up to the demo school; keep the gateway
secrets it prints. Add to `apps/api/.env`, then restart the API (it must be on port 3000):

```
MQTT_URL=mqtt://localhost:1883
MQTT_USERNAME=api
MQTT_PASSWORD=dev-api-password
MQTT_HOOK_SECRET=dev-hook-secret
```

**2. Broker.** From the repo root: `docker compose -f dev/mqtt/compose.yml up -d`. The API log
shows `[MQTT] Connected to mqtt://localhost:1883` within a few seconds (one `Not authorized`
before it is normal while the broker first reaches the API).

**3. Check it without boards.** From `apps/api`:

```bash
npx ts-node scripts/simulate-gateway.ts --mqtt mqtt://localhost:1883 \
  --serial DEMO-GATE-A --secret <its secret> --macs DC:0D:30:00:00:00
```

It prints `sent` every 5 s. A wrong secret prints `Broker refused`.

**4. Let the ESP32 in.** Find your computer's Wi-Fi address (`ipconfig`, "IPv4 Address"), and
allow the broker port through the firewall once, in PowerShell as administrator:

```powershell
New-NetFirewallRule -DisplayName "School MQTT dev broker" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow -Profile Private
```

The ESP32 and the computer must be on the same Wi-Fi.

**5. Flash the gateway with the development build** (the normal build refuses plain MQTT):

```bash
pio run -e esp32dev-plain -t upload
pio device monitor
```

Then on the console, using a demo gateway (`DEMO-GATE-A` is the school gate):

```
set ssid <your Wi-Fi>
set pass <Wi-Fi password>
set serial DEMO-GATE-A
set secret <its secret>
set mqttHost <your computer's address, e.g. 192.168.1.20>
set mqttPort 1883
set mqttTls off
save
reboot
```

It prints `MQTT connected`. If your computer's address changes, set `mqttHost` again.

**6. Fake strap.** Flash `firmware/fake-strap` (see its README) with `mac DC:0D:30:00:00:00`,
a band the demo school already gave a student, and power it near the gateway. On a school day,
the student shows under **On campus now** within a few seconds. Press the strap's BOOT button
to take it off air.

**Stop the broker:** `docker compose -f dev/mqtt/compose.yml down`.

## Before production

- Point the broker's login and topic checks at the API, and have it send a shared secret. With EMQX this is the HTTP authentication and authorisation sources: `POST https://<api>/api/gateway/mqtt/auth` and `.../mqtt/acl`, with the header `x-hook-secret: <the value of MQTT_HOOK_SECRET in apps/api/.env>`. The API refuses these checks without that header in production, so nobody else can ask it which gateway secrets are right. The API's own broker account (`MQTT_USERNAME` and `MQTT_PASSWORD`) is recognised only when both are set.
- The gateway checks the broker's certificate against `src/ca_cert.h` (Let's Encrypt roots by default). If the broker's certificate comes from another authority, put that authority's root there. Plain MQTT (`mqttTls off`) only works in a development build made with `-DALLOW_PLAIN_MQTT`.
- Check the FSC-BP107D's MAC prefix and set `prefix` to match (default `DC:0D:30`).
- Tune `minRssi` and the report interval against real rooms.
- Over-the-air updates and the bus device (GPS + 4G) come in Phase 2.
