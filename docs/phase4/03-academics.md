# PR 3 · Academics: assessments, marks, exams, report cards

Branch `feature/academics`. Module key `academics`. Report cards sit behind the feature `reportCards`. Spec: PLAN.md M5 and decision T5. The timetable builder from M5 already exists.

**Naming:** the existing `Grade` model is a year group, so this PR uses **Assessment**, **Mark** and **ReportCard**, and every route sits under `/api/academics/...`. The word "grade" on screen means a letter or band such as "A" or «جيد جدًا».

## How marks work

- An **assessment** is anything marked:
  - Kinds: classwork, quiz, homework, project, midterm exam, final exam.
  - It belongs to one class, one subject, one academic year and one term.
  - It has a `maxScore` and a `weight`.
- A **mark** is one student's score on one assessment.
  - A student may be marked **absent**. If **excused** too, the assessment doesn't count for them.
  - Absent without an excuse counts as 0.
- A subject's **term percentage** is a weighted average:

  ```
  Σ(weight × score/max) / Σ(weight)
  ```

  It runs over the assessments the student has a mark for, skipping excused absences.
- The **overall percentage** is the plain average of the subject percentages.
- **Grade bands** turn a percentage into a band: a letter, an Arabic word, and for American schools a GPA point. The bands depend on the class's system (`Class.system`). Each school can edit them.
- **Publishing:**
  - Marks of an assessment reach parents only after the teacher **publishes** it.
  - A **report card** is generated for each student for a term, commented on, then **published**.
  - Publishing freezes a snapshot (T5): later mark changes don't alter a published card. Unpublishing is admin-only and logged.

## 1. Schema (migration `academics`)

```prisma
enum AssessmentKind {
  CLASSWORK
  QUIZ
  HOMEWORK
  PROJECT
  MIDTERM
  FINAL
}

enum ReportCardStatus {
  DRAFT
  PUBLISHED
}

model Assessment {
  id          String         @id @default(cuid())
  schoolId    String
  yearId      String
  term        Int            // 1 or 2, from SchoolCalendar for `date`
  classId     String
  subjectId   String
  kind        AssessmentKind
  title       String
  date        DateTime       @db.Date
  // Exams only: when and where (HH:mm, school time zone).
  startTime   String?
  endTime     String?
  roomId      String?
  maxScore    Int
  weight      Int            @default(1)
  createdById String?
  createdAt   DateTime       @default(now())
  publishedAt DateTime?

  school  School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  year    AcademicYear @relation(fields: [yearId], references: [id], onDelete: Cascade)
  class   Class        @relation(fields: [classId], references: [id], onDelete: Cascade)
  subject Subject      @relation(fields: [subjectId], references: [id], onDelete: Restrict)
  room    Room?        @relation(fields: [roomId], references: [id], onDelete: SetNull)
  marks   Mark[]

  @@index([schoolId, classId, subjectId, term])
  @@index([schoolId, date])
}

model Mark {
  assessmentId String
  studentId    String
  // Up to 2 decimals; null when absent.
  score        Decimal?  @db.Decimal(6, 2)
  absent       Boolean   @default(false)
  excused      Boolean   @default(false)
  comment      String?
  updatedById  String?
  updatedAt    DateTime  @updatedAt

  assessment Assessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)
  student    Student    @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@id([assessmentId, studentId])
  @@index([studentId])
}

model ReportCard {
  id                  String           @id @default(cuid())
  schoolId            String
  studentId           String
  yearId              String
  term                Int
  classId             String
  status              ReportCardStatus @default(DRAFT)
  // { subjectId: "comment" } written by each subject's teacher.
  subjectComments     Json             @default("{}")
  classTeacherComment String?
  principalComment    String?
  // Frozen at publish: see ReportSnapshot in src/academics/grades.ts.
  snapshot            Json?
  publishedAt         DateTime?
  publishedById       String?
  updatedAt           DateTime         @updatedAt

  school  School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  student Student      @relation(fields: [studentId], references: [id], onDelete: Cascade)
  year    AcademicYear @relation(fields: [yearId], references: [id], onDelete: Cascade)
  class   Class        @relation(fields: [classId], references: [id], onDelete: Cascade)

  @@unique([studentId, yearId, term])
  @@index([schoolId, classId, term])
}
```

Add to `School`:

```prisma
  // Grade bands per school system, overriding the defaults in src/academics/grades.ts.
  // { "BRITISH": [{ "min": 90, "label": "A*", "labelAr": "A*" }, …] }
  gradeBands Json @default("{}")
  // Shown under the principal's comment on report cards.
  principalName String?
```

