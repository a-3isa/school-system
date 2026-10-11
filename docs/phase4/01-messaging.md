# PR 1 · Messaging

Branch `feature/messaging`. Module key `messaging`. This PR builds five features:
- **Announcements** (every plan)
- **Emergency broadcast** (every plan)
- **Parent–teacher chat** (feature `chat`)
- **Polls** (feature `polls`)
- **Meetings** (feature `meetings`)

PLAN.md M8; decisions T1, T3, T4, T7.

Build it in this order, keeping each step green: announcements + emergency → polls → chat (REST, then the socket) → meetings.

## 1. Schema (`apps/api/prisma/schema.prisma`, migration `messaging`)

Add back-relations on `School`, `User` and `Student` as Prisma requires.

```prisma
enum AnnouncementPriority {
  NORMAL
  // Sent by Student Affairs to every parent; pinned in the app until acknowledged (T7).
  EMERGENCY
}

// A message from the school to parents of an audience: the whole school, year groups, classes or a club.
model Announcement {
  id         String               @id @default(cuid())
  schoolId   String
  title      String
  body       String
  // { kind: SCHOOL|GRADES|CLASSES|ACTIVITY, ids: string[] } (see src/common/audience.ts)
  audience   Json
  priority   AnnouncementPriority @default(NORMAL)
  authorId   String?
  fileData   Bytes?
  fileType   String?
  fileName   String?
  createdAt  DateTime             @default(now())
  // Null while a draft; set when sent.
  sentAt     DateTime?
  // How many parents it reached when sent.
  recipients Int                  @default(0)

  school School             @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  author User?              @relation("AnnouncementAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  reads  AnnouncementRead[]

  @@index([schoolId, sentAt])
}

// One row per parent the announcement was sent to.
model AnnouncementRead {
  announcementId String
  userId         String
  readAt         DateTime?
  // Emergency only: the parent pressed "I have read this".
  acknowledgedAt DateTime?

  announcement Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([announcementId, userId])
  @@index([userId])
}

model Poll {
  id          String    @id @default(cuid())
  schoolId    String
  question    String
  audience    Json
  // Parents may pick more than one option.
  multiple    Boolean   @default(false)
  // Staff see totals only, never who voted for what.
  anonymous   Boolean   @default(true)
  // Parents see the results after voting.
  showResults Boolean   @default(true)
  closesAt    DateTime
  authorId    String?
  createdAt   DateTime  @default(now())
  closedAt    DateTime?

  school  School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  author  User?        @relation("PollAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  options PollOption[]
  votes   PollVote[]
  // The parents it was sent to (same idea as AnnouncementRead).
  targets PollTarget[]

  @@index([schoolId, createdAt])
}

model PollOption {
  id     String @id @default(cuid())
  pollId String
  label  String
  order  Int

  poll  Poll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  votes PollVote[]
}

model PollTarget {
  pollId String
  userId String

  poll Poll @relation(fields: [pollId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([pollId, userId])
  @@index([userId])
}

model PollVote {
  pollId    String
  optionId  String
  userId    String
  createdAt DateTime @default(now())

  poll   Poll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  option PollOption @relation(fields: [optionId], references: [id], onDelete: Cascade)
  user   User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([pollId, userId, optionId])
}

// A conversation between one parent and one member of staff about one child.
model ChatThread {
  id            String   @id @default(cuid())
  schoolId      String
  studentId     String
  parentId      String
  staffId       String
  createdAt     DateTime @default(now())
  lastMessageAt DateTime @default(now())

  school   School        @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  student  Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  parent   User          @relation("ChatParent", fields: [parentId], references: [id], onDelete: Cascade)
  staff    User          @relation("ChatStaff", fields: [staffId], references: [id], onDelete: Cascade)
  messages ChatMessage[]

  @@unique([studentId, parentId, staffId])
  @@index([schoolId, staffId, lastMessageAt])
  @@index([parentId, lastMessageAt])
}

model ChatMessage {
  id        String    @id @default(cuid())
  threadId  String
  senderId  String
  body      String
  fileData  Bytes?
  fileType  String?
  fileName  String?
  createdAt DateTime  @default(now())
  // When the other side opened the thread after this message arrived.
  readAt    DateTime?

  thread ChatThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  sender User       @relation("ChatSender", fields: [senderId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
}

// A teacher's free time for parent meetings on one day, cut into slots.
model MeetingWindow {
  id          String   @id @default(cuid())
  schoolId    String
  teacherId   String
  date        DateTime @db.Date
  fromTime    String   // HH:mm
  toTime      String   // HH:mm
  slotMinutes Int
  // "Room 204", "Online (link sent the day before)"
  place       String
  createdAt   DateTime @default(now())

  school  School        @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  teacher User          @relation("MeetingTeacher", fields: [teacherId], references: [id], onDelete: Cascade)
  slots   MeetingSlot[]

  @@index([schoolId, date])
}

model MeetingSlot {
  id          String    @id @default(cuid())
  windowId    String
  startsAt    DateTime
  endsAt      DateTime
  bookedById  String?
  studentId   String?
  note        String?
  bookedAt    DateTime?

  window   MeetingWindow @relation(fields: [windowId], references: [id], onDelete: Cascade)
  bookedBy User?         @relation("MeetingParent", fields: [bookedById], references: [id], onDelete: SetNull)
  student  Student?      @relation(fields: [studentId], references: [id], onDelete: SetNull)

  @@index([windowId, startsAt])
}
```

