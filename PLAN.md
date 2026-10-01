# School Platform — Product Plan & Module Catalog

> **One platform. Every part of school life.**
> Ahmed Ibrahim Hussien · Cairo, Egypt
> Source: `school-platform-vision` deck (Google Drive, Aug 2026)

## 1. Vision

Schools run many disconnected systems (records, attendance, transport, canteen,
activities, parent communication), so nobody sees the whole picture. This platform
puts **one student record** underneath all of them, with two front doors:

- **Staff Dashboard** (web): admins, teachers, transport officers, nurse, canteen staff. Every exception (a missing strap, a missed bus, a manual correction) is handled here; there is no staff mobile app
- **Parent App** (mobile): parents follow their child's whole day as it happens

Reference story: Layla (9, Grade 4) and her mother Nadia. Nadia sees each moment
as it happens (bus 7:10 → arrived 7:42 → lunch 12:30 → chess club 15:00 → home 15:45)
without calling anyone.

## 2. Product principle: everything is a module

The platform is sold to schools **à la carte**. Every capability belongs to a
module, and each school (tenant) gets only the modules it pays for.

### How toggling works

| Level | Example | Who controls it |
|---|---|---|
| **Module** | `transport` on/off | Platform owner (you), per school subscription |
| **Feature** inside a module | `transport.live_gps` on/off | Platform owner, or the school admin if allowed |
| **Setting** | canteen daily spending limit = 50 EGP | School admin |

Rules:
1. **Core is always on.** Every other module depends on it.
2. **Modules declare dependencies.** For example, *Canteen → Wallet* requires *Payments*.
   Turning a module on turns its required dependencies on too. A module can't be
   turned off while an enabled module still needs it.
3. **Turning off never deletes data.** The module is hidden and its APIs are blocked.
   Turning it back on restores everything.
4. **Everything reads the module registry:** API routes, dashboard menu items, parent
   app tabs, notifications, reports and background jobs.
5. **Plans are presets.** A plan (Basic / Standard / Premium) is a named bundle of
   modules. Any school can also get a custom bundle.
6. **Limits per school:** number of students, WhatsApp message volume, storage, buses and
   gateways, so pricing can be per student or per module.

## 3. Module catalog

Legend: **[MVP]** in the first release · **[Later]** after the MVP

---

### M0 · Core Platform — *always on*
The student record and the front door.

- **Multi-school (multi-tenant):** each school's data is fully isolated; one install serves many schools
- **School profile:** name, logo, colors (white-label), branches/campuses, academic year and terms
- **Academic structure:** stages → grades → classes/sections, subjects
- **Student records:** profile, photo, national ID/birth certificate, medical notes and allergies, emergency contacts, up to **two parent accounts** per student (mother and father), siblings linked to the same parents; the school can restrict what one parent sees (e.g. separated families)
- **Staff records:** teachers, admins, transport officers, nurse, canteen staff. Drivers and bus supervisors are stored as bus contacts, not users
- **Users, roles & permissions:** built-in roles (Owner, School Admin, Teacher, Transport, Nurse, Canteen, Accountant, Parent, Student) plus custom roles with fine-grained permissions
- **Authentication:** email + password for everyone. The school registers each parent's email (and checks their mobile and WhatsApp number in person); the parent then creates the account in the app with a code sent to that email. Forgot password by emailed code; device sessions
- **Bulk import/export:** Excel/CSV import for students, parents and staff
- **Notifications engine:** **app push for everything parents receive** (the app is required). WhatsApp from one shared business number only for alerts to bus supervisors, who have no app. Email for account codes, school emails to parents, receipts and reports. No SMS. Arabic/English templates
- **Audit log:** who changed what and when
- **Languages:** Arabic (RTL) and English
- **Module manager:** the on/off switchboard for modules, features and limits
- **Files & documents:** upload and store student documents

### M1 · Smart Attendance **[MVP]**
Attendance works in two modes, chosen per school:
- **Manual mode (no hardware):** teachers take attendance for every period on the classroom PC. A school can use the whole platform this way.
- **Automatic mode (BLE):** a gateway in every room where lessons happen (classrooms, labs, library, PE areas) and at the gates detects each student's strap; the classroom PC is the fallback.

