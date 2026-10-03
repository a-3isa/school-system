# School Platform: notes for Claude

A school attendance platform for Egypt's private, language and international schools. Ahmed builds it alone. Read these before changing anything substantial:
- `docs/SYSTEM.md`: what every part does, in plain words.
- `PLAN.md` section 8: every product decision made so far.
- `docs/TESTING.md`: how to run and check everything.

## Layout

| Path | What | Stack |
|---|---|---|
| `apps/api` | Backend, all routes under `/api` | NestJS 11, Prisma 6, PostgreSQL 16 |
| `apps/web` | Staff dashboard and owner console | Next.js 15 (app router), plain CSS in `app/globals.css` |
| `apps/parent` | Parent app, one app for every school | Flutter (Dart 3.6+) |
| `firmware/gateway` | ESP32 BLE reader that hears the smart bands | PlatformIO |
| `docs/design-handoff/` | The Claude Design handoff (v2) the UI follows | HTML prototypes, read as reference |

The root `package.json` is an npm workspace holding `apps/api` and `apps/web`. Flutter manages its own packages.

## Commands

```bash
# API (from apps/api)
npm run start:dev                                   # http://localhost:3000/api
npx tsc --noEmit -p .                               # typecheck
npm test                                            # unit tests
npm run test:e2e                                    # e2e; empties the DB in TEST_DATABASE_URL (name must end in _test)
npx prisma migrate dev --name <what_changed>        # after editing prisma/schema.prisma
OWNER_EMAIL=… OWNER_PASSWORD=… npx ts-node scripts/demo.ts   # demo school (admin@demo.school / demo-admin-1)

# Dashboard (from apps/web)
npm run dev                                         # http://localhost:3001
npx tsc --noEmit -p . && npm run build

# Parent app (from apps/parent)
flutter analyze && flutter test
flutter run -d chrome --dart-define=API_URL=http://localhost:3000/api
```

`/check` runs everything CI runs. `/run-local` starts the whole system with demo data.

## Rules that matter

- **Never run `prisma migrate reset`, `DROP` or `TRUNCATE` on a database without asking Ahmed first.** These wipe data, and Prisma rightly refuses to do it without consent. For tests, use a separate database whose name ends in `_test`.
- **Schema changes ship with a migration** in `apps/api/prisma/migrations/` (`npx prisma migrate dev --name …`). Never edit an applied migration.
- **Every change keeps CI green.** CI runs:
  - API: typecheck, unit tests, and e2e against Postgres
  - dashboard: `next build`
  - parent app: `flutter analyze` and `flutter test`
  - firmware: `pio run`

  Run `/check` before pushing.
- **Tests must not depend on the time of day.** CI runs at any hour, including around midnight in Cairo.
  - Parent app: pin `clock` from `lib/api.dart` in tests.
  - API e2e: keep scenarios on one Cairo day.
- **Never skip, disable or weaken a test to get green.** Fix the cause.
- **Times are Cairo time (`Africa/Cairo`), 24-hour, Latin digits.** Use the helpers in `apps/api/src/common/time.ts`, and `todayCairo` / `nowCairo` in `apps/parent/lib/api.dart`.
- **The school calendar (`SchoolCalendar` in `apps/api/src/setup/calendar.ts`) decides whether a day is a school day.** That covers weekends, holidays, the mid-year break and the academic year. Absence messages, the evaluator and registers all ask it.
- **Roles and access are enforced in the API** (`@Roles(...)`, `@SchoolId()`), never only in the UI.
  - Teachers see only their own lessons.
  - Parents see only their own children, and only after giving consent (decision H39).
- **Uploads** (student documents, the school crest) are checked by their bytes (`sniff()` in `apps/api/src/students/files.ts`), not by the file name. SVG is never accepted.
- **Updates must not overwrite saved data with blanks:** in DTO-to-data mapping, skip fields that are `undefined` (`defined()` in `src/common/validation.ts`).

## Words and voice (both languages, every screen)

The audience is A/B-class families and Egypt's private schools: courteous, assured, reassuring. Details are in `docs/SYSTEM.md` section 11.

