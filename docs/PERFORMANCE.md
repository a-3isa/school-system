# Performance audit (growth scale)

October 2026. This report asks whether the platform keeps up at the "growth" scale: 20 schools, about 20,000 students and 200 smart band readers. It covers the API, the database, the minute job, reader ingest, the dashboard, the parent app and the reader firmware. Every number below was measured unless it says otherwise. Section 7 lists what was not measured.

## Summary

Before this audit, one API process could not run a growth-scale morning:

- **The minute job.** The first minute after lessons end took **102 s**, and every later minute took about **11 s**. Absence messages and follow-up alerts went out late. Runs could also overlap and send messages twice.
- **Morning traffic.** With 2,000 parents and every dashboard open, the API answered 235 of the 352 requests offered each second. **42% of requests failed** (5,975 of 14,112), and the median wait was **20 s**. The database connection pool ran out first: the minute job and On campus now held its 13 connections.
- **Readers.** 683 of 3,000 reader reports failed. After a broker outage, all 200 readers would come back in the same second.

With the twelve fix branches in section 6 applied:

- **The minute job** takes **11 s** in the first minute and about **0.6 s** after that.
- **The same morning** has **0 errors**, a median of **11 ms** and a 95th percentile of **47 ms**.
- **Reader reports** have **0 errors** and a median of **87 ms**. A reader outage spread over 30 s comes back with no failures.

One process still saturates somewhere between one and two times the growth load. Before going past it, the platform needs the next items in the ranked list (section 5).

## 1. Method and setup

### The machine

- A laptop with an Intel i7-10750H (6 cores, 12 threads) and 16 GB of memory, on Windows.
- The API and PostgreSQL run on the same machine, so every number here includes no network time.
- Node 25 and PostgreSQL 18.6 locally. CI and production run **PostgreSQL 16**. Section 3.2 shows why that difference matters.
- Prisma's default pool: 13 connections (`num_cpus × 2 + 1`).

### The data (`apps/api/scripts/perf/seed-growth.ts`)

- 20 schools, each with:
  - 36 classes of 28 students: 1,008 students and 1,008 smart bands.
  - 10 readers: 1 at the gate and 9 in classrooms.
  - 7 periods.
  - 20 school days of registers.
  - Parents, notifications, chats, trips and an activity log.
- Readings for the whole school day before the measured day, and for that day from 08:00 to 10:05. That is **29.2 million readings, 4.9 GB, 2.8 GB of it indexes**.
  - At this rate a week of readings, which is what the clean-up keeps, is about 100 million rows and roughly 17 GB (extrapolated).
- The measured moment is **Thursday 15 October 2026, 10:05 Cairo time** (`PERF_DATE` and `PERF_TIME`). Every script runs at that fixed time, so no result depends on when it ran.
- The data lives in its own database, `school_perf`. The scripts refuse any database whose name does not end in `_perf` (`scripts/perf/env.ts`).

### The scripts (all in `apps/api/scripts/perf`, run from `apps/api`)

| Script | What it measures |
|---|---|
| `create-db.ts [--fresh]` | Creates or recreates `school_perf` and migrates it |
| `seed-growth.ts` | Fills it with the data above |
| `queries.ts --runs 5` | Each main endpoint, one user at a time: p50/p95, SQL statements, reply size |
| `tick.ts --minutes 3` | The minute job step by step, with time and statements per step |
| `explain.ts [--full]` | `EXPLAIN (ANALYZE, BUFFERS)` of the suspect statements, rolled back |
| `serve.ts --port 3100` | The API on the perf data, without the minute job, for the next two |
| `http-load.ts --seconds 60 [--scale 2]` | Parents and staff screens polling at the apps' real rates, open loop |
| `gateways.ts --mode steady\|heartbeat\|catchup [--spread 30]` | All 200 readers posting the firmware's report body |
| `apps/web: npm run bundle` | Each dashboard page's JavaScript (gzipped) and the bundled fonts |

- **Statement counts** come from Prisma's query events, which are switched on by `PRISMA_QUERY_EVENTS=1` in `PrismaService`.
- **e2e tests** use the same counts through `queriesDuring()` in `apps/api/test/helpers.ts`.
- **To run the scripts**, set `PERF_DATABASE_URL`, or let them use `DATABASE_URL` from `apps/api/.env` with the database name changed to `school_perf`.

