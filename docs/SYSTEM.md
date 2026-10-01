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

**Everyone signs in with email and password.** Mobile numbers and WhatsApp are not used to sign in.

**How a parent gets an account:**
1. When the parents register their child, the school enters each parent's **email**. A mobile is optional. The email is what links the parent to their children; a parent with two children at the school has one account.
2. The parent installs the app and taps **Create account**. It takes three steps:
   1. **Email:** they type the email the school registered, and a **6-digit code** is emailed to it.
   2. **Mobile:** they type that code and their **mobile number**, and a 6-digit code is sent to the mobile **on WhatsApp**.
   3. **Password:** they type the WhatsApp code and choose a password.
3. **What's saved:** the mobile is saved as **checked**. If the school had typed a different number, the checked one replaces it and the school's admins get a message ("Amr Gamal changed their mobile… It replaces +201111111111").
4. **Why both codes:** the email code proves the account is theirs, so knowing a parent's email isn't enough to open it. The WhatsApp code proves the mobile is real and theirs. A mobile already used by another account is refused.
5. **If the email wasn't registered,** nothing is sent. The answer looks the same either way, so the app can't be used to find out who is a parent.
6. **Wrong number or no WhatsApp code:** the parent fixes the number and sends the code again.
7. **Changing the mobile later:** in the app under **Account › Change mobile**: the new number, a WhatsApp code, saved. The school is told.

**Forgot password:** for parents (in the app) and staff (in the dashboard), a code by email, then a new password. It only works for accounts that finished sign-up; a parent who never signed up uses Create account.

**Code rules:** email and WhatsApp codes expire after 15 minutes and work once. After 5 wrong tries a code is locked, and an email or mobile can ask for at most 5 codes an hour.

**Staff accounts:** the admin creates them with an email and a first password.

**Safety rules:**
- Each request checks the account in the database. A deactivated account is locked out at once, even if it is still signed in somewhere.
- A user only ever sees their own school's data, and a **teacher only their own lessons** (see section 7).
- **Consent:** a parent must agree to tracking the first time they open the app, before they see anything.

## 2. Owner console (you)

- **Schools:** create a school with its first admin account, and choose a plan:
  - **Essentials:** core, attendance and messaging
  - **Smart:** adds transport, canteen and payments
  - **Complete:** everything
- **Module switches:** turn any module on or off per school, and **automatic attendance (straps)** inside Attendance.
  - Switching one on also switches on what it needs; for example, Transport needs Attendance.
  - Switching one off is refused while another module still needs it.
- **Gateways:** register each gateway before it ships. You get:
  - a **serial**
  - a **claim code**, to print on its label
  - a **secret**, to write into its settings
- **New secret:** gives a gateway a new secret if the old one is lost; the old one stops working at once.

## 3. School setup (admin)

- **School settings:**
  - school days (Sunday–Thursday by default)
  - the time of the daily "absent today" message (08:15 by default)