## 2. Pure logic (`apps/api/src/academics/grades.ts` + `grades.spec.ts`)

```ts
export interface Band { min: number; label: string; labelAr: string; gpa?: number }
export const DEFAULT_BANDS: Record<'NATIONAL' | 'BRITISH' | 'AMERICAN', Band[]>
export function bandsFor(system: SchoolSystem | null, overrides: Record<string, Band[]>): Band[]
export function bandOf(pct: number, bands: Band[]): Band            // bands sorted by min desc; first with pct >= min
export function subjectPercent(items: { score: number | null; max: number; weight: number; absent: boolean; excused: boolean }[]): number | null
export function overall(subjects: (number | null)[]): number | null // average of non-null, 1 decimal
export interface ReportSnapshot { … }                               // see §3.3
```

**Defaults:**

- **NATIONAL** (used for NATIONAL_ARABIC, NATIONAL_LANGUAGES, AZHAR, OTHER, IB, FRENCH, GERMAN and null):

  | min | label | labelAr |
  |---|---|---|
  | 85 | Excellent | ممتاز |
  | 75 | Very good | جيد جدًا |
  | 65 | Good | جيد |
  | 50 | Pass | مقبول |
  | 0 | Below pass | دون المستوى |

- **BRITISH:** A* 90, A 80, B 70, C 60, D 50, E 40, F 30, G 20, U 0. `labelAr` = the same letter.
- **AMERICAN:** each band has a `gpa`; `labelAr` = the same letter.

  | label | A | A− | B+ | B | B− | C+ | C | C− | D+ | D | D− | F |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | min | 93 | 90 | 87 | 83 | 80 | 77 | 73 | 70 | 67 | 63 | 60 | 0 |
  | gpa | 4.0 | 3.7 | 3.3 | 3.0 | 2.7 | 2.3 | 2.0 | 1.7 | 1.3 | 1.0 | 0.7 | 0 |

**Rounding:** percentages are rounded to 1 decimal **only for display and snapshot**. Band lookup uses the unrounded value.

**Unit tests:**
- weighted average;
- excused skipped, unexcused absent = 0;
- no marks → null;
- band edges (84.99 → Very good, 85 → Excellent);
- an override replacing a system's bands;
- American GPA.

## 3. API (`apps/api/src/academics/`)

Every controller has `@RequiresModule('academics')`.

### Teacher scope helper

`teaches(user, classId, subjectId)` is true when any `TimetableEntry` has that class, subject and `teacherId = user.id`. SCHOOL_ADMIN always passes. SOCIAL_WORKER can read but not write. The class teacher (`homeroomTeacherId`) can **read** every subject of their class and write the class-teacher comment. Otherwise 403 `'You can only mark subjects you teach.'`

