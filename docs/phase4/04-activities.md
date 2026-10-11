# PR 4 · Activities: clubs, trips and permission slips, events

Branch `feature/activities`. Module key `activities`. Spec sources: PLAN.md M4, decisions T2, T4, T6, and the fee decision in `README.md`.

Features used:
- `paidActivities`: fees on clubs.
- `trips`: trips and permission slips.
- `events`: the events calendar and gallery.

A fee on a trip is always allowed. It is shown to parents and marked paid by staff.

Build in this order: clubs, then trips, then events and the calendar.

## 1. Schema (migration `activities`)

```prisma
enum EnrolmentStatus {
  ENROLLED
  WAITLISTED
  WITHDRAWN
}

enum TripStatus {
  DRAFT
  // Parents can give or refuse permission.
  OPEN
  // Permission closed; the list is final.
  CLOSED
  CANCELLED
}

enum ConsentDecision {
  GIVEN
  DECLINED
}

// A club or after-school activity.
model Activity {
  id           String   @id @default(cuid())
  schoolId     String
  yearId       String
  name         String
  nameAr       String?
  description  String?
  supervisorId String?
  // Weekdays it meets, 0 = Sunday … 6 = Saturday.
  days         Int[]
  startTime    String   // HH:mm
  endTime      String   // HH:mm
  roomId       String?
  capacity     Int
  // Year groups allowed to join; empty = all.
  gradeIds     String[]
  // EGP per term; null = free. Shown only when paidActivities is on.
  fee          Int?
  signupOpen   Boolean  @default(true)
  archivedAt   DateTime?
  createdAt    DateTime @default(now())

  school      School               @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  year        AcademicYear         @relation(fields: [yearId], references: [id], onDelete: Cascade)
  supervisor  User?                @relation("ActivitySupervisor", fields: [supervisorId], references: [id], onDelete: SetNull)
  room        Room?                @relation(fields: [roomId], references: [id], onDelete: SetNull)
  enrolments  ActivityEnrolment[]
  attendance  ActivityAttendance[]

  @@index([schoolId, yearId])
}

model ActivityEnrolment {
  activityId String
  studentId  String
  status     EnrolmentStatus
  // Order on the waitlist: earliest first.
  joinedAt   DateTime        @default(now())
  byUserId   String?
  paidAt     DateTime?
  updatedAt  DateTime        @updatedAt

  activity Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  student  Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@id([activityId, studentId])
  @@index([activityId, status, joinedAt])
}

model ActivityAttendance {
  activityId String
  studentId  String
  date       DateTime @db.Date
  present    Boolean
  markedById String?
  markedAt   DateTime @default(now())

  activity Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  student  Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@id([activityId, studentId, date])
}

model Trip {
  id          String     @id @default(cuid())
  schoolId    String
  title       String
  destination String
  description String?
  date        DateTime   @db.Date
  departTime  String     // HH:mm
  returnTime  String     // HH:mm
  // Lessons in these periods are marked "On a trip" for students going.
  fromPeriod  Int?
  toPeriod    Int?
  // EGP; null = free.
  fee         Int?
  // Parents must answer before this moment.
  consentBy   DateTime
  status      TripStatus @default(DRAFT)
  // When the "answer by tomorrow" reminder went out (sent once).
  remindedAt  DateTime?
  leaderId    String?
  createdById String?
  createdAt   DateTime   @default(now())

  school   School        @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  leader   User?         @relation("TripLeader", fields: [leaderId], references: [id], onDelete: SetNull)
  classes  TripClass[]
  consents TripConsent[]
  checks   TripCheck[]

  @@index([schoolId, date])
}

model TripClass {
  tripId  String
  classId String

  trip  Trip  @relation(fields: [tripId], references: [id], onDelete: Cascade)
  class Class @relation(fields: [classId], references: [id], onDelete: Cascade)

  @@id([tripId, classId])
}

// A parent's signed permission slip.
model TripConsent {
  tripId     String
  studentId  String
  decision   ConsentDecision
  byUserId   String
  // The parent typed their full name as their signature.
  signedName String
  // Anything the school should know (medicine, allergies on the day).
  note       String?
  at         DateTime        @default(now())
  paidAt     DateTime?

  trip    Trip    @relation(fields: [tripId], references: [id], onDelete: Cascade)
  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  byUser  User    @relation("TripConsentBy", fields: [byUserId], references: [id], onDelete: Cascade)

  @@id([tripId, studentId])
}

// Headcount on the day.
model TripCheck {
  tripId    String
  studentId String
  leftAt    DateTime?
  backAt    DateTime?

  trip    Trip    @relation(fields: [tripId], references: [id], onDelete: Cascade)
  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@id([tripId, studentId])
}

model Event {
  id          String       @id @default(cuid())
  schoolId    String
  title       String
  description String?
  startsAt    DateTime
  endsAt      DateTime
  allDay      Boolean      @default(false)
  place       String?
  audience    Json
  publishedAt DateTime?
  createdById String?
  createdAt   DateTime     @default(now())

  school School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  photos EventPhoto[]

  @@index([schoolId, startsAt])
}

model EventPhoto {
  id        String   @id @default(cuid())
  eventId   String
  mime      String
  size      Int
  data      Bytes
  caption   String?
  createdAt DateTime @default(now())

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([eventId])
}
```