### pg_stat_statements (for the next round)

These numbers did not need `pg_stat_statements`, but it shows the database's own view, including statements from outside Prisma. To enable it:

1. In `postgresql.conf`, set `shared_preload_libraries = 'pg_stat_statements'`.
2. Restart PostgreSQL.
3. In `school_perf`, run `CREATE EXTENSION pg_stat_statements;`.

Then `SELECT query, calls, total_exec_time, rows FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;` after a load run shows where the database spends its time.

## 2. Baseline numbers (before any fix)

### 2.1 Endpoints, one user at a time (`queries.ts`, 5 runs)

| Endpoint | p50 ms | p95 ms | Statements | Reply kB |
|---|---:|---:|---:|---:|
| Session (`/auth/me`) | 10.1 | 23.6 | 4 | 0.6 |
| Today summary | 14.2 | 40.5 | 6 | 1 |
| Register, one lesson | 13.9 | 134.5 | 12 | 6 |
| **On campus now** | **2,550** | **3,755** | 14 | **263** |
| Students list | 91.6 | 100.1 | 6 | **779** |
| Students for the band dropdown | 88.5 | 96.5 | 6 | **779** |
| Parents list | 71.6 | 77.5 | 5 | **420** |
| Timetable (whole school) | 83.6 | 97.6 | 7 | **611** |
| Behaviour summary | 27.1 | 33.5 | 7 | 108 |
| Chat threads (teacher) | 12.9 | 23.1 | 11 | 0.9 |
| Parent: child today | 20.7 | 22.1 | 16 | 0.8 |
| Parent: calendar | 18.6 | 35.7 | 15 | 0.3 |
| **Ingest: classroom reader, 28 bands** | 34.5 | 54.8 | **35** | – |
| **Ingest: gate reader, 28 bands** | 93 | 103 | **122** | – |
| Ingest: empty heartbeat | 6.3 | 8.6 | 4 | – |

The other endpoints measured were the follow-ups, staff and classes lists, trips, activities, the activity log, unread counts, the parent's notifications and threads, and the owner's schools. Each took under 20 ms at p50 and sent under 35 kB. The full table is the output of `queries.ts`.

### 2.2 The minute job (`tick.ts`, 3 minutes from 10:05)

| Step | First minute | Next minutes |
|---|---|---|
| Evaluator (all schools, plus the clean-up of old readings) | **96.0 s**, 17,614 statements | **10.1–10.7 s**, 2,203 statements |
| Absence notices | 0.16 s, 61 | 0.13 s, 61 |
| Follow-up alerts | **5.6 s**, 11,625 | 0.47 s, 912 |
| Excuses, trip reminders, push | under 0.1 s | under 0.1 s |
| **Whole minute** | **101.8 s** | **10.8–11.3 s** |

The job is meant to finish well inside its minute.

### 2.3 Load (`http-load.ts` and `gateways.ts --mode steady` together, 60 s)

The offered load was 352 requests a second:

- 2,000 parents with the app open.
- 720 classroom PCs on the register.
- 60 staff screens on Today, On campus now and the badges.

All 200 readers sent reports every 5 s at the same time.

| | Served/s | Errors | p50 | p95 | Most waiting at once |
|---|---:|---:|---:|---:|---:|
| People (before) | 235 | **5,975 of 14,112** | **19.9 s** | **39.8 s** | 5,190 |
| Readers (before) | – | **683 of 3,000** | 611 ms | 64.8 s | 607 |

The errors were Prisma pool timeouts (`P2024`): requests waited more than 10 s for one of the 13 connections.

### 2.4 Dashboard (`npm run bundle` after `next build`)

| | Before |
|---|---|
| Fonts in `public/fonts` | **2,168 kB** in 16 files: the IBM Plex sans faces are TrueType |
| Fonts a page in English downloads (Plex and Source Serif) | 1,024 kB |
| Fonts a page in Arabic downloads (Plex Arabic and Noto Naskh) | 1,281 kB |
| Largest page JavaScript before it can run | 186 kB gzipped (`/students/[id]`; `/today` 178 kB) |
| Both language dictionaries in every page | about 131 kB raw, 49 kB gzipped |
| Largest contentful paint, Today in English | 544 ms (local, warm cache, PerformanceObserver; not Lighthouse) |