In automatic mode:
- School arrival and departure: gate gateways
- Class and period presence: a gateway in every lesson room. Present = seen for 70% of the period; late = first seen more than 10 minutes after it starts
- Bus, canteen, clinic and club attendance: the gateway in that place
- Class on a trip or an exam elsewhere: the teacher or admin marks it "on a trip" in advance so nobody is flagged absent
- Leaving through the gate early without permission: alert to the parent and the admin
- **Every period counts:** a student must be present in every lesson; each period has its own attendance record
- **Fallback when a strap fails or is forgotten, and for students too young for a strap:** the teacher marks the student on the classroom PC (dashboard). The record is flagged "manual" with a reason, and the strap is reported for checking
- **Gateway offline:** the class switches to manual marking on the classroom PC automatically until the gateway is back
- **Exceptions are handled on the dashboard:** strap not seen, seen at the gate but not in class, left without a departure, dead battery
- Late arrival and early dismissal logging, with a reason
- Absence excuses: the parent submits one with an attachment, the school approves it
- Parent notifications by push: "Arrived 7:42" instantly; "Absent today" at a **fixed time** set by the school
- Reports: daily summary (present / absent / late / on trip), chronic absence alerts, monthly export

### M2 · Bus Tracking & Transport **[MVP]**
- Buses, routes, stops, drivers and supervisors
- Assigning students to a bus, stop and pick-up time
- **A trip starts when the bus leaves the school area and ends when it comes back into it.** The time of day decides whether it's the morning or afternoon trip
- **Drop-off:** the gateway sees the child leave the bus and the parent taps "Received" in the app; no confirmation within 10 minutes = alert on the dashboard
- Students without a strap (below Grade 1) aren't tracked on the bus; the transport officer can mark them on the dashboard
- **Bus device (hardware on every bus):** BLE gateway + GPS + 4G SIM, powered from the bus. It **starts when the bus starts and stops when the bus stops**, so the trip starts and ends with the engine. It detects each student's strap on boarding and drop-off and reports location every few seconds. Reports are buffered when the signal is lost and sent on reconnect. There is no app for drivers or supervisors
- Problems on a trip (strap not detected, wrong stop, bus offline) appear on the dashboard for the transport officer
- Gateway health on the dashboard: online/offline, signal, GPS lock, tags in range
- **Live GPS** on a map for the school at all times; for parents **only during their own child's trip**
- ETA: "4 stops away · 6 min"; "bus approaching" push **two stops before** the child's stop
- Notifications: bus approaching, boarded, arrived at school, dropped home
- Alerts: student didn't board, missed drop-off, route deviation, speeding *(feature toggle)*
- Parent can report "my child won't ride today"
- Trip history and transport reports

### M3 · Canteen & Wallet **[MVP]**
Depends on **M9 Payments**.
- Prepaid **student wallet**; parents top up in the app
- Canteen menu with items, prices and categories
- **Canteen terminal (custom device with a screen and BLE):** reads the nearest strap and shows the **photo of the child who will be charged** plus the items, so the cashier always confirms before charging; one or more terminals per school depending on counters. If the strap fails, the cashier searches by name
- **No balance → pay cash:** cash sales are recorded on the terminal too, so reports cover all sales
- Menu, prices and canteen staff are managed by the school
- **Parental controls:** daily spending limit, blocked items, allergy warnings at checkout
- Real-time notification to the parent: "Lunch · 24 EGP"
- Pre-ordering meals *(feature toggle) **[Later]***
- Stock/inventory *(feature toggle) **[Later]***
- Sales and spending reports

### M4 · Activities & Clubs **[Phase 3]**
- Clubs and activities catalog: schedule, supervisor, capacity, age/grade limits
- Parents sign children up in the app, with waitlists
- Paid activities *(feature toggle; needs M9)*
- Activity attendance
- School trips: permission slips signed digitally by parents, payment, headcount on the day
- Events calendar and gallery (photos/videos per event)