Add to the existing `AttendanceRecord` model, so cancelling a trip removes exactly the records it wrote:

```prisma
  // Set when the record was written by a trip (status ON_TRIP).
  tripId      String?
  trip        Trip?   @relation(fields: [tripId], references: [id], onDelete: SetNull)
```

Also add `attendance AttendanceRecord[]` to `Trip`.

**`AudienceService` (from PR 0):** fill in the `ACTIVITY` case. The `ids` are activity ids, and the students are those with `activityEnrolments` ENROLLED. Remove the "Clubs aren’t available yet" error. Announcements and polls can now target a club.

## 2. API (`apps/api/src/activities/`)

Files: `activities.ts`, `trips.ts`, `events.ts`, `activities.module.ts`. Every controller has `@RequiresModule('activities')`. Trips controllers also have `@RequiresFeature('activities','trips')`, and events controllers `@RequiresFeature('activities','events')`.

### 2.1 Clubs (`activities.ts`)

**Staff:**

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/activities?yearId=` | STAFF | List with `enrolled`, `waitlisted`, supervisor name and room. Teachers see all of them but can only manage the ones they supervise. |
| POST | `/activities` | SCHOOL_ADMIN | Creates a club. See the club rules below. |
| PATCH | `/activities/:id` | SCHOOL_ADMIN | Uses `defined()`. Lowering `capacity` below `enrolled` → 400 `'More students are enrolled than the new number of places.'` |
| POST | `/activities/:id/archive` | SCHOOL_ADMIN | Archives the club. Every ENROLLED and WAITLISTED student becomes WITHDRAWN without notifications. |
| GET | `/activities/:id/roster` | SCHOOL_ADMIN, supervisor | Lists enrolled students, then the waitlist in order. Each row has class, parent phones (staff only), `paidAt`, and the attendance rate. |
| POST | `/activities/:id/enrol` | SCHOOL_ADMIN | `{ studentId }`. Staff can add a student over capacity; this is allowed and audited. |
| POST | `/activities/:id/students/:studentId/withdraw` | SCHOOL_ADMIN, supervisor | Withdraws the student, then promotes the next one (see the promotion rules below). |
| POST | `/activities/:id/students/:studentId/paid` | SCHOOL_ADMIN | `{ paid: boolean }` sets or clears `paidAt`. Needs `paidActivities`. Audited. |
| PUT | `/activities/:id/attendance` | SCHOOL_ADMIN, supervisor | `{ date, present: { [studentId]: boolean } }`. The date must be one of the club's `days`, open in the calendar, and not in the future. Otherwise 400 `'The club doesn’t meet that day.'` |
| GET | `/activities/:id/attendance?date=` | same | Shows the saved marks, or all enrolled students unmarked. |

**Club rules** (`POST /activities`):
- `days` has 1–6 entries, each a school day.
- `startTime` must be before `endTime`.
- `capacity` is 1–500.
- `gradeIds` must belong to the school.
- `fee` is only allowed when `paidActivities` is on, and is 0–100000.
- `yearId` defaults to the current year: `SchoolCalendar.termOf(schoolId, today)`, added in PR 3. If PR 3 hasn't merged yet, add `termOf` here instead, as specified in `03-academics.md` §3.1.

**Promotion rules** (shared helper `promoteNext(tx, activityId)`):
- Runs in the same transaction as the withdraw.
- If `enrolled < capacity`, the first WAITLISTED student by `joinedAt` becomes ENROLLED.
- The promoted student's parents get `activity.promoted`.

**Parent:**

| Method | Path | Does |
|---|---|---|
| GET | `/parent/children/:id/activities` | Calls `ownChild`. Returns the clubs open to the child's year group in the current year and not archived. Each club has `places` (capacity − enrolled), `fee` (only when `paidActivities` is on), the child's `status`, and `waitlistPosition` when waitlisted. |
| POST | `/parent/children/:id/activities/:activityId/join` | Joins the club. See the join rules below. |
| POST | `/parent/children/:id/activities/:activityId/leave` | Sets the child's enrolment to WITHDRAWN, then calls `promoteNext`. Audited. |

**Join rules:**
- `ownChild` is checked first.
- `signupOpen` must be true. Otherwise 400 `'Sign-up for this club is closed.'`
- The child's year group must be allowed. Otherwise 400 `'This club isn’t open to {child}’s year group.'` Use the child's first name in the message.
- Within one transaction:
  1. Lock the club with `SELECT … FOR UPDATE` on the activity row (`tx.$queryRaw`).
  2. Count ENROLLED students.
  3. If there is room, enrol the child. Otherwise put them on the WAITLIST.
- A row that already exists as WITHDRAWN is re-used with a new `joinedAt`.
- If the child is already ENROLLED or WAITLISTED → 400 `'{child} is already on the list.'`
- The response is `{ status, waitlistPosition? }`.

**Clashes:** warn, don't block. The join response includes `clash: { name }` when the child already attends a club that meets on the same day at overlapping times. The app shows it as a note.

### 2.2 Trips (`trips.ts`)

**Staff:**

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/trips?from=&to=` | STAFF | Each trip comes with its classes, counts (`given`, `declined`, `waiting`, `paid`), and status. Teachers see trips that include a class they teach or lead. |
| POST | `/trips` | SCHOOL_ADMIN | Creates a DRAFT trip. See the trip rules below. |
| PATCH | `/trips/:id` | SCHOOL_ADMIN | Allowed while DRAFT or OPEN. Changing `date`, the times or `fee` while OPEN notifies parents who already answered with `trip.changed`. |
| POST | `/trips/:id/open` | SCHOOL_ADMIN | Moves DRAFT to OPEN, then notifies the unrestricted parents of every active student in the classes with `trip.consent`, `data { tripId, studentId, title, date }`. |
| POST | `/trips/:id/close` | SCHOOL_ADMIN | Moves OPEN to CLOSED. Students with consent GIVEN get **On a trip** in attendance (see below). |
| POST | `/trips/:id/cancel` | SCHOOL_ADMIN | Moves any status to CANCELLED, notifies parents with `trip.cancelled`, and removes the ON_TRIP records this trip created (see below). |
| GET | `/trips/:id/consents` | SCHOOL_ADMIN, leader, teachers of the classes | One row per student: decision, signer, note, `paidAt`, and parent phones. |
| POST | `/trips/:id/students/:studentId/paid` | SCHOOL_ADMIN | `{ paid }`. Audited. |
| GET | `/trips/:id/headcount` | SCHOOL_ADMIN, leader | Lists students with consent GIVEN and their `leftAt`/`backAt`. |
| POST | `/trips/:id/headcount` | SCHOOL_ADMIN, leader | `{ studentId, leg: 'LEFT' \| 'BACK', at? }`. Only allowed on the trip's date (Cairo). Otherwise 400 `'Headcount is taken on the day of the trip.'` |

