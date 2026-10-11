# Phase 4 · School life: build specs

These specs are the hand-off for building Phase 4. Each file is one pull request. Build them **in order**, one branch per PR, and merge each one with CI green before starting the next.

| # | Spec | Branch | Depends on |
|---|---|---|---|
| 0 | [Foundations](00-foundations.md) | `feature/phase4-foundations` | — |
| 1 | [Messaging](01-messaging.md): chat, announcements, emergency broadcast, polls, meetings | `feature/messaging` | 0 |
| 2 | [Behaviour](02-behaviour.md): notes, incidents, merit points | `feature/behaviour` | 0 |
| 3 | [Academics](03-academics.md): assessments, marks, exams, report cards | `feature/academics` | 0 |
| 4 | [Activities](04-activities.md): clubs, trips and permission slips, events | `feature/activities` | 0 (uses the attendance trip status) |

Clinic visits (M7) are **not** in this phase.

Before writing code, read `CLAUDE.md` (root), `docs/SYSTEM.md`, `PLAN.md` sections M4, M5, M7, M8 and §8, and the spec for the PR. Everything in `CLAUDE.md` still applies: British English, polite MSA, Arabic agreeing with the child's gender, Cairo time, every word in the strings files, roles enforced in the API, no blank overwrites, uploads checked by `sniff()`, a migration with every schema change, tests that don't depend on the time of day.

## Decisions

Ahmed decided these on 2026-10-11:
- **Delivery:** one PR per module.
- **Report cards:** a printable A4 page on the dashboard (the browser prints it to PDF), plus a native screen in the parent app. No PDF engine on the server.
- **Chat:** over WebSockets (Socket.IO).
- **Fees:** paid clubs and trips show a fee, and staff mark it paid by hand. Real payment comes with Phase 3.

PR 0 records these in `PLAN.md` §8 as rows **T1–T7**, plus **T8–T10** for the report-card, chat and fee choices above (already done):

| # | Question | Decision |
|---|---|---|
| T1 | Messaging per plan | Every plan has announcements and the emergency broadcast. Chat, polls and meetings are subscription features of Messaging, switched on for Complete only. |
| T2 | Where trips and events live | In the Activities module, as features `trips` and `events` (school-controlled). |
| T3 | Who parents can chat with | The child's teachers (from the timetable), the class teacher and Student Affairs. A teacher sees only their own conversations. Office hours are shown to parents, not enforced. |
| T4 | Separated families in Phase 4 | A parent marked `restricted` for a child (G36) sees nothing about that child in any Phase 4 feature, and gets no messages about them. |
| T5 | Marks and report cards | Parents see marks and report cards only once published. A published report card is frozen as a snapshot. |
| T6 | Event photos | Photos only (JPEG, PNG, WebP), up to 2 MB each and 30 per event, stored like other files. Video later. |
| T7 | Emergency broadcast | Student Affairs only. It goes to every parent and stays pinned in the app until they acknowledge it. WhatsApp to bus supervisors waits for Transport. |

## Ground rules from the code

These apply to every PR.

- **Name clash.** The `Grade` model is a *year group* ("Primary 4"), and `/api/grades` already exists. Marks use **Assessment** and **Mark**, under `/api/academics/...`.
- **Module key spelling.** The key is `behavior` (US spelling, already in the registry and in the database). Screens say **Behaviour** / «السلوك».
- **Gating.** Put `@RequiresModule('<key>')` on every controller class. Add `@RequiresFeature('<key>', '<feature>')` on handlers that need a feature. Both are in `apps/api/src/auth/auth.decorators.ts`.
- **Parent access to a child.** Copy `ownChild` in `apps/api/src/excuses/excuses.ts` (around line 74):
  - look up `studentGuardian.findUnique({ where: { studentId_userId } })`;
  - if the link is missing or `restricted`, throw `NotFoundException('Child not found.')`.
- **Fan-out to parents.** Use `guardians: { where: { restricted: false } }`, or `AudienceService` from PR 0.
- **Teacher scope.** A teacher teaches a class+subject when a `TimetableEntry` has `teacherId = user.id`. They are the class teacher when `Class.homeroomTeacherId = user.id`. Check this in the service, the way `attendance.service.ts` does around lines 64–73. Never rely on the UI for it.
- **School scoping.** Every new model has `schoolId` with `onDelete: Cascade` and an `@@index([schoolId, …])`. Every query filters by `schoolId`:
  - reads: `findFirst({ where: { id, schoolId } })`;
  - writes: `updateMany` / `deleteMany({ where: { id, schoolId } })`.
- **Helpers to reuse:**
  - `defined()` and `mapPrismaError()` from `src/common/validation.ts`;
  - `TIME_RE` and `toMinutes` from the same file;
  - `DATE_RE`, `dbDate` and `isoDate` from `src/common/dates.ts`;
  - `localParts` and `zonedTime` from `src/common/time.ts`;
  - `SchoolCalendar.day(school, 'YYYY-MM-DD')` from `src/setup/calendar.ts`, which returns `{ open, reason, term, year }`;
  - `AuditService.log(actor, 'entity.verb', 'entity', id, data)`;
  - `sniff()` from `src/students/files.ts`;
  - `NotificationsService.notify([...])`.
