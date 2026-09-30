# School Platform

One platform for every part of school life. Product plan: [`PLAN.md`](PLAN.md).

## Repository layout

| Path | What it is |
|---|---|
| `apps/api` | Backend: NestJS + PostgreSQL (Prisma) |
| `apps/web` | Staff dashboard and owner console (Next.js), not started yet |
| `apps/parent` | Parent app (Flutter), not started yet |
| `firmware/gateway` | ESP32 BLE gateway firmware, not started yet |

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

## API so far (Phase 1, step 1)

All routes are under `/api` and need `Authorization: Bearer <token>` except login.

| Area | Routes | Who |
|---|---|---|
| Sign in | `POST /auth/login`, `GET /auth/me` | Everyone |
| Owner console | `GET/POST /owner/schools`, `GET /owner/schools/:id/modules`, `PUT /owner/schools/:id/modules/:key`, `PUT /owner/schools/:id/plan` | Platform owner |
| Modules | `GET /modules`, `PATCH /modules/:key/features` | School users; admin changes features |
| School settings | `GET/PATCH /school` (attendance mode, absence notice time, school days) | Admin edits |
| Structure | `/grades`, `/classes`, `/rooms`, `/subjects`, `/periods` | Staff read, admin writes |
| Timetable | `GET /timetable`, `GET /timetable/now?roomId=`, `POST/DELETE /timetable` | Staff read, admin writes |
| Staff | `GET/POST/PATCH /staff` | Admin |
| Students & parents | `/students`, `/students/:id/guardians` (max two, can be restricted) | Staff read, admin writes |
| Parent | `GET /parent/children` | Parents |
| Audit log | `GET /audit` | Admin |
