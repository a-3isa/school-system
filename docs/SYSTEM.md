# What the system does (Phase 1)

This describes every part that exists in the code today. Phase 1 is attendance. It works with or without the BLE straps and gateways, on one platform you run for many schools.

---

## The pieces

| Piece | Who uses it | Where it runs |
|---|---|---|
| **Server (API)** | Everything talks to it | A server you host (NestJS + PostgreSQL) |
| **Dashboard** | You (owner), school admins, teachers | Any browser, including the classroom PC |
| **Parent app** | Parents (both mother and father, each with their own account) | Phone (Flutter; Android, iPhone, web) |
| **Gateway firmware** | Runs by itself in each gate and room | ESP32 boards you build |
| **Straps** | Worn by each student from Grade 1 up | FSC-BP107D BLE beacons |

---

## 1. Accounts and sign-in

**Roles:**
- **Owner** (you)
- **School admin**
- **Teacher**
- **Parent**
- Roles reserved for later phases: Transport, Nurse, Canteen, Accountant

**How each role signs in:**
- **Staff** use an email and password.
- **Parents** use their mobile number. A 6-digit code arrives on WhatsApp.
  - The code expires after 5 minutes and works once.
  - After 5 wrong tries the code is locked, and a number can ask for at most 5 codes an hour.
  - A password set by the school also works as a fallback.

**Safety rules:**
- Each request checks the account in the database. A deactivated account is locked out at once, even if it is still signed in somewhere.
- A user only ever sees their own school's data.
- **Consent:** a parent must agree to tracking the first time they open the app, before they see anything.

## 2. Owner console (you)

- **Schools:** create a school with its first admin account, and choose a plan:
  - **Essentials:** core, attendance and messaging
  - **Smart:** adds transport, canteen and payments
  - **Complete:** everything
- **Module switches:** turn any module on or off per school.
  - Switching one on also switches on what it needs; for example, Transport needs Attendance.
  - Switching one off is refused while another module still needs it.
- **Gateways:** register each gateway before it ships. You get:
  - a **serial**
  - a **claim code**, to print on its label
  - a **secret**, to write into its settings
- **New secret:** gives a gateway a new secret if the old one is lost; the old one stops working at once.

## 3. School setup (admin)

- **School settings:**
  - attendance mode: **Manual** (PCs only) or **Automatic** (straps)
  - school days (Sunday–Thursday by default)
  - the time of the daily "absent today" message (08:15 by default)
- **Grades, classes, rooms, subjects and bell periods.** Periods can't overlap.
- **Timetable:** for each day and period, which class is in which room, with which subject and teacher. Clashes are refused with a clear message: the same class, room or teacher twice at once.
- **Staff accounts:** add teachers and other staff; reset passwords; deactivate.
- **Students:**
  - each has a code, a name and an optional Arabic name, a class, and medical notes
  - at most **two parents**: mother and father
  - a parent with two children at the school uses one account
  - the admin can **restrict** a parent, who then no longer sees that child, or remove the link
- **Import from Excel:** students, parents and strap addresses in one sheet.
  1. A check step lists every row to fix: missing fields, duplicate codes, unknown classes, phone numbers without a country code, straps already in use.
  2. Nothing is saved until every row is correct.
  3. Importing the same file again updates the existing students.
- **Devices:**
  - claim a gateway with its claim code and say where it is: a **gate** or a **room**
  - register straps and give each one to a student
  - the detection rules can be tuned (see section 6)
- **Audit log:** every change, with who made it and when.

## 4. Taking attendance

Attendance is taken **per lesson** (every period counts). A lesson's status is one of:
- Present
- Late
- Absent
- Excused
- On a trip

### Manual mode (no straps)
- A teacher signs in on the classroom PC with their email and opens the lesson.
- They tap P / L / A / E for each child, or "Mark the rest present", then save.
- A teacher can mark only lessons they teach (or their homeroom class), and only **today**. Past days can only be corrected by an admin, and future days can't be marked.
- **Class away** (trip, exam elsewhere): the homeroom teacher or an admin marks a class away for some periods or the whole day, and nobody in it shows as absent. Only an admin can do this for a past day.

### Automatic mode (straps)
- Nobody has to take attendance. Each lesson is **decided when it ends** (see section 6).
- The teacher still has the class on screen and **only touches the children the strap got wrong**.
  - Example: a child who forgot their strap shows as absent; the teacher taps P and saves.
  - A manual change needs a reason, which is filled in for them ("Strap forgotten"). A manual mark always wins over the strap.

### My class now (teachers)
This is where a teacher lands after signing in with their email. It shows **only the lesson they are teaching right now**, and moves to the next lesson by itself when the bell goes.
- **Every 15 seconds,** each child shows **In the room**, **Not in the room** (with where and when they were last heard), **No strap**, or **Not heard today**.
- **Order:** children who are not in the room come first, preset to **A**.
- **Forgotten strap:** the teacher taps **P** for a child who is sitting in front of them but whose strap is missing, and saves.
- **Parents told:** the row shows the time the child's parents were told.
- **No lesson now:** it shows the next lesson today.

## 5. What parents are told

All messages arrive as **app notifications**, and every one is also kept in the app's list.

| When | Message (example) |
|---|---|
| The child comes in through the gate | "Salma arrived at school. Salma came in through Gate A at 07:42." |
| **10 minutes into a lesson**, the child came to school but isn't in the lesson's room | "**Salma was absent from Math in Room 204.** Salma came in through the gate at 07:42 but hasn't been in Math in Room 204 since it started at 09:50. The school has been told." |
| The teacher then marks that child present | "Salma is in Math in Room 204. The teacher marked Salma present … Ignore the earlier message." |
| The child goes out through the gate during the school day and isn't heard again | "Salma left school early." The admins are told too. |
| At the school's fixed time (08:15), the child is absent and not accounted for | "Salma is absent today." It is sent once per day. |