### 2.5 Polling

| Client | Before |
|---|---|
| Parent app, open | 8 requests a minute on every tab, **and still 8 while in the background** |
| Dashboard tab | Badges every minute and Today every 15 s, **also in hidden tabs**: about 7 a minute per tab |
| Dashboard search boxes | One request per key pressed |

## 3. Findings by area

Each finding has:

- its file and line in the code as it was before the fixes (`perf/audit`);
- the measured cost and the gain expected or measured;
- its effort (S, M or L) and impact (High, Medium or Low).

**[migration]** means the finding needs a schema change. **[decision]** means it needs a product decision from Ahmed.

### 3.1 The minute job

**J1. The evaluator reads every raw reading into Node, one lesson at a time.** High impact, M effort. Fixed on `perf/evaluator-batch`.

- Where: `src/devices/evaluator.ts:115` (lesson readings) and `:206` (the in-lesson check). The loop over schools is at `:35`.
- Deciding one lesson reads about 15,000 readings (29.5 ms and 15,172 rows in EXPLAIN), but only the loudest reading per band per minute matters.
- Each finished lesson also read the students, marks and gate arrivals again, and wrote each mark and follow-up one at a time.
- During lessons, every minute re-read every arrived child's readings since the lesson began.
- The fix:
  - One `DISTINCT ON (strapId, minute)` query per period returns only the readings that matter.
  - The marks and follow-ups of a period are written in one insert each.
  - Children already settled are not read again.
  - Four schools are evaluated side by side.
- Measured:
  - Evaluator first minute: 96.0 s and 17,614 statements, down to **10.8 s and 1,822**.
  - Steady minute: 10.4 s and 2,203, down to **0.44–0.50 s and 1,085**.

**J2. Clearing old readings reads the whole readings table every minute on PostgreSQL 16.** High impact, S effort. Fixed on `perf/sighting-cleanup`.

- Where: `src/devices/evaluator.ts:42`, `deleteMany({ where: { seenAt: { lt: … } } })`.
- Readings are indexed on `(schoolId, seenAt)`, and a filter on `seenAt` alone cannot use that index on PostgreSQL 16.
- EXPLAIN in the PostgreSQL 16 way, with index scans switched off as 16 would plan it: **3,797 ms and 272,504 pages (about 2.1 GB) read every minute**, a cost that grows with the table.
- PostgreSQL 18 skip-scans the index, so the same delete takes 0.4 ms locally. That is why local runs hide this (see O5).
- After a pause, one statement could also delete millions of rows.
- The fix deletes each school's old readings through its index, 10,000 at a time and at most 100,000 per school per minute: 0.1 ms in EXPLAIN.

**J3. Minute runs could overlap, and one failing step stopped the rest.** High impact (messages sent twice), S effort. Fixed on `perf/job-guard`.

- Where: `src/attendance/attendance.ts:123`, a plain `setInterval(() => void this.tick(), 60_000)`.
- With a 102 s first minute, two runs ran side by side and could both send the same absence messages and reminders.
- One error, such as a bad push token, skipped every later step.
- The fix:
  - A run is skipped while the previous one is still going.
  - Each step catches and logs its own error, so the other steps still run.

**J4. Absence notices and follow-up alerts were handled one child at a time.** Medium impact, M effort. Fixed on `perf/followups-batch`.

- Where:
  - `src/attendance/attendance.service.ts:465`: each absent child is locked and messaged separately.
  - `src/excuses/excuses.ts:325` and `:298`: each overdue alert costs about 26 statements and four transactions.
  - `src/excuses/excuses.ts:328`: each open alert is then checked and closed separately.
- The fix:
  - One `INSERT … ON CONFLICT DO NOTHING RETURNING` locks a school's notices.
  - One `UPDATE … RETURNING` locks every overdue notice.
  - The follow-ups, messages and closures are written in one statement each.
  - The locks still make each message go once.
- Measured:
  - Follow-up alerts, first minute: 5.6 s and 11,625 statements, down to **0.31 s and 22**.
  - Steady minute: 0.47 s and 912, down to **0.02–0.03 s and 4**.

**J5. Every API instance runs the minute job.** High impact once there are two instances, S–M effort. **[decision]** Not fixed.