### 3.1 Assessments and marks (`assessments.ts`)

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/academics/teaching` | TEACHER, SCHOOL_ADMIN | The class+subject pairs the caller teaches (all pairs for an admin), for the gradebook picker: `[{ classId, className, subjectId, subjectName }]` |
| GET | `/academics/assessments?classId=&subjectId=&term=&yearId=` | STAFF (scope above) | List with `markedCount` and `studentCount` |
| POST | `/academics/assessments` | TEACHER (own pairs), SCHOOL_ADMIN | See the create rules below |
| PATCH | `/academics/assessments/:id` | creator or anyone who teaches the pair; admin | Uses `defined()`. Lowering `maxScore` below an existing score → 400 `'Some marks are higher than the new maximum.'` |
| DELETE | `/academics/assessments/:id` | same | Only while unpublished. Otherwise 400 `'Published marks can’t be deleted. Unpublish them first.'` |
| GET | `/academics/assessments/:id/marks` | scope | Every active student of the class with their mark or null |
| PUT | `/academics/assessments/:id/marks` | writers | See the marks rules below |
| POST | `/academics/assessments/:id/publish` | writers | Sets `publishedAt`, then notifies each student's unrestricted parents: `marks.published`, `data { studentId, assessmentId, subject, title }`. Only students with a mark. |
| POST | `/academics/assessments/:id/unpublish` | SCHOOL_ADMIN | Clears it. Audited. |
| GET | `/academics/gradebook?classId=&subjectId=&term=` | scope | Grid `{ assessments: [...], students: [{ id, name, marks: { [assessmentId]: mark }, percent, band }] }`, using `grades.ts` |
| GET | `/academics/exams?gradeId=&classId=&from=&to=` | STAFF | MIDTERM/FINAL assessments with times and rooms, ordered by date and start |

**Create rules** (`POST /academics/assessments`). DTO: `classId`, `subjectId`, `kind`, `title` ≤120, `date`, `maxScore` 1–1000, `weight` 1–10 (default by kind: CLASSWORK/QUIZ/HOMEWORK 1, PROJECT 2, MIDTERM 3, FINAL 4), and `startTime?` / `endTime?` / `roomId?`.
- `startTime` and `endTime` are only allowed for MIDTERM/FINAL, and both are required for those.
- `yearId` and `term` come from a new method on `SchoolCalendar` (`src/setup/calendar.ts`). `day()` can't be used here, because it returns only the year *name* and nothing at all for weekends and holidays, while homework may well be dated on a weekend. Add the method and unit-test it:

  ```ts
  /** The academic year and term a date falls in, open day or not. The mid-year break counts as term 1. */
  async termOf(schoolId: string, date: string): Promise<{ yearId: string; yearName: string; term: 1 | 2; startsOn: string; endsOn: string; termStartsOn: string; termEndsOn: string } | null>
  ```

  `termEndsOn` is the day before `term2StartsOn` for term 1, and `endsOn` for term 2. If the method returns null → 400 `'That date isn’t in an academic year.'` Report cards and the parent "current term" use `termOf(today)` as well.
- **Exam clash:** another MIDTERM/FINAL of the same class on the same date with overlapping times → 400 `'This class already has an exam at that time.'` The same room double-booked → 400 `'That room is already used for an exam at that time.'`

**Marks rules** (`PUT /academics/assessments/:id/marks`). Body `{ marks: [{ studentId, score?, absent?, excused?, comment? }] }`.
- `score` must be between 0 and `maxScore` (2 decimals) unless `absent`.
- `excused` requires `absent`.
- Every student must be in the class.
- Upsert in a transaction.
- Audit `marks.save` with the count. Not one row per mark.

### 3.2 Grade bands (`school` settings)

- `GET /academics/bands` (STAFF) → `{ [system]: Band[] }` with defaults merged.
- `PUT /academics/bands/:system` (SCHOOL_ADMIN) → validate: mins strictly descending, the last is 0, labels non-empty. `DELETE` resets that system to the default.

### 3.3 Report cards (`report-cards.ts`, `@RequiresFeature('academics','reportCards')`)

**`ReportSnapshot`:**

```ts
{
  student: { id, name, nameAr, code, gender },
  class: { name, gradeName, system },
  year: { name }, term: 1 | 2,
  subjects: [{ subjectId, name, percent: number | null, band: Band | null, comment: string | null, teacher: string | null }],
  overall: { percent: number | null, band: Band | null, gpa?: number | null },
  attendance: { present: number, late: number, absent: number, excused: number, onTrip: number, days: number },
  classTeacherComment: string | null, classTeacher: string | null,
  principalComment: string | null, principalName: string | null,
  school: { name, nameAr },
  issuedAt: string
}
```

**Attendance counts:**
- They count **days**, not periods.
- A day counts as absent when the student was ABSENT in every recorded period that day.
- Otherwise the day takes the "worst" status: late beats present, and so on.
- The range runs from `termStartsOn` (from `termOf`) up to the earlier of `today` and `termEndsOn`.
- `days` = the number of open school days in that range, from `SchoolCalendar`.

**Endpoints:**

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/academics/report-cards?classId=&term=&yearId=` | SCHOOL_ADMIN, SOCIAL_WORKER, class teacher, subject teachers (read) | One row per active student: status, overall % (live if a draft, from the snapshot if published), and which comments are missing |
| POST | `/academics/report-cards/generate` | SCHOOL_ADMIN, class teacher | `{ classId, yearId, term }`. Creates DRAFT rows for students without one. Idempotent. |
| GET | `/academics/report-cards/:id` | scope | Draft: a live snapshot built now. Published: the stored snapshot. |
| PATCH | `/academics/report-cards/:id/comments` | see the comment rules below | Draft only. Otherwise 400 `'This report card is published. Unpublish it to change it.'` |
| POST | `/academics/report-cards/publish` | SCHOOL_ADMIN | `{ ids: string[] }` or `{ classId, term, yearId }`. For each draft: build the snapshot, store it, set PUBLISHED. Then notify unrestricted parents: `reportCard.published`, `data { studentId, reportCardId, term, year }`. Audit `reportcard.publish` with the count. |
| POST | `/academics/report-cards/:id/unpublish` | SCHOOL_ADMIN | Back to DRAFT, with `snapshot` kept until the next publish. Audited. Parents stop seeing it. |

