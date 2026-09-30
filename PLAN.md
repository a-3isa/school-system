# School Platform — Product Plan & Module Catalog

> **One platform. Every part of school life.**
> Ahmed Ibrahim Hussien · Cairo, Egypt
> Source: `school-platform-vision` deck (Google Drive, Aug 2026)

## 1. Vision

Schools run many disconnected systems (records, attendance, transport, canteen,
activities, parent communication), so nobody sees the whole picture. This platform
puts **one student record** underneath all of them, with two front doors:

- **Staff Dashboard** (web): admins, teachers, transport officers, nurse, canteen staff (canteen POS runs in the browser on a tablet)
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
6. **Limits per school:** number of students, SMS credits, storage and buses, so
   pricing can be per student or per module.

## 3. Module catalog

Legend: **[MVP]** in the first release · **[Later]** after the MVP

---

### M0 · Core Platform — *always on*
The student record and the front door.

- **Multi-school (multi-tenant):** each school's data is fully isolated; one install serves many schools
- **School profile:** name, logo, colors (white-label), branches/campuses, academic year and terms
- **Academic structure:** stages → grades → classes/sections, subjects
- **Student records:** profile, photo, national ID/birth certificate, medical notes and allergies, emergency contacts, guardians (several per student), siblings linked to one parent account
- **Staff records:** teachers, admins, drivers, supervisors, canteen staff
- **Users, roles & permissions:** built-in roles (Owner, School Admin, Teacher, Transport, Nurse, Canteen, Accountant, Parent, Student). Drivers and bus supervisors are contacts on a bus, not app users plus custom roles with fine-grained permissions
- **Authentication:** phone number + OTP (SMS/WhatsApp), email/password, password reset, device sessions
- **Bulk import/export:** Excel/CSV import for students, parents and staff
- **Notifications engine:** push, SMS, WhatsApp and email; per-user preferences; Arabic/English templates
- **Audit log:** who changed what and when
- **Languages:** Arabic (RTL) and English
- **Module manager:** the on/off switchboard for modules, features and limits
- **Files & documents:** upload and store student documents

### M1 · Smart Attendance **[MVP]**
- Daily attendance by class (teacher marks it in the app)
- Per-period attendance *(feature toggle)*
- Automatic check-in/out when a student's BLE tag is detected by a gate gateway
- Per-period presence with classroom gateways *(feature toggle, optional hardware)*
- Late arrival and early dismissal logging, with a reason
- Absence excuses: the parent submits one with an attachment, the school approves it
- Instant parent notification: "Arrived 7:42" / "Absent today"
- Staff attendance *(feature toggle)*
- Reports: daily summary (present / absent / late / on trip), chronic absence alerts, monthly export

### M2 · Bus Tracking & Transport **[MVP]**
- Buses, routes, stops, drivers and supervisors
- Assigning students to a bus, stop and pick-up time
- **Bus gateway (hardware on every bus):** BLE receiver + GPS + 4G SIM. Detects each student's BLE tag on boarding and drop-off automatically and reports location every few seconds. No app for drivers or supervisors; reports are buffered when signal is lost and sent on reconnect
- **Student BLE tags:** card or wristband per rider, with battery-level monitoring
- Gateway health on the dashboard: online/offline, signal, GPS lock, tags in range
- **Live GPS** on a map for parents and the school *(feature toggle)*
- ETA: "4 stops away · 6 min"
- Notifications: bus approaching, boarded, arrived at school, dropped home
- Alerts: student didn't board, missed drop-off, route deviation, speeding *(feature toggle)*
- Parent can report "my child won't ride today"
- Trip history and transport reports

### M3 · Canteen & Wallet **[MVP]**
Depends on **M9 Payments**.
- Prepaid **student wallet**; parents top up in the app
- Canteen menu with items, prices and categories
- Point-of-sale screen for canteen staff: the counter gateway picks the nearest BLE tag (or staff search by name), then staff charge the wallet
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
- Emergency broadcast (SMS + push)

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
- Usage stats per school (active users, SMS used, storage)
- Support access (impersonate a school admin, with an audit trail)

---

## 3a. Hardware layer: BLE tags and gateways

All automatic tracking uses Bluetooth Low Energy, across every module.

- **Student tags:** every student carries one **FSC-BP107D** BLE beacon. A tag is assigned to a student record once and reassigned when it's replaced.
- **Custom gateways** (built in-house): each one scans for BLE tags and reports sightings to the platform.
  - **Fixed gateways:** school gates, canteen counter, clinic, club rooms and (optionally) classrooms. Uplink over Ethernet or Wi-Fi.
  - **Bus gateways:** the same BLE scanner plus GPS and a 4G SIM. Reports location and tags on board every few seconds and buffers reports while offline.
- **Detection rules** (per zone, set in Devices): a tag sighting only becomes an event once it passes a signal-strength threshold and a minimum time in range, e.g.:
  - Gate: seen 3 s at −70 dBm or stronger → Arrived / Left
  - Bus: seen 10 s after the doors close → Boarded / Dropped off
  - Canteen counter: strongest tag at −55 dBm or stronger → identifies the buyer (cashier confirms name and photo)
  - Clinic / club rooms: seen 60 s → Visit / Attended
- **Devices screen (part of Core):** gateway list with location, uplink, signal, firmware and status; tag inventory with battery level and last sighting; claim-code pairing for new gateways; firmware update status.
- **Open questions for the gateway design:**
  - The protocol from gateway to platform (MQTT over TLS is the usual choice) and how each gateway authenticates.
  - Tags broadcast a fixed ID that anyone nearby can read, so decide whether to use rotating IDs or accept the risk.
  - Canteen identification when several children stand at the counter.
  - Tag battery life and a replacement process.

## 4. Apps and who uses them

| App | Users | Main screens |
|---|---|---|
| **Staff Dashboard** (web) | School admin, teachers, transport officer, nurse, canteen staff | Students, attendance, transport map, canteen, activities, grades, messages, reports, settings |
| **Parent App** (iOS/Android) | Parents | Child's day timeline, live bus, wallet, clubs, grades, messages, payments. Switch between siblings |
| **Owner Console** (web) | You | Schools, plans, modules, billing |
| **Student App** *(Later)* | Older students | Timetable, homework, grades |

Every screen, tab and menu item appears **only if its module is enabled** for that school.

## 5. Suggested plans for marketing

| Plan | Modules |
|---|---|
| **Basic** | Core, Attendance, Communication (announcements only) |
| **Standard** | Basic + Transport + Canteen & Wallet + Payments |
| **Premium** | Standard + Activities + Academics + Behavior + full Messaging + Analytics |
| **Add-ons** | Tuition fees, Admissions, Homework, extra gateways and BLE tags (hardware), white-label app |

## 6. Build phases

1. **Foundation:** Core (tenants, module manager, users/roles, students, staff, parents, auth, notifications) + Attendance
2. **Daily Life:** Transport + Payments + Canteen & Wallet + Parent App day timeline
3. **Engagement:** Activities & Clubs, trips, events
4. **Connection:** Academics/grades, teacher notes, messaging, reports
5. **Later:** Homework, Admissions, tuition fees, advanced analytics

Each phase adds to what's already running. Nothing gets rebuilt.

## 7. Open decisions

- Tech stack (backend, web dashboard, mobile apps, database)
- Hosting (cloud provider, region, data residency)
- Gateway firmware and uplink protocol (see 3a)
- Payment gateway choice for Egypt
- Pricing model: per student / per module / flat