- Where: `src/attendance/attendance.ts:123`.
- The guard in J3 works within one process only. A second API process would run the whole job a second time each minute, doubling the database work and bringing back the overlap J3 removed.
- Options:
  - Run the job in one worker process only, chosen by an environment variable.
  - Or take a PostgreSQL advisory lock at the start of each run.

### 3.2 API and database

**A1. On campus now sorts the school's whole day of readings.** High impact, S effort. Fixed on `perf/locations`.

- Where: `src/devices/locations.ts:36` to `:42`, `ORDER BY "strapId", date_trunc('minute', "seenAt") DESC, "rssi" DESC` over every reading of the day.
- The same query also serves the register's last-seen column and the class-away check.
- EXPLAIN: 1,198 ms and 20,154 pages per request. The page polls every 10 s (`app/(app)/where/page.tsx:14`).
- The fix makes two index lookups per band on `(strapId, seenAt)`: first its latest minute, then the loudest reading in that minute. EXPLAIN gives the same 989 rows in 94.6 ms.
- Measured endpoint: p50 2,550 ms down to **75.5 ms**, and p95 3,755 down to **155.7 ms**.

**A2. A reader's report wrote each band one at a time.** High impact, S effort. Fixed on `perf/ingest-batch`.

- Where:
  - `src/devices/ingest.ts:94` to `:108`: one `strap.update` per band heard.
  - `src/devices/ingest.ts:130` and `:138`: at the gate, each band's recent readings and its gate presence are read separately.
- This is the platform's busiest path: 200 readers every 5 s.
- The fix:
  - One `UPDATE … FROM (VALUES …)` covers all the bands.
  - One query reads the gate readings and one reads the presences.
  - Writes still happen only for an arrival or a possible exit.
- Measured:
  - Classroom reader: 35 statements and 34.5 ms, down to **8 statements and 13 ms**.
  - Gate reader: 122 statements and 93 ms, down to **41 statements and 50.7 ms**.

**A3. Nothing compresses the API's replies.** High impact for parents on mobile data and for the dashboard on school Wi-Fi, S effort. Fixed on `perf/api-compression`.

- Where: `src/main.ts:13`; only helmet is installed.
- With gzip, measured:

  | Reply | Before | With gzip |
  |---|---:|---:|
  | Students list | 779 kB | 34 kB |
  | Timetable | 611 kB | 41 kB |
  | Parents list | 420 kB | 19 kB |
  | On campus now | 264 kB | 15 kB |
  | Behaviour summary | 108 kB | 6 kB |

- Photos, PDFs and spreadsheets are already compressed and are sent as they are.

**A4. The chat thread list fetched each thread's newest message separately.** Medium impact, S effort. Fixed on `perf/chat`.

- Where: `src/messaging/chat.ts:100`, one `findFirst` per thread, up to 200 at once for Student Affairs. One request could take the whole connection pool.
- `chat.ts:212` also checked each recipient's online status one after another.
- The fix uses one lateral query through the `(threadId, createdAt)` index, and makes the online checks together.
- Measured: a teacher's list goes from 11 statements to 10. The new e2e test shows that the old code cost one statement more per thread.

**A5. The connection pool is the first thing to run out.** High impact, S effort (configuration). **[decision]** Not fixed.

- Where: `prisma/schema.prisma:10`, where `DATABASE_URL` sets no `connection_limit`, so the pool size follows the machine's CPU count.
- Every error in the baseline load test was a pool timeout.
- After the fixes, twice the growth rate still gives 5,434 errors out of 36,598 and a median of 3.5 s. One process saturates between 1× and 2× the growth load.
- What's needed:
  - Set `connection_limit` explicitly for the production machine.
  - Plan a second API instance, which first needs J5 and a shared chat presence. The chat online check asks every instance.
  - Measure the database's CPU while doing so (not measured here).

**A6. The big lists have no paging.** Medium impact, M effort. **[decision]** Not fixed.

- Where:
  - `src/students/students.ts:117` (students list) and `:258` (students for the band dropdown).
  - `src/students/parents.ts:33` (parents list).
  - `src/timetable/timetable.ts:59` (timetable).
- Each returns the whole school: 779, 779, 420 and 611 kB, or 34–41 kB with A3.
- Compression made this tolerable. Paging or a search-first dropdown is a product choice about how these screens should work.