**Comment rules** (`PATCH /academics/report-cards/:id/comments`):
- `{ subjectId, comment }` comes from a subject teacher of that subject.
- `{ classTeacherComment }` comes from the class teacher or an admin.
- `{ principalComment }` comes from an admin.
- Each comment is at most 600 characters.

### 3.4 Parents (`parent/children/:id/academics`)

Every endpoint checks `ownChild`.

| Method | Path | Does |
|---|---|---|
| GET | `/parent/children/:id/grades?term=` | Published assessments only. The term defaults to the current one from `SchoolCalendar`. Returns `subjects: [{ subjectId, name, percent, band, assessments: [{ id, title, kind, date, score, maxScore, absent, excused, comment }] }]` and `overall`. Percentages use **published assessments only**. |
| GET | `/parent/children/:id/grades/trend?subjectId=` | Points `[{ date, percent }]` for each published assessment in the year (score/max × 100), for the chart |
| GET | `/parent/children/:id/exams` | Upcoming MIDTERM/FINAL of the child's class (from today, Cairo), whether or not they are published (the schedule isn't a mark): `[{ subject, title, date, startTime, endTime, room }]` |
| GET | `/parent/children/:id/report-cards` | Published only: `[{ id, year, term, publishedAt, overall }]` |
| GET | `/parent/children/:id/report-cards/:rcId` | The published snapshot |

### 3.5 Notifications

| type | en | ar |
|---|---|---|
| `marks.published` | New mark for {child} in {subject}: {title} | درجة جديدة لـ{child} في {subject}: {title} |
| `reportCard.published` | {child}’s report card for term {term} is ready | صدرت شهادة {child} عن الفصل الدراسي {الأول/الثاني} |

The term words are «الأول» / «الثاني». In English, Term 1 / Term 2.

## 4. Dashboard

Nav group `academics`:

| href | key | roles | feature | en | ar |
|---|---|---|---|---|---|
| `/academics/gradebook` | `gradebook` | TEACHER, SCHOOL_ADMIN, SOCIAL_WORKER | — | Gradebook | سجل الدرجات |
| `/academics/exams` | `exams` | STAFF | — | Exam timetable | جدول الامتحانات |
| `/academics/report-cards` | `reportCards` | SCHOOL_ADMIN, SOCIAL_WORKER, TEACHER | reportCards | Report cards | الشهادات |

### Screens

- **Gradebook:**
  - The picker comes from `/academics/teaching`, one select of "4/1 · Mathematics", plus term `Tabs` (Term 1 / Term 2) defaulting to the current term.
  - The grid is a `.panel.scroll` table:
    - rows: students (name with `x()`);
    - columns: assessments (title, kind tag, date, "/max", and Published/Draft `Tag`);
    - last two columns: term % and band.
  - Cells are number inputs (`inputmode="decimal"`, `className="input num"`). Arrow keys and Enter move between cells, the way the register moves between rows.
  - An "A" toggle marks absent, and a second click on it makes it excused. Show "Abs." / «غ» and "Exc." / «غ.ب».
  - A sticky footer has "Save marks (n)", using the dirty count like the register's `saveN`.
  - A header menu per column: Edit, Publish, Delete.
  - "New assessment" opens a `Modal` with kind, title, date, max, weight, and the exam fields when the kind is MIDTERM/FINAL.
- **Exam timetable:**
  - Filter by year group.
  - A table grouped by date: time, class, subject, room, title.
  - A "Print" button (`window.print()` with print CSS).
- **Report cards:**
  - Class + term picker, then "Prepare report cards" (`generate`).
  - The list shows each student with a status `Tag` (Draft/Published), overall % and band, and missing-comment hints such as "Waiting for 2 subject comments" / «بانتظار تعليقين من معلمي المواد».
  - A row opens the editor:
    - the snapshot preview with a textarea per comment;
    - only the fields the user may edit are enabled.
  - Bulk "Publish for the class" (admin) shows a confirm with the count.
  - Each row has "Print" → the print page.