- **Time in services.** Every service method that depends on "now" takes `now = new Date()` as its last parameter, so e2e tests can pin it. E2e scenarios use one fixed Cairo school day. Pass `now` built with `zonedTime('2026-10-01', '10:00', 'Africa/Cairo')`, and make the year cover it.
- **Files.** Files are stored as `Bytes` in Postgres, like `Excuse.fileData`. Upload with `FileInterceptor('file', { limits: { fileSize } })`, check the bytes with `sniff()`, and serve them with the headers in `students/files.ts` (`nosniff`, `private`).
- **Notifications.**
  - The server writes the English `title`/`body` and a `type` such as `behaviour.note`, with `data: { studentId, … }`.
  - The parent app rebuilds the sentence in both languages from `type` + `data` in `S.notification()` (`apps/parent/lib/strings.dart`), using the child's gender.
  - Every new type in these specs comes with its wording.
  - Also add the type's glyph and colour in `screens/notifications.dart`.
- **Server English on the dashboard.** Every new English sentence the API returns that staff can see (errors, notification titles) needs a matching `SERVER_AR` pattern in `apps/web/lib/i18n.tsx`. Prefer error messages the dashboard already shows via `x()`.
- **Code layout.**
  - API: one folder per module under `apps/api/src/`, holding controller, service and DTOs together in the style of `excuses.ts`, plus a `*.module.ts` or a module class in the same file. Register it in `app.module.ts`.
  - E2e: one `apps/api/test/<module>.e2e-spec.ts` per PR, using `startApp`, `login`, `ownerClient` and `kid` from `test/helpers.ts`. Set up a school the way `excuses.e2e-spec.ts` does (lines ~28–59). Use emails unique to the spec.
  - Unit specs sit next to the code as `*.spec.ts`, for pure logic.
- **Migrations.** One per PR: `cd apps/api && npx prisma migrate dev --name <module>`. Never edit an applied migration. Never reset a database without asking Ahmed.

## Dashboard conventions

- **Pages.** Pages are client components under `apps/web/app/(app)/<route>/page.tsx`. Copy the structure of `app/(app)/excuses/page.tsx`:
  - data and actions: `useApi`, `useAction`, `post`/`put`/`patch`/`del` from `lib/api.ts`;
  - layout and states: `PageHead`, `Section`, `Tabs`, `Tag`, `Pill`, `Empty`, `ErrorNote`, `Field` and `toast` from `components/ui.tsx`;
  - lists: `article.list-row`.
- **Wording.** Every word goes in `apps/web/lib/strings.ts`, in both `en` and `ar`. `ar` is typed as `Dict`, so a missing key fails the build.
  - Counts use `arN()`.
  - Mixed Latin/Arabic text goes through `x()`.
  - Staff names go through `staff(u)`.
- **Look.**
  - No card shadows; panels separate by hairlines.
  - Corners: 4 (chips), 6 (controls), 8 (big buttons), 10 (panels).
  - Use logical CSS properties only (`margin-inline`, `inset-inline-start`).
  - Add new CSS to `app/globals.css` using the existing tokens (`--accent`, `--line`, `--surface`, status `--p/--l/--a/--e/--t`).
- **Navigation.** A new screen gets a nav item in `components/Shell.tsx` with `module`, `feature` (added in PR 0) and `roles`. It also gets `nav.<key>` strings.

## Parent app conventions

- **Screens.** Screens live in `apps/parent/lib/screens/`. Sub-screens open with `Navigator.push(MaterialPageRoute(...))`. Lists are drawn as `Container`s with `c.surface`, a `c.line` border and `Brand.radius` (see `excuse.dart`).
- **Wording.** Every word goes in `S` in `lib/strings.dart` through `_(en, ar)`.
  - Child-gendered sentences use `switch (gender) { 'MALE' => …, 'FEMALE' => …, _ => neutral }`.
  - Times and codes inside Arabic text go through `ltr()` from `widgets.dart`.
- **API calls.** Calls go through `Api` (`lib/api.dart`) and return raw maps. Add one method per endpoint.
- **Tests.** Tests go in `test/` using the `start()` / `school()` `MockClient` pattern. Pin `clock`, add `addTearDown(() => clock = DateTime.now)`, and end with `pumpWidget(SizedBox())` so the timers stop.

## Definition of done (every PR)

1. Schema + migration, API, unit + e2e tests, dashboard, parent app, en + ar strings, `SERVER_AR` patterns.
2. `docs/SYSTEM.md`: a section for the module (what it does, who can do what), in plain words like the rest of that file.
3. `PLAN.md`: mark the items built in §6 Phase 4, and add any new decision to §8.
4. Add sample data for the module to `apps/api/scripts/demo.ts`, so `/run-local` shows it.
5. Run `/check` locally: API typecheck, unit tests and e2e, `next build`, `flutter analyze && flutter test`, `pio run`. All green.
6. Commit with a short imperative subject and a body explaining what and why, ending with the attribution line. Push, open the PR, and merge when CI is green.

## Prompt to start each PR with Sonnet 5.5

> Implement `docs/phase4/0N-<name>.md`. Read `CLAUDE.md`, `docs/phase4/README.md` and that spec first, then the files the spec names. Work on branch `<branch>` from an up-to-date `main`. Follow the spec exactly; where it is silent, copy the nearest existing pattern (excuses, attendance) rather than inventing one. Keep CI green: run `/check` before pushing. If something in the spec conflicts with the code, stop and tell me instead of guessing.