**A7. Readers' reports have no rate limit.** Medium impact (protection), S effort. Not fixed.

- Where: `src/devices/ingest.ts:188`, `@Post('sightings')`. MQTT arrives through the same ingest.
- A misconfigured reader (`reportMs` can go down to 1 s, `firmware/gateway/src/main.cpp:189`) or a faulty one could flood the ingest.
- A per-reader limit of, say, one report a second, with the extra reports dropped and logged, would cap that.

**A8. An empty reader still reports every 5 s.** Low to Medium impact, S effort. **[decision]** Not fixed.

- Where: `firmware/gateway/src/main.cpp:220` to `:225`. The empty report doubles as a heartbeat.
- Cost: 200 readers × 12 a minute × 4 statements, which is 9,600 statements a minute when nobody is on campus.
- A heartbeat once a minute would still be well inside the 5 minutes after which a reader counts as offline (`gatewayOfflineMinutes`, `src/devices/rules.ts:27`). Whether a silent reader should be noticed later than today is a product question.

**A9. Files are stored in PostgreSQL.** Medium impact later, L effort. **[migration] [decision]** Not fixed.

- Where: `prisma/schema.prisma`:
  - `:94` (school crest);
  - `:425` (student documents);
  - `:646`, `:843` and `:960` (chat, excuse and other attachments);
  - `:1350`.
- These make the database and its backups grow with every upload, and each download passes through the API process.
- Not measured at scale. Moving them to object storage changes the deployment, so it is a decision for later.

**A10. The readings table will want partitioning.** Medium impact later, L effort. **[migration]** Not fixed.

- At the growth rate, a week of readings is about 100 million rows and 17 GB.
- Partitioning by day would make the clean-up a matter of dropping a partition, and keep the indexes small.
- J2's batched clean-up is enough for now.

### 3.3 Dashboard

**D1. The IBM Plex fonts were TrueType.** Medium impact, S effort. Fixed on `perf/fonts-woff2`.

- Where: `apps/web/app/globals.css:8` and after, `url('/fonts/IBMPlexSans-Regular.ttf') format('truetype')`.
- The fix uses the same fonts repacked losslessly as WOFF2, with no subsetting. The SIL Open Font License allows this.
- Measured:
  - All fonts: 2,168 kB down to **854 kB**.
  - An English page's fonts: 1,024 kB down to **356 kB**.
  - An Arabic page's fonts: 1,281 kB down to **418 kB**.
- English and Arabic pages were checked by eye after the change.

**D2. Hidden tabs kept polling, and search sent a request on every key.** Medium impact, S effort. Fixed on `perf/dashboard-polling`.

- Where:
  - `apps/web/lib/hooks.ts:35` to `:38`: `useEvery` is a plain `setInterval`. Its callers include `components/Shell.tsx:116`, `:119` and `:123` and `app/(app)/today/page.tsx:32`.
  - The search boxes on the students, parents and club pages.
- The fix:
  - Polling pauses while the tab is hidden and makes one call when the tab comes back, if one is due.
  - Search waits for a 250 ms pause in typing.
  - `useApi` keeps only the latest answer, so a slow earlier answer no longer replaces newer results.
- Gain: a dashboard left open in a background tab all day sends nothing, where it used to send about 7 requests a minute.

**D3. Both language dictionaries are in every page.** Low impact, M effort. Not fixed.

- Where: `apps/web/lib/i18n.tsx:3`, `import { ar, arN, en, Dict } from './strings'`.
- This is about 49 kB gzipped of the first load. Loading only the active language would save half of it.

**D4. Pages wait for the session before they fetch.** Low impact, M effort. Not fixed.

- Where: `apps/web/lib/session.tsx:48`. Each page's data requests start only after `/auth/me` has answered, which costs one round trip on every full load.
- It hardly shows locally (10 ms). It costs more on a slow school connection.

**D5. Server messages are translated by trying each pattern in turn.** Low impact, S effort. Not measured. Not fixed.

- Where: `apps/web/lib/i18n.tsx:34` and `:384`, a linear scan of `SERVER_AR` for every message shown in Arabic.
- It is cheap at today's size. Worth indexing by the message's first word if the list grows a lot.

### 3.4 Parent app