Add the chat office hours to `School`:

```prisma
  // Office hours shown to parents in chat (HH:mm); not enforced (T3).
  chatFrom String @default("08:00")
  chatTo   String @default("15:00")
```

Expose them in `GET/PATCH /school` (`setup.ts`) with `@Matches(TIME_RE)`, and check `chatFrom < chatTo`.

## 2. API (`apps/api/src/messaging/`)

Files:
- `announcements.ts`
- `polls.ts`
- `chat.ts`
- `chat.gateway.ts`
- `meetings.ts`
- `messaging.module.ts`, which imports them all and exports `ChatGateway`

Register the module in `app.module.ts`. Every controller gets `@RequiresModule('messaging')`. Staff-side controllers use role lists from `auth.decorators.ts`.

### 2.1 Announcements (`announcements.ts`)

**Staff (`@Controller('announcements')`):**

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/announcements?status=SENT\|DRAFT` | SCHOOL_ADMIN, SOCIAL_WORKER, TEACHER | List with `readCount`, `recipients`, author name. Teachers see the ones they wrote, plus sent whole-school ones. |
| POST | `/announcements` | SCHOOL_ADMIN, TEACHER | Create a draft. DTO: `title` (≤120), `body` (≤4000), `audience: AudienceDto`. Teachers may only target `CLASSES` they teach or are class teacher of; anything else → 403 `'Teachers can write to their own classes only.'` |
| PATCH | `/announcements/:id` | author or SCHOOL_ADMIN | Edit a draft (`defined()`). Sent → 400 `'This announcement has already been sent.'` |
| PUT | `/announcements/:id/file` | author or SCHOOL_ADMIN | Multipart `file` ≤5 MB, `sniff()`, draft only |
| DELETE | `/announcements/:id` | author or SCHOOL_ADMIN | Drafts only |
| POST | `/announcements/:id/send` | author or SCHOOL_ADMIN | See below |
| GET | `/announcements/:id` | as list | Detail plus `reads: [{ parent, child, readAt }]` (SCHOOL_ADMIN only for the list of names) |
| GET | `/announcements/:id/file` | staff | Serve the file |
| POST | `/announcements/emergency` | SCHOOL_ADMIN | Create **and** send at once. DTO `{ title, body }`. The audience is forced to SCHOOL. |

Sending:
1. Use a race-safe `updateMany where { id, sentAt: null }`.
2. Call `AudienceService.reach`.
3. `createMany` the `AnnouncementRead` rows (`skipDuplicates`).
4. Set `recipients`.
5. Notify each parent, one notification per parent (not per child):
   - type `announcement.new` (or `announcement.emergency`);
   - `data: { announcementId, title }`;
   - for CLASSES/GRADES audiences, also put `studentId` when the parent has exactly one child in the audience.
6. Audit `announcement.send` / `announcement.emergency`.

**Parent (`@Roles(Role.PARENT) @Controller('parent/announcements')`):**

| Method | Path | Does |
|---|---|---|
| GET | `/parent/announcements` | Sent announcements that have an `AnnouncementRead` row for this parent, newest first (take 100), with `readAt`, `acknowledgedAt`, `hasFile` |
| GET | `/parent/announcements/emergency` | Unacknowledged emergency announcements, for the pinned banner |
| POST | `/parent/announcements/:id/read` | Set `readAt` if null |
| POST | `/parent/announcements/:id/acknowledge` | Set `acknowledgedAt` (and `readAt`). Emergency only. |
| GET | `/parent/announcements/:id/file` | Only if the parent has a read row |

Access is by the `AnnouncementRead` row. That row only exists when the parent was reached at send time, which makes T4 automatic.

### 2.2 Polls (`polls.ts`, `@RequiresFeature('messaging','polls')`)

**Staff:**

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/polls` | SCHOOL_ADMIN, SOCIAL_WORKER, TEACHER | List with `votes` (distinct voters), `targets`, `open` |
| POST | `/polls` | SCHOOL_ADMIN, TEACHER (own classes only, same rule as announcements) | DTO: `question` ≤200, `options: string[]` (2–10, each ≤80, unique after trim), `multiple`, `anonymous`, `showResults`, `closesAt` (ISO, must be in the future relative to `now`), `audience`. Creates the poll, `PollTarget` rows and notifications `poll.new` with `data { pollId, question }`. |
| GET | `/polls/:id` | staff | Results: `options: [{ id, label, votes }]`, `voters`, `targets`. When **not** anonymous and the caller is SCHOOL_ADMIN, also `byOption: { optionId: [parentName] }`. |
| POST | `/polls/:id/close` | author or SCHOOL_ADMIN | Set `closedAt` |

