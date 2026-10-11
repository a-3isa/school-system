# PR 2 · Behaviour

Branch `feature/behaviour`. Module key **`behavior`**, which stays US-spelt because it is already in the registry and the database. Screens say "Behaviour" / «السلوك». The only feature this PR uses is `merits`; `clinic` stays unused. Spec sources: PLAN.md M7 and decision T4.

## What it does

Teachers and Student Affairs record notes about a child:
- **Praise:** positive, usually shared with parents.
- **Concern:** something parents should know.
- **Incident:** a serious event (a fight, damage, bullying), with severity and the action taken. Only Student Affairs and the social worker can create or edit incidents.

Merit points (feature `merits`) add or take away points on praise or concern notes. Parents see the notes the school chose to share, and confirm they have read each one.

## 1. Schema (migration `behaviour`)

```prisma
enum BehaviourKind {
  PRAISE
  CONCERN
  INCIDENT
}

enum IncidentSeverity {
  MINOR
  MODERATE
  SERIOUS
}

model BehaviourNote {
  id               String            @id @default(cuid())
  schoolId         String
  studentId        String
  authorId         String?
  kind             BehaviourKind
  // A short tag from the school's list (see CATEGORIES below), e.g. "Kindness", "Homework".
  category         String
  text             String
  // Merit points (+ for praise, − for a concern); null when merits are off.
  points           Int?
  visibleToParents Boolean           @default(true)
  // Incidents only.
  severity         IncidentSeverity?
  actionTaken      String?
  place            String?
  occurredAt       DateTime
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  // Set when the note is withdrawn; withdrawn notes disappear from parents and totals.
  withdrawnAt      DateTime?

  school  School              @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  student Student             @relation(fields: [studentId], references: [id], onDelete: Cascade)
  author  User?               @relation("BehaviourAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  reads   BehaviourNoteRead[]

  @@index([schoolId, occurredAt])
  @@index([studentId, occurredAt])
}

model BehaviourNoteRead {
  noteId String
  userId String
  readAt DateTime @default(now())

  note BehaviourNote @relation(fields: [noteId], references: [id], onDelete: Cascade)
  user User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([noteId, userId])
}
```

**Categories** are a fixed list in code (`src/behaviour/categories.ts`). It is exported to the dashboard through `GET /behaviour/categories`, and the labels live in both strings files.

| kind | keys |
|---|---|
| PRAISE | `KINDNESS`, `EFFORT`, `ACHIEVEMENT`, `PARTICIPATION`, `LEADERSHIP`, `HELPING` |
| CONCERN | `HOMEWORK`, `PUNCTUALITY`, `DISRUPTION`, `UNIFORM`, `EQUIPMENT`, `RESPECT` |
| INCIDENT | `FIGHT`, `BULLYING`, `DAMAGE`, `SAFETY`, `OTHER` |

## 2. API (`apps/api/src/behaviour/behaviour.ts`)

Every controller has `@RequiresModule('behavior')`.

### Who may write

- **TEACHER:** PRAISE and CONCERN, only for students in classes they teach (any `TimetableEntry` with `teacherId = me` and `classId = student.classId`) or are class teacher of. Anyone else gets 403 `'You can write notes only for students you teach.'`
- **SCHOOL_ADMIN and SOCIAL_WORKER:** any kind, any student.
- **INCIDENT** by a teacher gets 403 `'Incidents are recorded by Student Affairs.'`

### Points

- Accepted only when the `merits` feature is on. When it is off and `points` is sent, return 400 `'Merit points are switched off for this school.'`
- Ranges:
  - PRAISE: 1–5
  - CONCERN: −5…−1
  - INCIDENT: −10…0
- `occurredAt` defaults to `now`, must not be in the future, and must be no more than 30 days back.