**Rules about who is told:**
- A child who never came through the gate (strap forgotten, or at home) gets **no lesson message**; the daily "absent today" message covers it.
- A child who went out through the gate before the lesson gets **no lesson message**.
- Each message is sent **once**.
- A **restricted** parent isn't told anything about that child.

## 6. How the straps decide (automatic mode)

- **Gateways:** they only listen and report. Every few seconds each gateway sends what it heard to the server: each strap, how loud, when, and its battery. Gateways decide nothing.
- **One place per minute:** within each minute, a child belongs to **the gateway that heard them loudest**. A child is in one room, not in every room that hears them through a wall.
- **Arrival at the gate:** the strap is heard loudly at the gate (−70 dBm or louder) for at least 3 seconds. The first such moment of the day is the arrival.
- **A lesson is decided when it ends:**
  - **Present** if the child was in the room for **70%** of the lesson.
  - **Late** if they were first seen **10 minutes** or more after it started.
  - Otherwise **Absent**.
- **Missing from a lesson:** 10 minutes into the lesson, a child who came to school but hasn't been in the room is reported to the parents and the dashboard (section 5).
- **Left early:** a child heard at the gate and then nowhere inside for **10 minutes** during the school day is reported to the parents and the admins.
- **Gateway offline:** if a room's gateway hasn't reported for **5 minutes**, that lesson can't be decided by straps. The dashboard asks for a manual mark, and so does a room with no gateway (a lab, say).
- **Low battery:** a strap at **20%** or below is flagged once.
- **All of these numbers can be changed per school.**
- **Raw readings** are kept for 7 days, then deleted. Attendance records are kept.

## 7. Dashboard pages

| Page | Who | What it shows |
|---|---|---|
| **My class now** | Teachers | The lesson in front of them, live (section 4) |
| **Today** | Everyone | Students enrolled and how many came in through the gate, present and absent per period, open exceptions, lessons today |
| **Take attendance** | Teachers, admins | Today's lessons and how far each has been marked; opens a lesson's list |
| **Exceptions** | Staff | Things a person should look at:<ul><li>at school but not in the lesson</li><li>left a lesson</li><li>left early</li><li>gateway offline / room without a gateway</li><li>low battery</li></ul>Each can be resolved with a note. |
| **Where students are** | Staff | Live every 10 seconds:<ul><li>each room and the gate, with who is in it now</li><li>"needs a look": not heard for 10+ minutes during school hours</li><li>who went out through the gate</li><li>who hasn't been heard today</li></ul>Has search and a class filter. |
| **Students & parents** | Staff (admins edit) | Search and filter; add a student; each student's page has parents, **where today** (place by place with times) and the last two weeks of attendance |
| **Import from Excel** | Admins | Template, check, import |
| **Staff** | Admins | Accounts |
| **Classes, rooms & periods**, **Timetable** | Admins (teachers view the timetable) | Setup |
| **Devices** | Admins | Gateways (claim, last seen), straps (assign, battery), detection rules |
| **Modules & settings** | Admins | Attendance mode, school days, absence message time, module features |
| **Audit log** | Admins | Every change |
| **Owner: Schools, Gateways** | You | Section 2 |

## 8. Parent app

1. **Sign in** with a mobile number and a WhatsApp code (password as a fallback).
2. **Consent** once.
3. **The child's day:** arrival time and each lesson's status. With two children there is a switcher.
4. **Notifications:** the list, marked read when opened.

## 9. Gateway firmware (ESP32)

- **What it does:**
  - listens for straps (passive BLE scan)
  - keeps the loudest reading per strap in each report window
  - sends it every few seconds over **MQTT with TLS**, and only to a server whose certificate checks out
  - reads battery from the strap's telemetry
- **When the network is down:** it keeps up to 1,500 readings and sends them later.
- **Heartbeat:** it sends a report even when nothing was heard, so the dashboard knows it is alive.
- **Setup and recovery:** settings (Wi-Fi, serial, secret, server, MAC prefix, minimum signal, interval) are typed over the USB cable, and a watchdog restarts it if it hangs.
- **Testing without hardware:** a **simulator** script pretends to be a gateway.

## 10. Demo and tools

- **`scripts/demo.ts`:** creates a demo school with 2 teachers, 2 classes of 12, a timetable, parents, 3 gateways and 24 straps.
  - On a school day it also plays today so far: arrivals, lessons, one child at home, one late, one leaving a lesson, everyone going home.
  - It then switches the school to automatic attendance.
- **`scripts/simulate-gateway.ts`:** sends live readings for chosen straps.

---

## Not done yet in Phase 1

- **Real hardware:**
  - The firmware compiles but hasn't run on an ESP32 with real straps.
  - The detection numbers (−70 / −85 dBm, 70%, 10 minutes) need tuning in real rooms.
- **Sending for real:**
  - **Push notifications:** Firebase isn't connected yet. Messages are saved and visible in the app's list, but nothing pops up on the phone.
  - **WhatsApp:** needs a WhatsApp Business account. Until then, sign-in codes are written in the server log.
  - **Email:** isn't used yet.
- **Arabic:** the dashboard and app are English only. Arabic names are stored and shown.
- **Hosting:** no production server, domain, HTTPS or MQTT broker is set up yet.
- **Parents and live location:** they don't see their child's live location. Only staff do, until you decide otherwise.
- **Passwords:** changing a password doesn't sign out sessions that are already open; deactivating the account does.