**Trip rules** (`POST /trips`):
- Required: `title`, `destination`, `date`, `departTime`, `returnTime`, `classIds` (≥1), and `consentBy` as an ISO date-time. `consentBy` must be in the future and before departure.
- Optional: `description`, `fee`, `leaderId`, and the period range `fromPeriod`/`toPeriod`. Give both or neither; neither means the whole day.
- `SchoolCalendar.day(date).open` must be true. Otherwise 400 `'The school is closed that day.'`

**Parent:**

| Method | Path | Does |
|---|---|---|
| GET | `/parent/children/:id/trips` | Calls `ownChild`. Returns OPEN, CLOSED and CANCELLED trips that include the child's class, with a date of today or later and up to 30 days back. Each trip has `myConsent`, `canAnswer` (OPEN and `now < consentBy`), `fee` and `paid`. |
| POST | `/parent/children/:id/trips/:tripId/consent` | Records the parent's answer. See the consent rules below. |

**Consent rules:**
- The body is `{ decision: 'GIVEN'|'DECLINED', signedName, note? }`.
- `signedName` is 3–100 characters and must not be blank.
- A closed trip, or a request after `consentBy`, → 400 `'The deadline for this permission slip has passed. Please contact the school.'`
- Either parent may answer. The latest answer replaces the earlier one.
- Audit `trip.consent` with the decision and `signedName`. This is the legal trail.
- The other unrestricted parent gets `trip.answered` with `data { tripId, studentId, decision, by }`.