### M5 · Academics: Timetable, Grades & Exams **[Phase 4]**
- Class timetable builder and teacher schedules
- Gradebook: assessments, weights, term grades
- Exam schedules and results
- Report cards as PDF (Arabic/English), published to parents
- Support for different grading systems (national, IGCSE, American) *(setting)*
- Student progress charts

### M6 · Homework & Learning **[Later]**
- Homework assignments with attachments and due dates
- Student submissions and teacher feedback
- Learning materials library per subject
- Online quizzes *(feature toggle)*
- Links to online classes (Zoom / Google Meet)

### M7 · Behavior & Teacher Notes **[Phase 4]**
- Teacher notes to parents (positive and concerns)
- Behavior points / merits *(feature toggle)*
- Incident reports
- Clinic visits: nurse log, parent notified *(feature toggle)*

### M8 · Communication & Messaging **[Phase 4]**
- Parent ↔ teacher chat, with configurable office hours
- Announcements to the whole school, a grade, a class, a bus or a club
- Surveys and polls
- Meeting booking for parent–teacher conferences *(feature toggle)*
- Emergency broadcast (push to all parents, WhatsApp to bus supervisors)

### M9 · Payments & Fees **[MVP, needed by Canteen]**
- Online payment gateway (Paymob / Fawry / cards / wallets / InstaPay) *(provider = setting)*
- Wallet top-ups (used by Canteen, Activities and Transport)
- **Tuition fees** *(feature toggle)*: fee structures, installments, invoices, sibling discounts, reminders for late payments
- Receipts and payment history for parents
- Finance reports for the school

### M10 · Admissions **[Later]**
- Online application form (public link)
- Applicant pipeline: applied → test/interview → accepted → enrolled
- Document upload
- Converting an accepted applicant into a student record in one click

### M11 · Reports & Analytics
- School dashboard (the "one screen" view): present / absent / on trip, buses live, canteen today
- Reports for each enabled module
- Export to Excel/PDF
- Multi-branch comparison *(feature toggle)*

### M12 · Platform Owner Console (for you, not schools)
- Create and onboard schools
- Assign plans and modules, set limits
- Subscription billing for schools
- Usage stats per school (active users, WhatsApp messages sent, storage, gateways online)
- Support access (impersonate a school admin, with an audit trail)

---

## 3a. Hardware layer: BLE tags and gateways

All automatic tracking uses Bluetooth Low Energy, across every module.

- **Student straps:** students above a set age wear one **FSC-BP107D** BLE beacon strap all day. Straps belong to the parents, are configured by Ahmed before handover (broadcast interval, power), have a ~6-year replaceable battery, and are reassigned when replaced. Staff don't wear straps.
- **Custom gateways** (built in-house): each one scans for BLE tags and reports sightings to the platform.
  - **Fixed gateways:** school gates, every classroom, clinic and club rooms. Uplink over Ethernet or Wi-Fi.
  - **Canteen kit:** an ESP32 BLE unit paired with an Android tablet that runs the point of sale and shows the child's photo.
  - **Bus device:** ESP32 BLE gateway + GPS + 4G modem. Powered from the bus ignition **plus its own backup battery**, so it can report its last position after the engine stops. Reports location and straps on board every few seconds and buffers reports while offline.
- **Detection rules** (per zone, set in Devices): a tag sighting only becomes an event once it passes a signal-strength threshold and a minimum time in range, e.g.:
  - Gate: seen 3 s at −70 dBm or stronger → Arrived / Left
  - Bus: seen 10 s after the doors close → Boarded / Dropped off
  - Canteen counter: strongest tag at −55 dBm or stronger → identifies the buyer (cashier confirms name and photo)
  - Clinic / club rooms: seen 60 s → Visit / Attended
- **Devices screen (part of Core):** gateway list with location, uplink, signal, firmware and status; tag inventory with battery level and last sighting; claim-code pairing for new gateways; firmware update status.
- **Open questions for the gateway design:**
  - **Decided:** gateways are **ESP32**-based and talk to the platform over **MQTT over TLS**, each with its own credentials.
  - **Room assignment rule:** when several gateways hear the same strap, the one with the strongest signal wins, so a strap heard through a wall from the next classroom isn't counted there.
  - Tags broadcast an ID that anyone nearby can read; the strap is configured before handover, so check whether it can use a rotating or encrypted ID.
  - Canteen identification when several children stand at the counter.
  - Tell apart a strap that is really in the room from one heard through a wall from the next classroom.

