# School Platform

One platform for every part of school life. Product plan: [`PLAN.md`](PLAN.md).

## Repository layout

| Path | What it is |
|---|---|
| `apps/api` | Backend: NestJS + PostgreSQL (Prisma) |
| `apps/web` | Staff dashboard and owner console (Next.js) |
| `apps/parent` | Parent app (Flutter), see its README |
| `firmware/gateway` | ESP32 BLE gateway firmware, see its README |

## Running the API locally

Needs Node 22 and PostgreSQL 16.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL and JWT_SECRET
cd apps/api
npx prisma migrate dev                      # create the tables
OWNER_EMAIL=you@example.com OWNER_PASSWORD=choose-one npm run seed
npm run start:dev                           # http://localhost:3000/api
```

Tests:

```bash
npm test -w apps/api          # unit tests
npm run test:e2e -w apps/api  # API tests against the database named in TEST_DATABASE_URL
                              # (default postgresql://school:school@localhost:5432/school_test;
                              #  the name must end in _test because the tests empty it)
```

## Try the whole system locally

```bash
# 1. API with a demo school
cd apps/api
npx prisma migrate dev
OWNER_EMAIL=you@example.com OWNER_PASSWORD=choose-one npm run seed
npm run start:dev                                   # http://localhost:3000/api
OWNER_EMAIL=you@example.com OWNER_PASSWORD=choose-one npx ts-node scripts/demo.ts
#   prints the demo gateways' secrets; sign in as admin@demo.school / demo-admin-1
#   On a school day it also plays today so far (arrivals, lessons, one absent child per class)
#   and switches the school to automatic attendance. To play a day again on an existing
#   demo school: npx ts-node scripts/demo-day.ts (same OWNER_EMAIL / OWNER_PASSWORD)

# 2. Staff dashboard
npm run dev -w apps/web                             # http://localhost:3001

# 3. Pretend to be a gateway (use a secret printed by the demo script)
npx ts-node scripts/simulate-gateway.ts --serial DEMO-R204 --secret <secret> \
  --macs DC:0D:30:00:00:00,DC:0D:30:00:00:01

# 4. Parent app (demo parents: +20100100000N, password demo-parent-1, or a WhatsApp
#    code, which is printed in the API log while WhatsApp isn't configured)
cd apps/parent && flutter run -d chrome --dart-define=API_URL=http://localhost:3000/api
```

On Windows the `NAME=value command` form doesn't work. Set the values first, in the same window:

```bat
:: Command Prompt
set OWNER_EMAIL=you@example.com
set OWNER_PASSWORD=choose-one
npm run seed
npx ts-node scripts/demo.ts
```

```powershell
# PowerShell
$env:OWNER_EMAIL="you@example.com"; $env:OWNER_PASSWORD="choose-one"
npm run seed
npx ts-node scripts/demo.ts
```

If the simulator answers `401 Unknown gateway or wrong secret`, sign in as the owner, open
Gateways, press **New secret** on that gateway and use the secret it shows.

The parent app needs Flutter with Dart 3.6 or newer (`flutter --version`).

## Phase 1 status

| Part | State |
|---|---|
| Core: schools, module switchboard, roles, students and parents, timetable, audit log | Done, tested |
| Manual attendance (classroom PC), trips, absence notices | Done, tested |
| Automatic attendance: gateways, straps, sightings (HTTP and MQTT), lesson decisions, exceptions | Done, tested with simulated gateways |
| Where students are: live place of every child (loudest gateway), a student's movements through the day | Done, tested with simulated gateways |
| Sign-in codes by WhatsApp | Done; needs WhatsApp Business credentials to send for real |
| Excel import | Done, tested |
| Staff dashboard | Done, clicked through in a browser |
| Parent app | Done; push notifications via Firebase still to add |
| Gateway firmware | Written; compiled by CI, not yet run on hardware |

## API routes

All routes are under `/api` and need `Authorization: Bearer <token>` except login.

| Area | Routes | Who |
|---|---|---|
| Sign in | `POST /auth/login`, `POST /auth/code`, `POST /auth/code/verify` (WhatsApp), `GET /auth/me` | Everyone |
| Owner console | `GET/POST /owner/schools`, `GET /owner/schools/:id/modules`, `PUT /owner/schools/:id/modules/:key`, `PUT /owner/schools/:id/plan` | Platform owner |
| Modules | `GET /modules`, `PATCH /modules/:key/features` | School users; admin changes features |
| School settings | `GET/PATCH /school` (attendance mode, absence notice time, school days) | Admin edits |
| Structure | `/grades`, `/classes`, `/rooms`, `/subjects`, `/periods` | Staff read, admin writes |
| Timetable | `GET /timetable`, `GET /timetable/now?roomId=`, `POST/DELETE /timetable` | Staff read, admin writes |
| Staff | `GET/POST/PATCH /staff` | Admin |
| Students & parents | `/students`, `/students/:id/guardians` (max two, can be restricted) | Staff read, admin writes |
| Import | `GET /students/import/template`, `POST /students/import(?preview=true)` | Admin |
| Attendance | `/attendance/my-lessons`, `/attendance/classes/:classId/periods/:periodId`, `/attendance/summary`, `/attendance/aways`, `/attendance/exceptions` | Teachers and admins |
| Locations | `/locations`, `/locations/students/:id?date=` | School staff |
| Devices | `/devices/gateways`, `/devices/gateways/claim`, `/devices/straps`, `/devices/rules`; owner: `/owner/gateways` | Admin / owner |
| Gateways | `POST /gateway/sightings` (Basic auth), `POST /gateway/mqtt/auth`, `POST /gateway/mqtt/acl` | Gateways, MQTT broker |
| Notifications | `GET /notifications`, `POST /notifications/:id/read` | Everyone |
| Parent | `GET /parent/children`, `GET /parent/children/:id/attendance`, `POST /parent/consent` | Parents |
| Audit log | `GET /audit` | Admin |