- **Grades, classes, rooms, subjects and bell periods.** Periods can't overlap.
- **Timetable:** for each day and period, which class is in which room, with which subject and teacher. Clashes are refused with a clear message: the same class, room or teacher twice at once.
- **Staff accounts:** add teachers and other staff; reset passwords; deactivate.
- **Students:**
  - each has a code, a name and an optional Arabic name, a class, and medical notes
  - at most **two parents**: mother and father, each with a name, an **email** (required: they sign up with it and get the school's emails at it) and, optionally, a mobile; the parent's checked mobile from the app replaces it
  - a parent with two children at the school uses one account (found by email)
  - each parent shows **Signed up in the app / Not signed up yet** and **Mobile checked by WhatsApp / not checked yet**
  - the admin can **restrict** a parent, who then no longer sees that child, or remove the link
- **Import from Excel:** students, parents and strap addresses in one sheet.
  1. A check step lists every row to fix: missing fields, duplicate codes, unknown classes, a parent without an email, mobiles without a country code, straps already in use.
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

### One attendance screen, for everyone, with or without straps
Teachers and admins use **the same screen**:
- **Layout:** the class list, each child with **Present / Late / Absent / Excused**, and one **Save** button.
- **The only difference is how each child starts:**
  - **Already saved:** what was saved.
  - **During the lesson, at a school with straps, while the room's gateway works:** what the strap says. In the room means Present; not heard in the room means Absent. A short line under the name says why ("In the room", "Not in the room · last heard Gate A, 07:42 · parents told 10:00", "No strap", "Strap not heard today"). The list updates every 15 seconds, and absent children come first.
  - **Otherwise:** Present. That covers a school without straps, a room whose gateway isn't working, and a past lesson nobody recorded.
- **The teacher:**
  - signs in on the classroom PC and lands on **My class now**, their only screen: the lesson in front of them, moving on by itself when the bell goes
  - at a school with straps, they open it only when a child forgot their strap: tap **Present**, then **Save**
  - at a school without straps, they tap the absent ones, then **Save**
  - can change today's lessons they teach
- **The admin:** opens the same screen from **Take attendance** for any lesson on any day.
- **Reasons:** a change at a school with straps needs a reason, which is filled in by itself ("Strap forgotten", "Correction", "Gateway not working"). A person's mark always wins over the strap.
- **Class away** (trip, exam elsewhere): an admin marks a class away for some periods or the whole day, and nobody in it shows as absent.

### Straps are a subscription
**Automatic attendance (straps, gateways, tracking)** is switched on per school by you, the owner, not by the school.
- **Without it:** the school never sees anything about straps:
  - no "Where students are"
  - no Devices page
  - no "came in through the gate" on Today
  - no "Where today" on a student's page
  - no strap line in the attendance list

  The attendance screen is the same; teachers take the register.
- **With it:** attendance starts from the straps, each lesson is decided when it ends (section 6), and the tracking screens appear.

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

## 6. How the straps decide (schools with straps)

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

## 7. Who sees which screens

| Screen | Teacher | School admin | Owner |
|---|:-:|:-:|:-:|
| **My class now:** the lesson in front of them, the teacher's only screen (section 4) | ✓ | | |
| **Today:** students enrolled and how many came in through the gate, present and absent per period, open exceptions, lessons today, and **Messages** to the school (e.g. a parent changed their mobile) | | ✓ | |
| **Take attendance:** every lesson; opens the same attendance screen for any lesson, any day | | ✓ | |
| **Exceptions:** things a person should look at, each resolved with a note:<ul><li>at school but not in the lesson</li><li>left a lesson</li><li>left early</li><li>gateway offline / room without a gateway</li><li>low battery</li></ul> | | ✓ | |
| **Where students are** (only with straps): live every 10 seconds:<ul><li>each room and the gate, with who is in it now</li><li>"needs a look": not heard for 10+ minutes during school hours</li><li>who went out through the gate</li><li>who hasn't been heard today</li></ul>Has search and a class filter. | | ✓ | |
| **Students & parents:** search, add, each student's page (parents, where today, two weeks of attendance) | | ✓ | |
| **Import from Excel:** template, check, import | | ✓ | |
| **Staff:** accounts | | ✓ | |
| **Timetable** (whole school), **Classes, rooms & periods** | | ✓ | |
| **Devices** (only with straps): gateways, straps, detection rules | | ✓ | |
| **Modules & settings:** school days, absence message time, whether straps are in the subscription | | ✓ | |
| **Audit log** | | ✓ | |
| **Schools, Gateways** (section 2) | | | ✓ |

The server enforces this: a teacher asking for school-wide data (the student list, where students are, the day's summary, exceptions) is refused, not just hidden from the menu. Parents can't use the dashboard; they use the app.

## 8. Parent app

1. **Sign in** with email and password.
   - **Create account** (first time): email code, then mobile with a WhatsApp code, then a password (section 1).
   - **Forgot password:** a code by email, then a new password.
2. **Consent** once.
3. **The child's day:** arrival time and each lesson's status. With two children there is a switcher.
4. **Notifications:** the list, marked read when opened.
5. **Account:** name, email, mobile ("checked on WhatsApp"), **Change mobile**, and sign out.

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
  - It subscribes the demo school to automatic attendance.
- **`scripts/simulate-gateway.ts`:** sends live readings for chosen straps.

---

## Not done yet in Phase 1

- **Real hardware:**
  - The firmware compiles but hasn't run on an ESP32 with real straps.
  - The detection numbers (−70 / −85 dBm, 70%, 10 minutes) need tuning in real rooms.
- **Sending for real:**
  - **Push notifications:** Firebase isn't connected yet. Messages are saved and visible in the app's list, but nothing pops up on the phone.
  - **Email:** needs an email account to send from (`SMTP_URL` in `apps/api/.env`). Until then, sign-up and password codes are written in the server log.
  - **WhatsApp:** needs a WhatsApp Business account with an approved code template (`WHATSAPP_*` in `apps/api/.env`). Until then, mobile codes are written in the server log.
  - **School emails to parents** (newsletters, announcements) come with the Messaging module, after Phase 1.
- **Arabic:** the dashboard and app are English only. Arabic names are stored and shown.
- **Hosting:** no production server, domain, HTTPS or MQTT broker is set up yet.
- **Parents and live location:** they don't see their child's live location. Only staff do, until you decide otherwise.
- **Passwords:** changing a password doesn't sign out sessions that are already open; deactivating the account does.