- **English:**
  - Use British spelling: enrolment, colour, authorised.
  - Use short, polite sentences.
  - Reassure first: "Salma arrived safely at school", "Student Affairs is following up".
- **Arabic:**
  - Use refined Modern Standard Arabic with polite plural forms («يُرجى»، «أدخلوا»), never colloquial («لو»، «موبايل» only where unavoidable).
  - In messages about a child, agree with the child's gender: «وصل أحمد / وصلت ليلى». Use the `g(boy, girl, neutral)` pattern in `apps/parent/lib/strings.dart`.
  - Staff-facing messages use gender-neutral noun forms («وصول…»، «انصراف…»).
  - Counts change with the number. On the dashboard use `arN()` in `apps/web/lib/strings.ts`: طالب واحد، طالبان، 3 طلاب، 24 طالبًا.
- **Fixed vocabulary:**
  - Attendance register / كشف الحضور
  - Follow-ups / المتابعات
  - On campus now / داخل المدرسة الآن
  - Student Affairs (the admin role) / شؤون الطلبة
  - Faculty & staff / هيئة التدريس والعاملون
  - Smart band / السوار الذكي
  - Smart band readers / أجهزة قراءة الأساور
  - School settings / إعدادات المدرسة
  - Activity log / سجل النشاط
  - Class teacher (homeroom) / رائد الفصل
  - Student ID / كود الطالب
  - Year group / الصف الدراسي
  - New enrolment / قيد طالب جديد
  - Activate your account (parents) / تفعيل حسابكم

  Don't say "strap", "gateway" or "RSSI" on screen.
- **Staff names** show with their title. On the dashboard use `staff(u)` from `useI18n()`, which gives "Ms. Hana Nabil" / «مس Hana Nabil».
- **Where the words live:**
  - Dashboard: every word is in `apps/web/lib/strings.ts`, which has `en` and `ar`.
  - Parent app: every word is in `apps/parent/lib/strings.dart`.
  - English text from the API is translated for the dashboard by the patterns in `SERVER_AR` (`apps/web/lib/i18n.tsx`). When you change an API message, update that pattern too.
- **Times, codes and phone numbers inside Arabic text:**
  - Dashboard: wrap them with `x()`.
  - Parent app: wrap them with `ltr()`.

## Look (design v2: "Ivory, Oxford navy & a crest")

The source of truth is `docs/design-handoff/` (open the `.dc.html` files; tokens are in `Direction and Components.dc.html`).

- **Colours:**
  - Ivory `#F6F4EF` ground and white panels.
  - Oxford navy `#1B2A4E` for actions and the sidebar.
  - The crest is burgundy `#7A1F2E` with a gold `#C9A75A` edge.
  - In dark mode, gold `#D6BA75` takes over actions.
- **Status colours** always keep their glyph and word:
  - Present ✓
  - Late ◔
  - Absent ✕
  - Excused –
  - On a trip ↗
- **Shape:** no card shadows; panels separate by a hairline. Corners: 4 (chips), 6 (controls), 8 (big buttons), 10 (panels).
- **Type:**
  - Headings use Source Serif 4 and Noto Naskh Arabic.
  - Everything else uses IBM Plex Sans and IBM Plex Sans Arabic.
  - All fonts are bundled locally, never from a CDN.
- **Where the tokens live:**
  - Dashboard: CSS variables at the top of `apps/web/app/globals.css`.
  - Parent app: `Palette` and `Brand` in `apps/parent/lib/theme.dart`.
- **The crest component** shows the uploaded crest or a shield with the school's initials:
  - Dashboard: `Crest` in `apps/web/components/Crest.tsx`.
  - Parent app: `Crest` in `apps/parent/lib/widgets.dart`.
- **RTL works by mirroring.** Use logical CSS properties (`inset-inline-start`, `margin-inline`), not left and right.

## Git workflow

- `main` is protected by CI. Work on a branch, open a PR, and merge once CI is green.
- Commit messages: a short imperative subject line, then a body saying what changed and why.
- `package-lock.json` and `apps/parent/pubspec.lock` are committed. If a local `npm install` rewrites them for no reason, discard that with `git restore` before pulling.
- Never commit `.env` files, secrets or `firmware/gateway/include/secrets.h`.