- **Print page:**
  - Put it **outside** the `(app)` group, so the sidebar isn't printed: `app/(print)/report-cards/[id]/page.tsx`.
  - Its own `(print)/layout.tsx` wraps `LangProvider` and `SessionProvider` without `Shell`.
  - A4 portrait, `@page { size: A4; margin: 14mm }`. It uses the crest (`Crest`), the school name in the chosen language, and the student block (name in the chosen language, code, class, year, term).
  - The subjects table: subject, %, band, teacher comment. Then the overall line, the attendance line, the class-teacher comment with name, and the principal comment with name and a signature line.
  - Fonts: Source Serif 4 / Noto Naskh for headings, Plex for body. Latin digits. Arabic uses `dir="rtl"`.
  - A toolbar hidden in print: language switch (EN/AR) and "Print" / «طباعة».
  - The print stylesheet goes in `globals.css` under `@media print` plus `.rc-*` classes.
- **School settings:** a section "Grade bands" / «تقديرات الدرجات» with one tab per system in use. The table has min %, label and Arabic label, with add/remove rows and "Reset to default" / «استعادة الإعدادات الافتراضية». Also a "Principal’s name" field / «اسم مدير المدرسة».

### Strings (group `acad`)

Every label above, plus:

| key | en | ar |
|---|---|---|
| kind.CLASSWORK | Classwork | أعمال الفصل |
| kind.QUIZ | Quiz | اختبار قصير |
| kind.HOMEWORK | Homework | واجب |
| kind.PROJECT | Project | مشروع |
| kind.MIDTERM | Midterm exam | امتحان منتصف الفصل |
| kind.FINAL | Final exam | امتحان نهاية الفصل |
| term | Term {n} | الفصل الدراسي {الأول/الثاني} |
| percent | {n}% | ‎{n}%‎ (via `x()`) |
| overall | Overall | المجموع العام |
| attendance | Attendance: {d} days, absent {a} | الحضور: {d} يومًا، الغياب {a} (use `arN` for the day counts) |

Add `SERVER_AR` for every error sentence in §3.

## 5. Parent app

**School tab tile:** "Grades" / «الدرجات». Add the key `grades` to `_ready`.

**`screens/grades.dart`:**
- `ChildSwitch`, then Term 1/Term 2 segments.
- An overall card: % and band, using `Brand.display` for the number.
- Subject `Panel`s showing name, %, a band chip and a small progress line.
  - Draw the line with `CustomPainter`; no chart package. It shows points from `/grades/trend` with a thin `c.primary` stroke and dots, and an empty state with fewer than 2 points.
  - Tapping a subject expands its published assessments: title, kind, date, "17 / 20", absent or excused, and the teacher comment.
- A section "Upcoming exams" / «الامتحانات القادمة»: date (`S.dayName`), time (`ltr`), subject, room.
- A section "Report cards" / «الشهادات»: a list → `ReportCardScreen`, a native rendering of the snapshot laid out like the print page (crest, tables, comments). No PDF.

**Notifications:** add `marks.published` and `reportCard.published`, with the wording from §3.5, glyph `Icons.grade_outlined`, and tap → the grades screen for that child.

## 6. Tests

**Unit:** `grades.spec.ts`, see §2.

**E2e (`test/academics.e2e-spec.ts`).** Setup: a year with two terms, and a school day `2026-10-01` that is open in term 1. Cases:
1. A teacher creates an assessment for their class+subject → 201. For another subject → 403. A date outside the year → 400.
2. Marks: a score above the max → 400; excused without absent → 400; a student from another class → 400.
3. Parents don't see unpublished marks. After publish they do, and a notification is sent. A restricted parent → 404.
4. Gradebook percentages match `grades.ts` for a known set: two assessments with weights 1 and 3, and one excused absence.
5. Exam clash (same class, overlapping times) → 400. The same room → 400.
6. Report card:
   - generate → drafts;
   - a subject teacher can comment on their subject only, and on another → 403;
   - publish → snapshot stored;
   - change a mark afterwards → the published card is unchanged;
   - unpublish → the parent can't see it.
7. With `reportCards` off → report-card routes 403; the gradebook still works.

**Parent widget tests:** the grades screen shows subjects and the overall; the report card screen renders a snapshot in Arabic with a girl's name; the exams list uses `ltr` times.

## 7. Docs and demo

- **SYSTEM.md:** add a section "Academics": how percentages and bands work, who can do what, and publishing rules.
- **PLAN.md:** tick the M5 items.
- **demo.ts:** two subjects with 3 assessments each, marked and published for one class; one midterm exam scheduled next week; one published report card for term 1.