### Staff endpoints

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/behaviour?studentId=&classId=&kind=&from=&to=` | STAFF minus parents | Teachers see only notes about students they teach. The others see all. Each note comes with author (with title), student and class, and `readByParent: boolean`. Ordered by `occurredAt` desc, take 200. |
| POST | `/behaviour` | TEACHER, SCHOOL_ADMIN, SOCIAL_WORKER | DTO: `studentId`, `kind`, `category` (must belong to the kind), `text` (3–1000 chars), `points?`, `visibleToParents?` (default true; incidents default **false**), `severity` (required for INCIDENT), `actionTaken?`, `place?`, `occurredAt?`. Writes an audit log `behaviour.note`. If visible, notifies the child's unrestricted parents. |
| PATCH | `/behaviour/:id` | the author within 24 h; SCHOOL_ADMIN/SOCIAL_WORKER any time | Uses `defined()`. Turning `visibleToParents` from false to true sends the notification at that point. Audit `behaviour.edit`. |
| POST | `/behaviour/:id/withdraw` | same as PATCH | Sets `withdrawnAt`. Audit `behaviour.withdraw`. |
| GET | `/behaviour/summary?classId=` | STAFF | Per student: praise, concern and incident counts plus the points total for the current academic year. Find the `AcademicYear` row whose `startsOn ≤ today ≤ endsOn`. If there is none, use the last 12 months. `SchoolCalendar.day()` only returns the year's name.. Teachers only for their classes. |
| GET | `/behaviour/categories` | STAFF | `{ PRAISE: [...], CONCERN: [...], INCIDENT: [...] }` |

### Parent endpoints (`parent/children/:id/behaviour`)

Both endpoints check `ownChild`.

| Method | Path | Does |
|---|---|---|
| GET | `/parent/children/:id/behaviour` | Returns notes with `visibleToParents` and no `withdrawnAt`, newest first, take 100. Each has `{ id, kind, category, text, points, occurredAt, author: { name, honorific }, read }`. Incidents also include `severity` and `actionTaken`. Also returns `totals: { praise, concern, points }` for this year (points only when merits is on). |
| POST | `/parent/children/:id/behaviour/:noteId/read` | Upserts `BehaviourNoteRead`. |

### Notification

- Type `behaviour.note`.
- `data: { studentId, noteId, kind }`.
- Title in English: `'A note from school about <first name>'`.

## 3. Dashboard

Nav items:

| href | key | roles | en | ar |
|---|---|---|---|---|
| `/behaviour` | `behaviourNotes` | TEACHER, SCHOOL_ADMIN, SOCIAL_WORKER | Behaviour notes | ملاحظات السلوك |

### Screens

- **`/behaviour`:**
  - `PageHead` with a "New note" button.
  - Filters: class (`ClassSelect`, limited to own classes for teachers), kind `Tabs` (All / Praise / Concerns / Incidents), and a date range.
  - Each row:
    - the kind glyph in a `Tag`: Praise ★ in `--p`, Concern ! in `--l`, Incident ⚠ in `--a`;
    - student and class (`x()`), category, text, author (`staff()`), date, points (when merits is on);
    - "Shared with parents · Read" / «تمت مشاركتها مع ولي الأمر · تمت القراءة», or "Not shared" / «غير مُشاركة».
  - The row's actions are Edit and Withdraw. Withdraw needs a confirm in a `Modal`.
- **New note `Modal`:**
  - Student search: the class picker, then the student list.
  - Kind radio chips. Teachers don't see Incident.
  - Category chips for the chosen kind, then the text.
  - A points stepper, shown only when merits is on.
  - "Share with parents" switch.
  - Incident-only fields: severity, action taken, place.
  - Date/time, which defaults to now.
- **Student profile (`/students/[id]`):** add a `Section` "Behaviour" / «السلوك» with the totals and the last 10 notes, plus a "New note" button that opens the modal pre-filled.
- **Register (`components/AttendanceList.tsx`):** each student row gets a small `icon-btn` "Add note" (★) that opens the modal pre-filled with the student. This keeps teachers in their flow. Show it only when `has(me,'behavior')`.

### Strings (group `beh`, en + ar)

| key | en | ar |
|---|---|---|
| kind.PRAISE | Praise | ثناء |
| kind.CONCERN | Concern | ملاحظة للمتابعة |
| kind.INCIDENT | Incident | واقعة |
| severity.MINOR / MODERATE / SERIOUS | Minor / Moderate / Serious | بسيطة / متوسطة / جسيمة |
| cat.KINDNESS | Kindness | حسن الخلق |
| cat.EFFORT | Effort | الاجتهاد |
| cat.ACHIEVEMENT | Achievement | التفوق |
| cat.PARTICIPATION | Participation | المشاركة |
| cat.LEADERSHIP | Leadership | القيادة |
| cat.HELPING | Helping others | مساعدة الآخرين |
| cat.HOMEWORK | Homework | الواجبات |
| cat.PUNCTUALITY | Punctuality | الالتزام بالمواعيد |
| cat.DISRUPTION | Disrupting the lesson | تعطيل سير الحصة |
| cat.UNIFORM | Uniform | الزي المدرسي |
| cat.EQUIPMENT | Books and equipment | الكتب والأدوات |
| cat.RESPECT | Respect | الاحترام |
| cat.FIGHT | Fighting | شجار |
| cat.BULLYING | Bullying | تنمّر |
| cat.DAMAGE | Damage to property | إتلاف ممتلكات |
| cat.SAFETY | Safety | السلامة |
| cat.OTHER | Other | أخرى |
| points | n points | `arN(n,'نقطة واحدة','نقطتان','نقاط','نقطة')` |
| shared | Shared with parents | تمت مشاركتها مع ولي الأمر |
| notShared | Not shared | غير مُشاركة |
| readByParent | Read by parent | اطّلع عليها ولي الأمر |

Add the server error sentences from §2 to `SERVER_AR`.

## 4. Parent app

**School tab tile:** "Behaviour" / «السلوك». Add the key `behaviour` to `_ready`.

**`screens/behaviour.dart`:**
- `ChildSwitch` at the top.
- A totals strip: "Praise 6 · To follow up 1", plus "Merit points 14" when merits is on. In Arabic: «ثناء 6 · للمتابعة 1 · نقاط التميز 14».
- A timeline of `Panel`s, each with:
  - the kind glyph and colour from `Palette`: praise `c.p`, concern `c.l`, incident `c.a`;
  - category, text, "Ms. Hana Nabil · 3 Oct" (the staff title and name, as on the dashboard: `staffName()` in `S`, mirroring the web `staff()`), and points.
- An unread note shows a dot. Opening the screen marks every visible note read (one POST per unread note).

**Notification wording (`behaviour.note`, by `data.kind` and the child's gender):**

| kind | en | ar boy | ar girl |
|---|---|---|---|
| PRAISE | Well done! A note of praise for {child} | أحسنت! ثناء من المدرسة على {child} | أحسنت! ثناء من المدرسة على {child} |
| CONCERN | A note from school about {child} | ملاحظة من المدرسة بشأن {child} | ملاحظة من المدرسة بشأن {child} |
| INCIDENT | Student Affairs has written to you about {child} | تواصلت شؤون الطلبة معكم بشأن {child} | تواصلت شؤون الطلبة معكم بشأن {child} |

These sentences don't change with gender in Arabic, but still run them through the `g()` switch so the code pattern stays consistent. Write a body line where gender does matter:

| kind | en | ar boy | ar girl |
|---|---|---|---|
| PRAISE (body) | {child} was praised for {category} | نال {child} الثناء على {category} | نالت {child} الثناء على {category} |

## 5. Tests

**E2e (`test/behaviour.e2e-spec.ts`):**
1. A teacher writes praise for a student they teach → 201, and the parent gets a notification. For a student they don't teach → 403.
2. A teacher writes an incident → 403. An admin writes an incident → it is not visible to the parent by default. Then PATCH `visibleToParents: true` → the parent sees it and gets notified once.
3. With merits off, points → 400. With merits on, out-of-range points → 400.
4. A restricted parent (G36) → 404 on the child's behaviour.
5. A withdrawn note disappears from the parent list and from the totals.
6. A teacher's PATCH after 24 h (pin `now`) → 403. An admin's still works.
7. With the module off → 403.

**Parent widget test:** the timeline shows praise and concern with the right glyphs, the totals, the Arabic body for a girl, and "read" being posted.

## 6. Docs and demo

- **SYSTEM.md:** add a section "Behaviour notes".
- **PLAN.md:** tick the M7 notes and merits.
- **demo.ts:** add 3 praise notes, 1 concern and 1 hidden incident across two demo students.