**Parent (`parent/polls`):**

| Method | Path | Does |
|---|---|---|
| GET | `/parent/polls` | Polls with a target row for this parent: `myVotes: optionId[]`, `open` (`closedAt == null && closesAt > now`), and `results` only if (`showResults` and voted) or closed |
| POST | `/parent/polls/:id/vote` | `{ optionIds: string[] }`. Checks: target row exists (else 404 `'Poll not found.'`); poll is open (else 400 `'This poll has closed.'`); every option belongs to the poll; exactly 1 option unless `multiple` (≥1). Replaces the parent's previous votes in a transaction. |

### 2.3 Chat over REST (`chat.ts`, `@RequiresFeature('messaging','chat')`)

**Who a parent may write to about a child** (T3), from `contacts(studentId)`:
- staff who teach the child's class (`TimetableEntry.teacherId` where `classId = child.classId`), with their subjects;
- the class teacher (`Class.homeroomTeacherId`);
- every active SCHOOL_ADMIN, shown as one "Student Affairs" contact (`role: 'SCHOOL_ADMIN'`). The contact is the first admin by name; any admin can answer threads with any admin (see staff rules).

Return `[{ id, name, honorific, role, subjects: string[], homeroom: boolean }]`.

**Parent (`parent/children/:id/...`):**

| Method | Path | Does |
|---|---|---|
| GET | `/parent/children/:id/contacts` | Above, plus `chatFrom` and `chatTo` |
| GET | `/parent/threads` | All this parent's threads with child name, staff name and title, last message (body truncated to 120), `unread` (messages from the other side with `readAt` null) |
| POST | `/parent/children/:id/threads` | `{ staffId }`. `ownChild` check (T4); staffId must be in contacts, else 403 `'You can write to your child’s teachers and Student Affairs only.'` Upsert on `[studentId,parentId,staffId]`. |

**Shared** (`threads/:id`, both parents and staff; the service checks who is allowed):

| Method | Path | Does |
|---|---|---|
| GET | `/threads/:id/messages?before=<ISO>` | 50 per page, newest first. The client reverses them. |
| POST | `/threads/:id/messages` | `{ body }` (1–2000 chars after trim), **or** multipart with `file` (≤5 MB, `sniff()`) and an optional `body`. Updates `lastMessageAt`, then emits over the socket (below). |
| POST | `/threads/:id/read` | Sets `readAt = now` on the other side's unread messages, then emits `read`. |
| GET | `/threads/:id/messages/:messageId/file` | Serve the file |