**Reminder.** Add one call to the `AttendanceJobs` tick (`attendance.ts`, around lines 107–138), so no new timer is needed: `tripsService.remind(now)`.
- It finds OPEN trips whose `consentBy` is between 23 and 24 hours away.
- It notifies parents who haven't answered with `trip.reminder`.
- To send at most one reminder, keep `remindedAt DateTime?` on `Trip` and add it to the schema above.

**Attendance on the trip day.** Write the helper `TripsService.applyAttendance(trip, actor)`. It runs on `close`, and again on `PATCH` of a CLOSED trip if that is allowed (keep CLOSED read-only instead, which is simpler).
- For each student with consent GIVEN, and each period in the range (all periods when no range is set), upsert an `AttendanceRecord` the same way `markAway` does in `attendance.service.ts` around line 310:
  - status `ON_TRIP`, source `MANUAL`;
  - `reason: 'Trip: <title>'`;
  - `tripId: trip.id`;
  - `markedById: actor.id`.
- Students without consent are untouched. They are expected at school.
- The evaluator already skips MANUAL records (`devices/evaluator.ts` around line 112).
- On cancel, delete the records `where: { tripId }`.
- CLOSED trips are read-only: PATCH → 400 `'This trip is closed. Cancel it and create a new one to change it.'`