## 4. Apps and who uses them

| App | Users | Main screens |
|---|---|---|
| **Staff Dashboard** (web, incl. classroom PCs) | School admin, teachers, transport officer, nurse, canteen staff | Students, attendance and exceptions, transport map, canteen, activities, grades, messages, reports, settings, devices |
| **Parent App** (iOS/Android) | Parents | Child's day timeline, live bus, wallet, clubs, grades, messages, payments. Switch between siblings |
| **Canteen terminal** (BLE device) | Canteen staff | Identify the student by strap, charge the wallet |
| **Owner Console** (web) | You | Schools, plans, modules, billing |
| **Student App** *(Later)* | Older students | Timetable, homework, grades |

Every screen, tab and menu item appears **only if its module is enabled** for that school.

## 5. Plans (what schools buy)

| Plan | What's in it | Hardware |
|---|---|---|
| **Essentials** | Core, parent app, manual attendance on classroom PCs (every period), announcements, basic reports | None |
| **Smart** | Essentials + **automatic BLE attendance**, Transport, Canteen & wallet, Payments | Gateways, bus devices, canteen kit, straps |
| **Complete** | Smart + Activities, Academics, Behavior & notes, full Messaging, Reports & analytics | Same as Smart |
| **Add-ons** | Homework, Admissions, Tuition fees, school-branded app | — |

Essentials lets a school start with no hardware and upgrade later without changing systems.

## 6. Build phases

Each phase ends with something a school can use and pay for. Nothing gets rebuilt later.

**Phase 0 · Groundwork** (in parallel with Phase 1)
- Product name, domain, WhatsApp Business account
- Hardware costs → pricing calculator → first quotes
- Radio tests: straps and ESP32 gateways in real rooms (walls, thresholds, battery)
- Hosting (EU region for development) and a data-protection check

**Phase 1 · Attendance (first sellable release: Essentials + Smart attendance)**
- Core: school, classes, rooms, users and roles, students and the two parents, Excel import, module switches, audit log
- Simple timetable: periods, classes and rooms
- Manual attendance on the classroom PC, every period
- Automatic attendance: ESP32 gate and classroom gateways, MQTT ingestion, strongest-gateway room rule
- Devices: pair gateways, assign straps, health and battery
- Exceptions on the dashboard; gateway offline → manual; correction windows
- Parent app: day timeline, push notifications, consent at sign-up
- Owner console (basic): create a school, set plan and modules

**Phase 2 · Transport**
- Bus device: ESP32 + GPS + 4G, ignition + backup battery
- Trips from leaving to re-entering the school area; morning or afternoon by time of day
- Boarding and drop-off by strap; parent taps "Received"; alerts on the dashboard and WhatsApp to the supervisor
- Live bus for parents during their child's trip; "bus approaching" two stops before

**Phase 3 · Payments & Canteen**
- Payment provider, wallet top-ups, receipts
- Canteen kit: ESP32 BLE unit + Android tablet POS, photo confirmation, cash sales, end-of-day cash count
- Parental controls: daily limit, blocked items, allergies
- Strap purchase and replacement in the app

**Phase 4 · School life**
- Activities & clubs, trips and permission slips, events
- Academics: grades, exams, report cards (built on the Phase 1 timetable)
- Behavior & notes, clinic visits
- Messaging: parent–teacher chat, announcements, polls, meetings, emergency broadcast

**Phase 5 · Business & add-ons**
- Reports & analytics, multi-branch
- Owner console: billing, usage, support access
- Add-ons: Homework, Admissions, Tuition fees, school-branded app

## 7. Open decisions

- Product name (suggestions in the chat)
- Payment provider for Egypt (Paymob, Fawry, etc.)
- Actual prices: need hardware and running costs (see section 9)
- Permanent hosting location, after checking Egypt's data-protection law; development starts on an EU cloud region

## 8. Decisions so far