**Who can open a thread:**
- **Parent:** `thread.parentId === user.id`, **and** the guardian link is still unrestricted. Re-check this every time, because the school may restrict a parent later (T4). Otherwise 404 `'Conversation not found.'`
- **Staff:**
  - `thread.staffId === user.id`; or
  - the caller is SCHOOL_ADMIN and the thread's staff member is a SCHOOL_ADMIN (the shared Student Affairs inbox); or
  - the caller is SCHOOL_ADMIN viewing any thread **read-only** (a POST returns 403 `'Only the teacher in this conversation can reply.'`).
  - A teacher who is no longer in the contacts list can still read and reply to existing threads.

**Staff (`@Controller('threads')`, roles STAFF):**

| Method | Path | Does |
|---|---|---|
| GET | `/threads?scope=mine\|school` | `mine`: threads where staffId = me (for SCHOOL_ADMIN, also all threads with any admin). `school`: SCHOOL_ADMIN only, every thread. Each row has parent name, child name and class, last message, `unread`. |
| GET | `/threads/unread-count` | For the sidebar badge |

**Notifications.** On a new message, notify the recipient **only if they have no live socket** (`ChatGateway.isOnline(userId)`):
- type `message.new`, `data: { threadId, studentId, from: staffOrParentName }`;
- staff recipients get one too; the dashboard doesn't show notifications today, but rows are cheap and push will use them later.

Audit only thread creation (`chat.thread`), not every message.

### 2.4 Chat socket (`chat.gateway.ts`)

Dependencies: `npm i -w apps/api @nestjs/websockets@^11 @nestjs/platform-socket.io@^11`. Commit `package-lock.json`.

- **`main.ts` `configureApp`:** add `app.useWebSocketAdapter(new IoAdapter(app))`, so e2e tests (which use `configureApp`) get it too.
- **Gateway:**

```ts
@WebSocketGateway({ path: '/api/socket.io', cors: { origin: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  // handleConnection: token from socket.handshake.auth.token; verify with JwtService like AccessGuard,
  //   load the user (active), require school module messaging + feature chat; else socket.disconnect(true).
  //   socket.join(`user:${user.id}`); track online counts in a Map<userId, number>.
  // handleDisconnect: decrement.
  isOnline(userId: string): boolean
  /** Called by ChatService after a write. */
  message(userIds: string[], payload: { threadId: string; message: MessageDto })
  read(userIds: string[], payload: { threadId: string; readerId: string; at: string })
}
```

- **Writes go only through REST.** The gateway never accepts writes, so all rules live in one place.
- **Who receives events:** the parent, the thread's staff member, and every SCHOOL_ADMIN when the staff member is an admin.
- **Shared auth code.** Pull the user lookup and module check out of `AccessGuard` into a small exported function (e.g. `loadUser(prisma, sub)` and `moduleOn(prisma, schoolId, key, feature?)`). The guard and the gateway then share it.

### 2.5 Meetings (`meetings.ts`, `@RequiresFeature('messaging','meetings')`)

**Staff:**

| Method | Path | Roles | Does |
|---|---|---|---|
| GET | `/meetings?from=&to=` | TEACHER, SCHOOL_ADMIN | Teachers see their own windows and slots; SCHOOL_ADMIN sees all (filter `teacherId`). Booked slots include parent, child and note. |
| POST | `/meetings/windows` | TEACHER (self), SCHOOL_ADMIN (any `teacherId`) | DTO `{ teacherId?, date, fromTime, toTime, slotMinutes (5–60), place ≤120 }`. Checks: `SchoolCalendar.day(...).open`, else 400 `'The school is closed that day.'`; date not in the past (Cairo); the times fit (`toMinutes`). Creates slots from `zonedTime(date, t, tz)` in steps of `slotMinutes` (drop a last part-slot). Refuses an overlap with the teacher's other windows that day: 400 `'This overlaps another meeting time on the same day.'` |
| DELETE | `/meetings/windows/:id` | owner teacher or admin | If any slot is booked, those parents get `meeting.cancelled` |
| POST | `/meetings/slots/:id/cancel` | owner teacher or admin | Frees the slot and notifies the parent |

**Parent:**