**P1. Every tab polled, on screen or not, and also in the background.** Medium impact (server load and battery), S effort. Fixed on `perf/parent-polling`.

- Where:
  - `apps/parent/lib/screens/day.dart:38` (every 30 s).
  - `screens/home.dart:154` (every minute).
  - `screens/messages.dart:42` (every minute) and `:624` (chat, every 30 s).
- The fix: a new `Every` helper (`lib/every.dart`) skips a refresh when the app is not in front or its tab is out of view. It makes one catch-up refresh when the tab is shown again. The chat screen polls only while its socket is down.
- Measured:
  - App open: 8 requests a minute, down to **5 on the Day tab** and **6 on Messages**.
  - In the background: **0**, down from 8.
- At 2,000 open apps, that is about 6,000 fewer requests a minute in the morning peak, and more once phones go back into pockets.

### 3.5 Reader firmware

**F1. Readers retried the broker on every report, and all came back at once.** High impact (after any broker restart), M effort. Fixed on `perf/firmware-backoff`.

- Where:
  - `firmware/gateway/src/main.cpp:100`: a new TLS connection on every report while the broker is down.
  - `main.cpp:85` to `:91`: up to 15 s of every loop spent trying Wi-Fi.
- The fix:
  - Each failed try waits longer. MQTT starts at 2 s and doubles up to a minute; Wi-Fi starts at 5 s and goes up to two minutes.
  - Each wait ends at a random point in its upper half, so readers come back spread out.
  - Readings stay in the backlog meanwhile.
  - The logic is in `lib/sightings` with native tests, including the spread for 200 readers and `millis()` wrapping around.
- Measured with the API fixes applied (`gateways.ts --mode catchup`, 200 readers × 10 backlog reports):

  | Readers come back | Failed | Median |
  |---|---:|---:|
  | All at once | 613 of 2,000 | 7.9 s |
  | Spread over 30 s | **0** | **23 ms** |

### 3.6 How the work was done

**O1. Local PostgreSQL 18 hides costs that PostgreSQL 16 has.** Medium impact, S effort. Partly addressed.

- Section J2 is the example.
- `scripts/perf/explain.ts` now runs suspect statements both normally and as PostgreSQL 16 would plan them.
- Better still, run PostgreSQL 16 locally, matching CI and production.

## 4. After the fixes

All the fix branches were merged together for these runs, on the same data and machine.

| | Before | After |
|---|---|---|
| Minute job, first minute | 101.8 s | **11.2 s** |
| Minute job, steady minute | 10.8–11.3 s | **0.52–0.62 s** |
| On campus now, p50 / p95 | 2,550 / 3,755 ms | **75.5 / 155.7 ms** |
| Ingest, classroom / gate reader | 35 / 122 statements | **8 / 41 statements** |
| Load test, people: errors | 5,975 of 14,112 | **0 of 16,602** |
| Load test, people: p50 / p95 | 19.9 s / 39.8 s | **11.3 ms / 47 ms** |
| Load test, people: most waiting at once | 5,190 | **25** |
| Load test, readers: errors / p50 | 683 of 3,000 / 611 ms | **0 / 86.7 ms** |
| Load test at twice the rate, people | – | 5,434 errors of 36,598, p50 3.5 s |
| Biggest JSON replies | 779 kB | 34 kB (gzip) |
| Dashboard fonts | 2,168 kB | 854 kB |
| Parent app in the background | 8 requests a minute | 0 |

Each branch on its own, for the minute job:

| Branch | First minute | Steady minute |
|---|---|---|
| None (before) | 101.8 s | 10.8–11.3 s |
| `perf/evaluator-batch` (on `perf/sighting-cleanup`) | 17.4 s | 1.2–1.4 s |
| `perf/followups-batch` | 90.7 s | 8.8–10.9 s |
| All together | 11.2 s | 0.52–0.62 s |

## 5. Ranked list

The list is ranked by impact at growth scale, then by effort.