| # | Question | Decision |
|---|---|---|
| A1 | First customer | No pilot school yet. Ahmed markets the product himself, so a demo school and a pilot offer are needed before launch |
| A2 | Target schools | All types: national, language, international, nurseries. Curriculum, grading and KG handling stay configurable per school |
| A3 | Market | Egypt only at first (EGP, Egyptian payment providers, Arabic + English) |
| A4 | Pricing | See section 9 (proposal to validate with schools) |
| A5 | Installation & maintenance | Ahmed installs and maintains all hardware. Devices must be quick to install, pair with a claim code and be monitored remotely |
| A6 | Parent app | One shared app for all schools first; a school-branded app is a paid add-on |
| B7 | Who wears a strap | Only students above a set age; younger children are marked manually on the classroom PC |
| B8 | Strap ownership | The parent owns it and pays for a replacement |
| B9 | How it's worn | On the wrist all day |
| B10 | Strap settings | Configured (broadcast interval, power) before handover |
| B11 | Swapped straps | Risk accepted; teachers spot-check the class list on the PC |
| B12 | Battery | About 6 years, replaceable |
| B13 | Staff straps | No. Staff attendance is not tracked by the system |
| C14 | Meaning of present | Gate = in school; classroom gateway = in lesson; seen at the gate but in no class after 10 minutes = alert on the dashboard |
| C15 | Period attendance | Every period is recorded; a student must attend all lessons |
| C16 | Corrections | Teacher can fix today's record, admin can fix any record; every change is logged |
| C17 | Gateway offline | The class switches to manual marking automatically |
| C18 | Who handles exceptions | Any exception can be handled by the responsible role while it is still within its time window; after that it needs higher privileges (admin) |
| C19 | Absence message | Sent at a fixed time set by the school |
| D20 | What a trip is | From the start of the route to its finish, not from engine on to engine off |
| D21 | Morning or afternoon trip | Decided by the time of day |
| D22 | Strap not detected on boarding | Alert to the transport officer on the dashboard plus WhatsApp to the bus supervisor |
| D23 | Bus approaching | Push to the parent two stops before |
| D24 | Drop-off | Needs both the gateway detecting the child leaving and a confirmation that the child was received |
| D25 | Bus device power | Bus ignition plus its own backup battery |
| E26 | Canteen counters | Depends on the school; several terminals supported |
| E27 | Canteen terminal | Custom device with a screen showing the photo of the child who will be charged and the items |
| E28 | Confirm every charge | Yes |
| E29 | No balance | Child pays cash; cash sales are recorded too |
| E30 | Who runs the canteen | The school |
| F31 | WhatsApp number | One shared number for all schools (bus supervisors' alerts); parents' numbers are checked in person at registration |
| F31a | Parent sign-in | Email + password. The school enters the parent's email first; the parent signs up in the app with a code sent to it |
| F32 | Channel for parents | App push for everything |
| F33 | Parents without the app | Not supported; parents must install the app |
| G34 | Parent accounts | Only the two parents |
| G35 | Live bus for parents | Only during their own child's trip |
| G36 | Separated families | The school can restrict what one parent sees |
| H37 | Data location | Not decided yet |
| H38 | Location and presence history | Raw sightings and GPS kept for **one week**, then only attendance records and daily summaries |
| H39 | Parent consent to tracking | Required, collected in the app at sign-up |
| I40 | Team | Ahmed alone |
| I41 | Gateway hardware | ESP32, MQTT over TLS |
| I42 | Timeline | As soon as possible |
| R1 | Strap age | Grade 1 and up |
| R2 | Children without straps on the bus | Not tracked; the transport officer can mark them on the dashboard |
| R3 | Receiving the child at drop-off | Parent taps "Received"; no confirmation in 10 minutes = dashboard alert |
| R4 | Trip start and end | Starts when the bus leaves the school area, ends when it comes back into it |
| R5 | Present / late in a lesson | Present if seen 70% of the period; late if first seen after 10 minutes |
| R6 | Correction window | Teacher until end of day; after that, admin only |
| R7 | Rooms without gateways | Every lesson room gets a gateway. Automatic attendance is optional: a school can run on classroom PCs only |
| R8 | Class on a trip | Teacher or admin marks it in advance |
| R9 | Leaving early without permission | Alert to the parent and the admin |
| R10 | Timetable | A simple timetable (periods and rooms) moves into the first release |
| R11 | Canteen hardware | ESP32 BLE unit paired with an Android tablet; canteen staff close the day on the tablet with the cash counted, and the admin sees any difference |
| R12 | Channels for parents | Push notifications from the app for attendance; email for account codes and school emails; no WhatsApp |
| R13 | Hosting | Development on an EU cloud region; permanent choice later |

## 9. How to charge schools

**Who pays:** the school signs a yearly contract and pays. Most schools will pass the cost to parents as a yearly "smart services" fee, so give them a ready-made fee sheet to send to parents. Straps are the one thing parents buy directly.

### Price lines

1. **Software, per enrolled student per year**, by plan (Essentials / Smart / Complete), plus a **minimum yearly fee per school** so small schools still cover support.
2. **Hardware rent, per device per year:** gate gateway, classroom gateway, bus device (4G data included), canteen kit (BLE unit + Android tablet). Rent includes installation, replacement of faulty devices and firmware updates. Set the rent so a device pays for itself within about two school years.
   - Schools that insist on owning hardware can **buy** it: one-time price plus a yearly maintenance contract of about 15–20% of the hardware price.
3. **Straps:** sold to parents (they own them) through the school at registration or in the app, at cost plus a margin. Replacements cost the same.
4. **One-time setup fee:** a base amount plus an amount per installed device. Covers installation, data import and staff training.

### Contract terms

- Yearly contract, billed **per term in advance**.
- **Two-year contract = discount**; multi-branch schools get a volume discount.
- **Price review clause:** software reviewed yearly for inflation; hardware tied to the dollar rate, because parts are imported.
- **Late payment:** after a grace period the school drops to read-only (parents still see history; nothing is deleted).

### Setting the numbers

- **Floor (your cost):** per student = cloud hosting + WhatsApp share + support time; per device = its cost spread over 24 months + 4G data + expected failures.
- **Ceiling (what schools will accept):** start from the assumption that the total yearly cost per student should be a small percentage of the school's yearly tuition, then test it.
- **Test before fixing prices:** quote three schools with different tuition levels and adjust from their reactions.

### Example school (quantities only)

600 students (540 from Grade 1 up), 24 lesson rooms, 2 gates, 6 buses, 1 canteen counter:
- Software: 600 × plan price per student
- Hardware rent: 26 gateways + 6 bus devices + 1 canteen kit
- Setup: base + 33 devices
- Straps: about 540, paid by parents

**Launch offer:** the first one or two schools get a discounted first year in exchange for a case study, a testimonial and feedback.

## 10. Recommended MVP and stack (solo, as soon as possible)

Building every module alone would take well over a year, so the first release does **one thing end to end**: attendance (manual and automatic), visible to parents.

**MVP (first school):**
1. Core: one school, users and roles, students and the two parents, Excel import, push notifications, audit log
2. Devices: pair gateways, assign straps, see gateway and strap health
3. Attendance: **both modes in the first release**. Manual mode (every period on the classroom PC, also the Essentials plan) and automatic mode (gate and classroom gateways, with the PC as fallback) ship together; exceptions on the dashboard; fixed-time absence push
4. Simple timetable: periods, classes and rooms
5. Parent app: child's day timeline, push notifications, consent at sign-up

Transport, then Canteen & Payments follow, then everything else. The module system is built from day one so nothing is rebuilt later.

**Stack (one language where possible, so one person can maintain it):**
- Backend: **NestJS (TypeScript) + PostgreSQL**, with an **MQTT broker** (e.g. EMQX or Mosquitto) that the backend subscribes to
- Staff dashboard and owner console: **Next.js (TypeScript)**
- Parent app: **Flutter** (iOS + Android from one codebase)
- Gateways: **ESP32** firmware (ESP-IDF or Arduino), MQTT over TLS; bus device adds a GPS module and a 4G modem
- Hosting: one managed cloud region to start; before choosing it, check the rules on storing children's data outside Egypt under Egypt's Personal Data Protection Law (Law 151 of 2020)