| Method | Path | Does |
|---|---|---|
| GET | `/parent/children/:id/meetings` | `ownChild`. Returns the free future slots of the child's teachers + class teacher, grouped by teacher (`[{ teacher, slots: [{ id, startsAt, endsAt, place }] }]`), plus `booked` (this parent's future bookings for this child). |
| POST | `/parent/children/:id/meetings/:slotId/book` | `{ note? ≤300 }`. The slot must belong to a contact teacher of this child and be in the future. Race-safe `updateMany({ where: { id, bookedById: null }, data: {...} })`, and if `count === 0` return 409 `'Someone has just booked this time. Please choose another.'` One booking per parent per teacher per day: 400 `'You already have a meeting with this teacher that day.'` Notifies the teacher: `meeting.booked`, `data { slotId, studentId, startsAt }`. |
| POST | `/parent/meetings/:slotId/cancel` | Their own booking, until 2 hours before; after that 400 `'It’s too late to cancel online. Please call the school.'` Notifies the teacher. |

### 2.6 Notification types (parent app wording)

Wording keys off `type` and `data`. `{child}` is the child's first name.

| type | en | ar (boy / girl / neutral) |
|---|---|---|
| `announcement.new` | New from the school: {title} | جديد من المدرسة: {title} |
| `announcement.emergency` | Urgent from the school: {title} | عاجل من المدرسة: {title} |
| `poll.new` | The school asks your opinion: {question} | تودّ المدرسة معرفة رأيكم: {question} |
| `message.new` | New message from {from} about {child} | رسالة جديدة من {from} بشأن {child} (same for both genders) |
| `meeting.booked` (to staff only) | — | — |
| `meeting.cancelled` | Your meeting with {teacher} on {day} at {time} was cancelled | أُلغي موعد مقابلتكم مع {teacher} يوم {day} الساعة {time} |

In Arabic, times go through `ltr()`.

## 3. Dashboard

Nav items: add to group `messages`, or create the group after `attendance`.

| href | key | roles | feature | en | ar |
|---|---|---|---|---|---|
| `/messages` | `inbox` | STAFF | chat | Conversations | المحادثات |
| `/announcements` | `announcements` | SCHOOL_ADMIN, SOCIAL_WORKER, TEACHER | — | Announcements | الإعلانات |
| `/polls` | `polls` | SCHOOL_ADMIN, SOCIAL_WORKER, TEACHER | polls | Polls | استطلاعات الرأي |
| `/meetings` | `meetings` | SCHOOL_ADMIN, TEACHER | meetings | Parent meetings | مقابلات أولياء الأمور |
| `/emergency` | `emergency` | SCHOOL_ADMIN | — | Emergency message | رسالة طارئة |

`/messages` shows `count: 'messages'`, from `GET /threads/unread-count`, polled every 60 s and also bumped by socket events.

### Screens

- **`/messages`:**
  - Layout is two columns (`cols wide-narrow` reversed: list narrow, thread wide). On narrow screens, show the list, then the thread with a back link.
  - The thread list has `Tabs` "Mine / Whole school" (admin only). Each row: parent name, child name and class (`x()`), last line, time, unread dot.
  - The thread view has bubbles: mine at the inline-end in `--accent-wash`, theirs at the inline-start in `--surface-2`. Each bubble shows time and read ticks ("Seen" / «تمت القراءة»).
  - Composer: textarea + Send + attach. Enter sends; Shift+Enter starts a new line.
  - Add `lib/socket.ts`: `useSocket()` connects with `io(API_ORIGIN, { path: '/api/socket.io', auth: { token } })` once per session, and exposes `on(event, fn)`. Install `socket.io-client` in apps/web. Derive `API_ORIGIN` the same way `lib/api.ts` derives the base URL.
  - The thread marks itself read on open and whenever a new message arrives while it's open.
- **`/announcements`:**
  - `Tabs` Sent / Drafts. Each row: title, audience summary, author, sent time, and "Read by 34 of 52" / «قرأه 34 من 52», using `arN` for the counts.
  - "New announcement" opens a `Modal` with `Field`s for title and body, `AudiencePicker`, and an optional attachment. Buttons: "Save draft" and "Send now". Send shows a confirm line: "Send to 52 parents?" / «إرسال إلى 52 من أولياء الأمور؟» (count from a `POST /announcements/preview` → `{ parents }` endpoint; add it, SCHOOL_ADMIN/TEACHER, using `AudienceService.reach`).
  - The detail view lists who has read it (admin).