| # | Finding | Impact | Effort | Status |
|---:|---|---|---|---|
| 1 | J1 Evaluator reads raw readings lesson by lesson | High | M | Fixed: `perf/evaluator-batch` |
| 2 | J2 Old readings cleared by a full table read (PostgreSQL 16) | High | S | Fixed: `perf/sighting-cleanup` |
| 3 | A1 On campus now sorts the whole day | High | S | Fixed: `perf/locations` |
| 4 | A2 Ingest writes band by band | High | S | Fixed: `perf/ingest-batch` |
| 5 | J3 Minute runs overlap; one failing step stops the rest | High | S | Fixed: `perf/job-guard` |
| 6 | A3 No compression | High | S | Fixed: `perf/api-compression` |
| 7 | F1 Readers reconnect at once, with no backoff | High | M | Fixed: `perf/firmware-backoff` |
| 8 | J4 Notices and alerts child by child | Medium | M | Fixed: `perf/followups-batch` |
| 9 | P1 Parent app polls hidden tabs and in the background | Medium | S | Fixed: `perf/parent-polling` |
| 10 | D2 Dashboard polls hidden tabs; search on every key | Medium | S | Fixed: `perf/dashboard-polling` |
| 11 | D1 TrueType fonts | Medium | S | Fixed: `perf/fonts-woff2` |
| 12 | A4 Chat thread list, one query per thread | Medium | S | Fixed: `perf/chat` |
| 13 | A5 Pool size and a second instance | High | S | Open **[decision]** |
| 14 | J5 Every instance runs the minute job | High | S–M | Open **[decision]** |
| 15 | A7 No rate limit on reader reports | Medium | S | Open |
| 16 | A6 Lists without paging | Medium | M | Open **[decision]** |
| 17 | A8 Heartbeat every 5 s | Low–Medium | S | Open **[decision]** |
| 18 | O1 Run PostgreSQL 16 locally | Medium | S | Open (partly addressed in `explain.ts`) |
| 19 | D3 Both dictionaries in every page | Low | M | Open |
| 20 | D4 Pages wait for the session | Low | M | Open |
| 21 | A10 Partition the readings table | Medium (later) | L | Open **[migration]** |
| 22 | A9 Files in PostgreSQL | Medium (later) | L | Open **[migration] [decision]** |
| 23 | D5 Server message patterns tried one by one | Low | S | Open |

None of the fixes needed a migration.

**Guards now in CI:**

- e2e tests count SQL statements, so a lesson-by-lesson or band-by-band loop coming back fails CI:
  - a report with one band and with several costs the same;
  - a period is written in one insert each;
  - a later minute does not re-read settled children;
  - three notices go in one insert;
  - the thread list does not grow with the number of threads.
- Further e2e tests check the batched clean-up and that a large reply comes back gzipped.
- After `next build`, CI runs `node scripts/bundle-report.mjs --check`. It fails if a page's first-load JavaScript passes 260 kB gzipped or the fonts pass 1,000 kB (`apps/web/bundle-budget.json`).

The load scripts and the browser checks stay manual. They need the full growth seed and a quiet machine.

## 6. The fix branches

- Each branch is a pull request into `perf/audit`, with its numbers in the description.
- `perf/evaluator-batch` builds on `perf/sighting-cleanup`, because both change the evaluator's tick.
- All branches keep CI green and leave the existing tests as they were, apart from the extra statement-count checks.

| Branch | Finding |
|---|---|
| `perf/sighting-cleanup` | J2 |
| `perf/evaluator-batch` | J1 |
| `perf/job-guard` | J3 |
| `perf/followups-batch` | J4 |
| `perf/locations` | A1 |
| `perf/ingest-batch` | A2 |
| `perf/api-compression` | A3 |
| `perf/chat` | A4 |
| `perf/fonts-woff2` | D1, and the bundle budget |
| `perf/dashboard-polling` | D2 |
| `perf/parent-polling` | P1 |
| `perf/firmware-backoff` | F1, and `gateways.ts --spread` |

## 7. Not measured

- **Lighthouse.** The 544 ms largest contentful paint above is from the browser's own PerformanceObserver on a warm local cache. A Lighthouse run on a throttled mobile profile, in English and Arabic, is still to do.
- **Flutter frame times** in the parent app: no profile-mode run on a real phone.
- **Chat at scale:** two API instances and 2,000 open sockets.
- **Files at scale:** uploads and downloads of documents and attachments stored in PostgreSQL.
- **Database CPU, connections and I/O under load.** The `pg_stat_statements` set-up in section 1 is the start of this.
- **A real network.** The API and the database shared one machine. Production adds a round trip to every statement, which makes the per-row loops fixed above cost even more than measured.