### 2.3 Events (`events.ts`)

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/events?from=&to=` | STAFF | Events in the range, with a photo count. |
| POST | `/events` | SCHOOL_ADMIN | Creates an event. See the event rules below. |
| PATCH | `/events/:id` | SCHOOL_ADMIN | Uses `defined()`. |
| DELETE | `/events/:id` | SCHOOL_ADMIN | Deletes the event. |
| POST | `/events/:id/publish` | SCHOOL_ADMIN | Sets `publishedAt` and notifies the audience with `event.new`, `data { eventId, title, startsAt }`, one per parent. |
| POST | `/events/:id/photos` | SCHOOL_ADMIN | Multipart `file` plus an optional `caption`. See the photo rules below. |
| DELETE | `/events/:id/photos/:photoId` | SCHOOL_ADMIN | Deletes the photo. |
| GET | `/events/:id/photos/:photoId` | staff, and parents in the audience | Serves the image with `private, max-age=86400`. |

**Event rules** (`POST /events`):
- Required: `title` (up to 120 characters), `startsAt` and `endsAt` as ISO date-times, with start before end.
- Optional: `description` (up to 2000), `allDay`, `place`.
- `audience` is an `AudienceDto`.

**Photo rules** (`POST /events/:id/photos`, decision T6):
- Up to 2 MB each.
- `sniff()` must say jpeg, png or webp. A PDF is refused with 400 `'Photos must be JPEG, PNG or WebP.'`
- At most 30 photos per event: 400 `'An event can have up to 30 photos.'`

**Parent:**

| Method | Path | Does |
|---|---|---|
| GET | `/parent/calendar?from=&to=` | The range defaults to this month and may span at most 92 days. Merges five kinds of entry into one list sorted by date: published events whose audience includes the parent (`AudienceService.includesParent`); trips of the parent's children (all children unless `childId=` is given); exams from PR 3 when `academics` is on; holidays and the mid-year break from `Holiday` and `AcademicYear`; and club sessions of enrolled children. Each item is `{ kind: 'EVENT'\|'TRIP'\|'EXAM'\|'HOLIDAY'\|'BREAK'\|'CLUB', date, start?, end?, title, studentId?, id? }`. Skip CLUB items on closed days (`SchoolCalendar`). |
| GET | `/parent/events/:id` | The event detail plus its photo ids. Only for parents in the audience. |

### 2.4 Notifications

`{child}` is the child's first name. `{date}` is formatted with `S.dayName`, with times wrapped in `ltr()`.

| type | en | ar |
|---|---|---|
| `activity.promoted` | Good news: {child} now has a place in {club} | يسعدنا إبلاغكم بأنه أصبح لـ{child} مكان في {club} |
| `trip.consent` | Permission needed: {title} on {date} for {child} | مطلوب موافقتكم: رحلة {title} يوم {date} لـ{child} |
| `trip.reminder` | Reminder: please answer the permission slip for {child} by tomorrow | تذكير: يُرجى الرد على طلب الموافقة على رحلة {child} قبل الغد |
| `trip.answered` | {by} answered the permission slip for {child}: {Yes/No} | ردّ {by} على طلب الموافقة على رحلة {child}: {موافق/غير موافق} |
| `trip.changed` | The trip {title} has changed. Please check the details | طرأ تعديل على رحلة {title}، يُرجى مراجعة التفاصيل |
| `trip.cancelled` | The trip {title} on {date} has been cancelled | أُلغيت رحلة {title} المقررة يوم {date} |
| `event.new` | School event: {title} on {date} | فعالية مدرسية: {title} يوم {date} |

## 3. Dashboard

Nav group `activities`:

| href | key | roles | feature | en | ar |
|---|---|---|---|---|---|
| `/activities` | `clubs` | STAFF | — | Clubs & activities | الأندية والأنشطة |
| `/trips` | `trips` | STAFF | trips | Trips | الرحلات |
| `/events` | `events` | SCHOOL_ADMIN | events | Events | الفعاليات |

### Screens

- **`/activities`**
  - The catalogue is a list of rows. Each row shows the name, days in short form ("Sun, Tue · 14:30–15:30", with Arabic weekday names), supervisor (`staff()`), places as "18 of 20" using `Places` from `ClassPicker.tsx`, a waitlist count, and a fee when set.
  - "New club" opens a `Modal` with these fields: name (English and Arabic), description, days as chip toggles, times, room, supervisor, capacity, allowed year groups, fee, and sign-up open.
  - Selecting a club opens its detail with `Tabs`:
    - **Members:** enrolled students, then the waitlist with positions. Each row has Withdraw and a Paid toggle (when `paidActivities` is on), plus an "Add student" control.
    - **Attendance:** a date picker limited to meeting days, the enrolled students with a present toggle, and Save.
- **`/trips`**
  - The list shows date, title, classes, a status `Tag`, and consents as "18 agreed · 2 declined · 5 waiting" (Arabic counts via `arN`).
  - The create/edit `Modal` has: title, destination, description, date, depart and return times, periods affected (from/to, or the whole day), fee, leader, classes (multi-select using `ClassSelect` grouping), and the answer deadline as a date and time.
  - The detail view has:
    - an action bar with Open, Close and Cancel, each behind a confirm `Modal`;
    - a consent tracker table with filter tabs: All / Agreed / Declined / Waiting;
    - "Copy phone numbers of those waiting", which copies to the clipboard;
    - a Paid toggle per row.
  - **Headcount**, shown only on the trip date: a big-button list of students who are going. Tapping a student marks "Left" in the morning; a second tap marks "Back". The top shows "On the bus 23 of 25" and "Back 0 of 25".
- **`/events`**
  - The list has `Tabs` for Upcoming and Past.
  - The editor holds the fields, the `AudiencePicker`, Publish, and a photos grid. Uploading uses multiple file input, one request per file, with progress. Reuse `Thumb` from `StudentFiles.tsx`.

Strings: group `act` for every label above, in English and Arabic. Add `SERVER_AR` patterns for every error sentence in §2.

## 4. Parent app

School tab tiles: Clubs «الأندية», Trips «الرحلات», Calendar «التقويم». Add their keys to `_ready`.

- **`screens/clubs.dart`**
  - `ChildSwitch` at the top.
  - Section "Joined" «المشترك فيها», then "Open to {child}" «المتاحة لـ{child}».
  - Each club is a `Panel` showing: name (in Arabic when `nameAr` is set and the app is in Arabic), days and time, supervisor, and places left as "3 places left" «متبقٍ 3 أماكن». Use proper Arabic number agreement: «مكان واحد / مكانان / 3 أماكن / 11 مكانًا». The `S` class has no `arN`, so add one in Dart that mirrors the web one.
  - Show the fee as "350 EGP per term" «‎350‎ جنيهًا للفصل الدراسي».
  - Buttons: "Join" «اشتراك» or "Join the waiting list" «الانضمام إلى قائمة الانتظار»; then "Leave" «إلغاء الاشتراك», which asks for confirmation.
  - A waitlisted child shows "Waiting list: number 2" «قائمة الانتظار: رقم 2».
  - When the join response has a `clash`, show a `Notice`: "This meets at the same time as {club}." «يتزامن موعده مع {club}.»
- **`screens/trips.dart`**
  - A list per child. The detail screen shows destination, date, depart and return times, fee, and description.
  - The permission slip section shows this declaration:
    - en: "I, the parent of {child}, give permission for {him/her/them} to go on this trip."
    - ar, boy: «أوافق، بصفتي وليّ أمر {child}، على مشاركته في هذه الرحلة.»
    - ar, girl: «أوافق، بصفتي وليّ أمر {child}، على مشاركتها في هذه الرحلة.»
  - Fields: a full-name field labelled "Type your full name to sign" «اكتبوا الاسم الكامل للتوقيع», and an optional note.
  - Buttons: "I give permission" «أوافق» (primary) and "I don’t give permission" «لا أوافق».
  - After answering, show a `Notice` such as "You gave permission on 3 Oct at 18:20 · signed Dina Hassan" «تمت الموافقة يوم 3 أكتوبر الساعة ‎18:20‎ · بتوقيع Dina Hassan», with "Change answer" while it is still allowed.
  - Before the deadline, show "Please answer by {date} {time}" «يُرجى الرد قبل {date} الساعة {time}».
  - A cancelled trip shows a muted state.
- **`screens/calendar.dart`**
  - A month header with previous/next arrows, then an agenda list grouped by day. Use `S.dayName`, Latin digits, and `ltr` for times.
  - Each item carries a kind glyph: event ★, trip ↗ (`c.t`), exam ✎, holiday or break (muted), club ●.
  - A `ChildSwitch` filter has an extra "All children" «كل الأبناء» option.
  - Tapping an item opens the event detail (with gallery), the trip detail, or nothing for the other kinds.
  - The event gallery is a grid of images loaded with the auth header (`Image.memory` from an `api.bytes(path)` helper you add to `Api`). Tapping one opens it full screen with `InteractiveViewer`.
- **Notifications:** add the types from §2.4. Use the glyph `Icons.directions_bus_outlined` for trips, `Icons.groups_outlined` for clubs and `Icons.celebration_outlined` for events. Tapping opens the right screen.

## 5. Tests

**E2e (`test/activities.e2e-spec.ts`).** Use one fixed open school day as the trip date, and pin `now` before `consentBy`.

1. A club with capacity 1, where two parents join in parallel (`Promise.all`): exactly one ENROLLED and one WAITLISTED. Withdrawing the enrolled child promotes the other and notifies them.
2. A wrong year group → 400. Joining twice → 400. Sign-up closed → 400. A restricted parent → 404.
3. A fee while `paidActivities` is off → 400.
4. Club attendance on a non-meeting day → 400.
5. Trip:
   - Opening it notifies the parents of the selected classes only.
   - A parent consents with `signedName`, and the audit row exists.
   - An answer after `consentBy` → 400.
   - On close, the register for that date shows ON_TRIP for the consenting student only, in the trip's periods only. Check it via `GET /attendance/...` the way the attendance e2e does.
   - Cancel removes those records.
6. Reminder: run `remind(now)` with `now = consentBy − 23.5 h`. Only parents who haven't answered get a reminder, and a second run sends nothing.
7. Headcount on a day other than the trip date → 400.
8. Event photos: a PDF → 400, a 31st photo → 400. A parent outside the audience can't fetch a photo (404).
9. Calendar: it merges an event, a trip, a holiday and a club session, and drops the club session on a holiday.
10. Turning off `trips` → trip routes 403, while clubs still work.

**Parent widget tests:**
- Clubs: join → the waitlist position shows.
- Trip slip: Arabic for a girl, and the signed-name field is required.
- Calendar: groups items by day.

## 6. Docs and demo

- **SYSTEM.md:** add sections for "Clubs and activities", "Trips and permission slips" and "Events and the school calendar".
- **PLAN.md:** tick the M4 items in §6 Phase 4, and note that the Phase 4 build is complete apart from clinic visits.
- **demo.ts:** three clubs (one full with a waitlist, one with a fee); one OPEN trip next week for one class with two answers; one past event with 3 photos (reuse small PNGs) and one upcoming event.