- **`/emergency`:**
  - A red-bordered panel (`--a` / `--a-bg`).
  - Explanatory text: "This goes at once to every parent in the school and stays at the top of their app until they confirm they have read it. Use it only for urgent safety matters." / «تصل هذه الرسالة فورًا إلى جميع أولياء الأمور، وتبقى في أعلى التطبيق حتى يؤكدوا قراءتها. يُرجى استخدامها للأمور العاجلة المتعلقة بالسلامة فقط.»
  - Fields: title and body. A checkbox "I understand this goes to every parent" must be ticked before the "Send emergency message" button works.
  - Below: past emergencies with acknowledged counts.
- **`/polls`:**
  - List with open/closed `Tag`s and a "N of M voted" count.
  - The create `Modal` has dynamic option rows (add/remove, 2–10) and `closesAt` (date + time inputs; build it in Cairo time with the helper in `lib/api.ts`).
  - Results show bars using `.meter` with a percentage and count.
- **`/meetings`:**
  - Teacher view: "Add meeting times" form (date, from, to, slot length select 10/15/20/30, place). Below it, upcoming days with their slots: free ones show a muted "Free", booked ones show parent, child and note, with a "Cancel" button.
  - Admin view: the same, plus a teacher select.
- **School settings (`/modules`):** add "Chat office hours" (from/to) to the existing school settings form. Help text: "Parents see these hours in the app. Messages can still be sent at any time." / «تظهر هذه المواعيد لأولياء الأمور في التطبيق، ويمكنهم الإرسال في أي وقت.»

Strings: a group `msg` in `strings.ts` holding every label above, en + ar. Add `SERVER_AR` patterns for every error sentence in §2.

## 4. Parent app

New dependency: `socket_io_client: ^3.0.0` (check it works on web and mobile). In `lib/socket.dart`, write `ChatSocket(api)` with `connect()`, a `Stream<Map> messages`, a `Stream<Map> reads` and `dispose()`. Use `OptionBuilder().setPath('/api/socket.io').setTransports(['websocket']).setAuth({'token': api.token})` against the origin of `apiUrl`. Tests inject a fake: make `ChatSocket` an interface, so the `MockClient` tests don't open sockets.

### Messages tab (`screens/messages.dart`)

Two segments at the top: **School news** («أخبار المدرسة») | **Conversations** («المحادثات»). Hide Conversations when `!has('messaging','chat')`.

- **School news:**
  - Shows `GET /parent/announcements` and `GET /parent/polls`, merged newest first.
  - An announcement card shows title, the first 3 lines, date, and an unread dot. Tapping it opens the detail, which marks it read and opens the attachment if there is one.
  - A poll card shows the question and options:
    - open: radio buttons, or checkboxes when `multiple`, and a "Send my answer" / «إرسال الإجابة» button;
    - after voting: results bars if allowed, else "Thank you. Your answer has been received." / «شكرًا لكم، وصلت إجابتكم.»;
    - closed: "Closed" / «انتهى الاستطلاع».
- **Conversations:**
  - List of threads: staff name with title, child, last line, time, unread count.
  - A FAB "New message" / «رسالة جديدة» opens the contacts list for the selected child (`ChildSwitch` on top). Each row: name, subjects or "Class teacher" / «رائد الفصل» or "Student Affairs" / «شؤون الطلبة». Tapping one creates or opens the thread.
- **`ChatScreen`:**
  - Bubbles in the same style as the dashboard (`Palette`).
  - Header: staff name, child name, and office hours: "Usually replies between 08:00 and 15:00" / «يردّ عادةً بين ‎08:00‎ و‎15:00‎» (use `ltr()`).
  - Composer with attach (file_picker: jpg/png/webp/pdf).
  - Live updates through `ChatSocket`; if it isn't connected, refresh every 30 s.
  - Marks read on open and on each incoming message.

### Emergency banner

