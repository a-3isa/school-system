# School Platform

Attendance and school–parent communication for private schools in Egypt: a NestJS API, a staff dashboard, a parent mobile app, and ESP32 readers that take attendance from BLE smart bands.

[![CI](https://github.com/a-3isa/school-system/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/a-3isa/school-system/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6.svg)

## Overview

Schools take attendance per lesson. Teachers can mark it on a classroom PC, or ESP32 readers in gates and classrooms can hear each student's BLE band and decide it automatically. Parents get the result in a Flutter app (arrival, where the child is now, every lesson) with push notifications, and the school uses the same platform for announcements, chat, grades, behaviour, clubs and trips. One deployment serves many schools: the platform owner creates schools and switches modules on per subscription.

## Features

- **Multi-school, role-based access.** Platform owner, school admin (Student Affairs), teacher, social worker and parent roles, all enforced in the API. Teachers see only their own lessons; parents see only their own children, and only after giving consent.
- **Modules per school.** Core, attendance, messaging, activities, academics and behaviour can be switched on per school; features such as automatic attendance and chat follow the subscription plan.
- **School setup.** Egyptian stages and grades, classes, rooms, subjects, bell periods, the school year with terms, breaks and holidays, and a clash-checked timetable that can be copied between classes.
- **Students and parents.** Full enrolment records with documents (checked by their bytes, size-limited), up to three guardians per student, and Excel import with a validation preview.
- **Attendance.** One register screen for manual and automatic schools, class-away marking, exceptions for staff to follow up, absence notices to parents at a set time, and excuses with attachments.
- **Automatic attendance (BLE).** Readers report over MQTT (TLS) or HTTP with per-device secrets; the API decides each lesson from the readings, tracks where each student was last heard, and shows a student's movements through the day.
- **Messaging.** Announcements with audiences and attachments, parent–teacher chat over Socket.IO, polls and meetings.
- **Academics and behaviour.** Assessments, a gradebook, grade bands and printable report cards; behaviour notes by category.
- **Activities.** Clubs with places and waiting lists, events with photos, and trips with parent permission.
- **Parent sign-up.** Email code, then a WhatsApp code for the mobile, then a password. Codes expire, are single-use and rate-limited, and responses don't reveal whether an email is registered.
- **Audit log** of every change, with who made it and when.
- **English and Arabic** in the dashboard and the parent app, with right-to-left layout and light and dark themes.

## Architecture

```mermaid
flowchart LR
  subgraph Clients
    W["Staff dashboard<br/>Next.js"]
    P["Parent app<br/>Flutter"]
  end
  G["ESP32 readers<br/>BLE scan"] -- "MQTT over TLS" --> B[("MQTT broker")]
  G -. "HTTP fallback<br/>POST /api/gateway/sightings" .-> A
  B -- "login and topic checks" --> A
  B -- "readings" --> A
  W -- "REST + Socket.IO" --> A["API<br/>NestJS"]
  P -- "REST + Socket.IO" --> A
  A --> D[("PostgreSQL<br/>Prisma")]
  A --> F["Firebase Cloud Messaging"]
  A --> E["SMTP"]
  A --> WA["WhatsApp Cloud API"]
```

- **API** (`apps/api`): one NestJS app with a module per area. A global guard checks every request's token against the database (so deactivating an account or "sign out everywhere" takes effect at once), then the route's role and the school's module. A once-a-minute job decides lessons from readings, sends absence notices and follow-up alerts, and delivers push notifications.
- **Dashboard** (`apps/web`): Next.js app router, plain CSS, no UI framework.
- **Parent app** (`apps/parent`): one app for every school; Android, iOS and web.
- **Firmware** (`firmware/gateway`): PlatformIO project for the ESP32; the reading logic is unit-tested on the host.

## Tech stack

| Area | Technology |
|---|---|
| Backend | Node.js 22, NestJS 11, TypeScript, class-validator, Socket.IO, MQTT.js, Helmet |
| Data | PostgreSQL 16, Prisma 6 (migrations in `apps/api/prisma/migrations`) |
| Dashboard | Next.js 15, React 19 |
| Mobile | Flutter (Dart 3.6+), Firebase Cloud Messaging |
| Firmware | ESP32, PlatformIO, NimBLE-Arduino, PubSubClient, ArduinoJson |
| Integrations | Firebase Admin, Nodemailer (SMTP), WhatsApp Cloud API, ExcelJS |
| Tooling | npm workspaces, Jest, Supertest, Vitest, Testing Library, GitHub Actions, Dependabot |

## Getting started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 22 (see `.nvmrc`) |
| PostgreSQL | 16 |
| Flutter | Dart 3.6 or newer (parent app only) |
| PlatformIO | firmware only |

### Install and configure

```bash
git clone https://github.com/a-3isa/school-system.git
cd school-system
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Create a database user and two databases (`school_dev` to work in, `school_test` for the tests, which empty it):

```sql
CREATE ROLE school LOGIN PASSWORD 'school' CREATEDB;
CREATE DATABASE school_dev OWNER school;
CREATE DATABASE school_test OWNER school;
```

### Environment variables (`apps/api/.env`)

| Name | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://school:school@localhost:5432/school_dev` |
| `JWT_SECRET` | Yes | Signs login tokens. The API won't start without it; in production it must be at least 32 characters | a long random string |
| `PORT` | No | HTTP port (default `3000`) | `3000` |
| `NODE_ENV` | Production | `production` makes `CORS_ORIGINS`, a long `JWT_SECRET` and `MQTT_HOOK_SECRET` mandatory | `production` |
| `CORS_ORIGINS` | Production | Comma-separated web origins allowed to call the API; empty in development allows `localhost` | `https://school.example.com` |
| `DISABLE_JOBS` | No | `1` stops the once-a-minute job on this server | `1` |
| `CHAT_ADAPTER` | No | `postgres` when more than one API server runs, so live chat reaches every server | `postgres` |
| `SMTP_URL`, `EMAIL_FROM` | No | Email for sign-up and password codes; empty prints them in the log | `smtps://user:pass@smtp.example.com` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_OTP_TEMPLATE` | No | WhatsApp Cloud API for mobile codes; empty prints them in the log | `verify_code` |
| `FIREBASE_SERVICE_ACCOUNT` | No | Path to, or JSON of, a Firebase service account for push | `./firebase-sa.json` |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | No | Broker the readers publish to; without it readers use HTTP only | `mqtts://broker.example.com:8883` |
| `MQTT_HOOK_SECRET` | Production, with MQTT | Shared secret the broker sends to the API's auth hooks | a random string |

The dashboard reads `NEXT_PUBLIC_API_URL` from `apps/web/.env.local` (default `http://localhost:3000/api`).

### Database, seed and run

```bash
cd apps/api
npx prisma migrate dev                                        # create the tables
OWNER_EMAIL=you@example.com OWNER_PASSWORD=choose-one npm run seed   # the platform owner account
npm run start:dev                                             # http://localhost:3000/api
```

Optional demo school (two classes, timetable, parents, readers and bands; signs in as `admin@demo.school` / `demo-admin-1`), with the API running:

```bash
OWNER_EMAIL=you@example.com OWNER_PASSWORD=choose-one npx ts-node scripts/demo.ts
```

Then, from the repository root:

```bash
npm run web:dev                                               # dashboard on http://localhost:3001
cd apps/parent && flutter pub get && flutter run -d chrome --dart-define=API_URL=http://localhost:3000/api
```

On Windows PowerShell, set variables first: `$env:OWNER_EMAIL="you@example.com"; $env:OWNER_PASSWORD="choose-one"`, then run the command without the prefix.

A step-by-step walkthrough, including a simulated reader (`scripts/simulate-gateway.ts`) and what to check as each role, is in [docs/TESTING.md](docs/TESTING.md).

## API

All routes are under `/api` and need `Authorization: Bearer <token>` unless marked public. There is no Swagger document; DTOs in each module define the request bodies, and unknown fields are rejected.

| Area | Main routes | Access |
|---|---|---|
| Auth | `POST /auth/login`, `/auth/signup`, `/auth/signup/phone`, `/auth/signup/resend`, `/auth/signup/complete`, `/auth/password/forgot`, `/auth/password/reset` | Public |
| Session | `GET /auth/me`, `POST /auth/sign-out-everywhere`; `POST /auth/phone`, `/auth/phone/verify` | Signed in; phone routes parents only |
| Owner console | `/owner/schools`, `/owner/schools/:id/modules`, `/owner/schools/:id/plan`, `/owner/gateways` | Owner |
| School settings and structure | `/school`, `/grades`, `/classes`, `/rooms`, `/subjects`, `/periods`, `/timetable`, `/modules` | Staff read, admin writes |
| Staff | `/staff` | Admin (teachers read their own profile) |
| Students and parents | `/students`, `/students/import`, `/parents` | Admin writes; school-wide staff read |
| Attendance | `/attendance/...`, `/attendance/exceptions` | Teachers (own lessons), admins, school-wide staff |
| Readers and bands | `/devices/...`, `/locations` | Admin; school-wide staff read locations |
| Reader ingest | `POST /gateway/sightings` (HTTP Basic), `POST /gateway/mqtt/auth`, `/gateway/mqtt/acl` | Readers and the MQTT broker |
| Messaging | `/announcements`, `/threads`, `/polls`, `/meetings` | Staff; parents through `/parent/...` and chat threads |
| Academics and behaviour | `/academics/...`, `/academics/report-cards`, `/behaviour` | Teachers, admins, social workers |
| Activities | `/activities`, `/events`, `/trips` | Staff; admin writes |
| Excuses | `/excuses`; parents submit through `/parent/children/:id/excuses` | Admin |
| Parent | `/parent/children`, `/parent/children/:id/...`, `/parent/announcements`, `/parent/polls`, `POST /parent/consent` | Parents |
| Notifications | `/notifications` | Signed in; device registration parents only |
| Audit | `GET /audit` | Admin |

Live chat uses Socket.IO on the same server; the connection authenticates with the same token.

## Project structure

```
apps/
  api/                  NestJS API
    prisma/             schema, migrations, seed
    scripts/            demo school, reader simulator, performance scripts
    src/
      auth/             login, sign-up codes, global access guard, login throttling
      attendance/       registers, absence notices, the once-a-minute job
      devices/          readers, bands, ingest (HTTP/MQTT), lesson evaluator, locations
      messaging/        announcements, chat (Socket.IO), polls, meetings
      academics/        assessments, grades, report cards
      activities/       clubs, events, trips
      students/         students, guardians, documents, Excel import
      setup/            school structure, calendar, timetable copy
      ...               behaviour, excuses, notifications, platform modules, audit
    test/               e2e tests against PostgreSQL
  web/                  Next.js staff dashboard and owner console
  parent/               Flutter parent app
firmware/gateway/       ESP32 reader firmware (PlatformIO)
docs/                   system description, testing guide, operations, push, performance
```

## Testing

```bash
npm run lint                                   # TypeScript typecheck of API and dashboard
npm test -w apps/api                           # API unit tests (Jest)
npm run test:e2e -w apps/api                   # API e2e tests (Jest + Supertest) against TEST_DATABASE_URL
npm test -w apps/web                           # dashboard tests (Vitest + Testing Library)
cd apps/parent && flutter analyze && flutter test
cd firmware/gateway && pio test -e native      # firmware logic on the host
```

The e2e suite runs the real app against PostgreSQL and covers authentication and security rules, parent sign-up, school structure, timetable copying, imports, manual and automatic attendance, locations, excuses, messaging and chat (including across two servers), academics, behaviour, activities, trips, events, plan features and push. `TEST_DATABASE_URL` defaults to `postgresql://school:school@localhost:5432/school_test`; its name must end in `_test` because the tests empty it.

CI runs all of the above on every push to `main` and every pull request, and also checks that the Prisma migrations produce exactly the schema in `schema.prisma` and that dashboard pages stay within a JavaScript and font size budget.

## Security notes

- **Authentication:** email and password (bcrypt). Tokens are JWTs that last 7 days for staff and 30 for parents; every request re-reads the account, so deactivation, role changes, password resets and "sign out everywhere" apply immediately.
- **Authorisation:** a global guard denies by default; routes declare their roles and module, and school routes take the school from the signed-in account, never from the request.
- **Abuse limits:** failed logins are throttled per account, and per account from each address; verification codes are hashed, expire after 15 minutes, lock after 5 wrong tries and are limited to 5 an hour per target.
- **Input:** global validation with whitelisting rejects unknown fields; raw SQL uses Prisma's parameterised templates; uploads are size-limited and their type is checked from the bytes (no SVG).
- **Readers:** each reader has its own secret, compared in constant time; the MQTT broker's auth hooks require a shared secret in production.
- **Secrets:** none are committed. Configuration comes from the environment (`apps/api/.env`, ignored by git). The Firebase keys in `apps/parent` are public client identifiers. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Limitations and roadmap

- The firmware compiles and its logic is tested, but it has not yet run on real hardware; detection thresholds need tuning in real rooms.
- Push notifications are wired to Firebase but not yet tried on a real phone; iOS also needs an APNs key.
- Email and WhatsApp codes are only logged until SMTP and a WhatsApp Business account are configured.
- No production hosting, domain or MQTT broker is set up yet ([docs/OPERATIONS.md](docs/OPERATIONS.md) lists what a deployment needs).
- Transport, canteen, payments, homework and admissions modules are planned but not built. The product plan is in [PLAN.md](PLAN.md).

## License and author

All rights reserved. No licence is granted to use, copy or redistribute this code. Built by Ahmed Ibrahim Hussien ([a-3isa](https://github.com/a-3isa)).