- On Today, `HomeData` loads `GET /parent/announcements/emergency` with every `load()`.
- Each item shows as a red `Notice` at the very top: title and body, with the button "I have read this" / «اطلعتُ على الرسالة» → acknowledge → reload.
- If there are several, show them all, newest first.

### Meetings (`screens/meetings.dart`, School tab tile "Meetings" / «المقابلات»)

- `ChildSwitch`, then a section "Your meetings" with upcoming bookings and a "Cancel" button.
- Below it, each teacher in an expandable list showing free slot chips grouped by day (`S.dayName` + `ltr(time)`).
- Tapping a chip opens a bottom sheet with an optional note and the button "Book this time" / «حجز هذا الموعد». Success: "Your meeting is booked." / «تم حجز موعدكم.»
- A 409 shows the server message, then reloads.

Add the tile key `meetings` to `_ready` in `school.dart`.

### Strings and notifications

Every label above goes in `S`. Add the types from §2.6 to `S.notification()`, and glyphs/colours to `notifications.dart`:
- announcement: `Icons.campaign_outlined`, `c.primary`;
- emergency: `Icons.warning_amber`, `c.a`;
- poll: `Icons.how_to_vote_outlined`;
- message: `Icons.chat_bubble_outline`;
- meeting: `Icons.event_outlined`.

Tapping a notification opens the right screen when `data` allows it (thread, announcement, poll). Otherwise keep today's behaviour.

## 5. Tests

**API e2e (`test/messaging.e2e-spec.ts`).** Setup: a COMPLETE school; 2 classes; a teacher T1 teaching class A Maths; a teacher T2 teaching class B; a class teacher of A; 2 students in A (a boy and a girl) and 1 in B; parents P1 (child in A), P2 (child in B), P3 restricted on a child in A. Cases:
1. An announcement to CLASSES [A] reaches P1 only. P2 and P3 don't see it, and `recipients` matches.
2. A teacher can't announce to a class they don't teach (403) or to the whole school (403).
3. Emergency: a teacher gets 403. An admin's emergency reaches P1 and P2 but not P3's restricted child; P3 is still reached if they have another unrestricted child, so cover both. It shows in `/parent/announcements/emergency` until acknowledged.
4. Editing a sent announcement → 400.
5. Poll: P1 votes, then votes again (the vote is replaced). Two options on a single-choice poll → 400. A closed poll → 400. A non-target parent → 404. Results are hidden before voting when `showResults` is false. An anonymous poll never exposes names.
6. Chat: P1 can open a thread with T1 and with Student Affairs, but not with T2 (403). T2 can't read P1–T1's thread (404). An admin can read it but can't post (403). Restricting P1 afterwards → 404.
7. Socket: connect `socket.io-client` (devDependency) to `app.listen(0)`'s port with T1's token. P1 posts by REST, and T1 receives `message` with the body. A bad token is disconnected. No notification row is written for T1 while connected; one is written after disconnect.
8. Meetings:
   - a window on a holiday/weekend → 400;
   - overlapping windows → 400;
   - P1 books a slot of T1;
   - P2 can't book T1, because T1 doesn't teach their child (403/404);
   - two parallel bookings of the same slot → exactly one 201 and one 409;
   - cancelling inside 2 hours → 400 (pin `now`).
9. Features off: turn `chat` off as the owner, then `/threads` → 403. On an ESSENTIALS school, chat, polls and meetings are 403 and announcements work.

**Unit:** slot generation (`meetings.ts`: a pure `slotsFor(date, from, to, minutes, tz)`), and audience edge cases.

**Parent widget tests:**
- The Messages tab shows an announcement and a poll.
- Voting posts the right body.
- The emergency `Notice` shows on Today and acknowledging posts.
- The chat screen sends a message (fake socket).
- Arabic strings for `message.new` with a boy and a girl.

## 6. Docs

- **`docs/SYSTEM.md`:** a new section "Messaging": who can write to whom, emergency rules, polls, meetings, office hours, and per-plan availability.
- **`PLAN.md`:** tick M8 items in §6 Phase 4.
- **`scripts/demo.ts`:**
  - 2 announcements (one class, one whole school);
  - an open poll;
  - a chat thread with 3 messages between a demo parent and a teacher;
  - one teacher meeting window on the next school day.
