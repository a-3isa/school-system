# Design brief for Claude Design

Paste everything below the line into Claude Design. It describes the product, the people and every screen that exists today, so the new design covers all of it.

---

Design the interface for a school attendance platform: a **web dashboard** for school staff and a **parent mobile app**. Everything below is already built and working; I want a new, crafted visual design and better UX for it, not new features. Avoid the generic "AI dashboard" look (purple gradients, glassmorphism, stock icons in coloured circles, everything in cards with big shadows). It should feel calm, trustworthy and made for schools in Egypt.

## The product

Schools in Egypt (private and international first). Every student from Grade 1 up wears a small BLE strap all day. Gateways at the school gate and in each classroom hear the straps, so the platform knows:
- when each child arrives
- which room they are in, minute by minute
- whether they attended each lesson

Parents are told as things happen. Attendance also works **without** straps: teachers mark it on the classroom PC.

Two attendance modes per school:
- **Manual:** teachers mark each lesson (Present / Late / Absent / Excused).
- **Automatic:** the straps decide each lesson when it ends. Teachers only correct the children the strap got wrong, for example a forgotten strap.

## The people and where they use it

1. **Teacher:** on the classroom PC at the front of the room, often with a class waiting. Signs in with email and password and lands on **"My class now"**, the lesson in front of them. Needs to see in two seconds who isn't in the room, and fix a forgotten strap with one tap. Large tap targets; readable from a step back; no clutter.
2. **School admin:** at a desk, all day. Watches today's attendance, deals with exceptions, finds where a child is, sets up the school (classes, rooms, timetable, staff, students, devices).
3. **Owner** (the platform operator): creates schools, chooses plans, switches modules, registers gateways.
4. **Parent:** on a phone, Arabic or English, glances at notifications. "Salma arrived at school 07:42", "Salma was absent from Math in Room 204", "Salma is in Math in Room 204". Wants their child's day at a glance and to trust the messages.

## Screens to design

### Dashboard (desktop first, must work on a tablet)
- **Sign in:** email and password.
- **Shell:** sidebar navigation grouped by role. Show the school name and the signed-in person. Teachers see only: My class now, Today, Take attendance, Exceptions, Where students are, Students, Timetable.
- **My class now** (teacher, the most important screen):
  - **Header:** class, subject, room, period and time, e.g. "4-A · Math · Room 204 · Period 3 · 09:50–10:35".
  - **Summary line:** "9 of 12 are in the room now", updated every 15 seconds.
  - **One row per child:** name and code, then a live state:
    - **In the room**
    - **Not in the room**, with "Last heard: Gate A, 07:42" and "Parents told at 10:00"
    - **No strap**
    - **Not heard today**
  - **Each row also has:** the status control P / L / A / E (preset from the strap; the children not in the room come first, preset to A), what's recorded ("Decided when the lesson ends" or "Present · by Hana Nabil · Strap forgotten"), and a reason dropdown.
  - **Save button** with a count ("Save 1").
  - **Empty state:** no lesson now; show the next lesson.
- **Today:**
  - **KPIs:** students and how many came in through the gate, present (latest period), absent, needs attention.
  - **Lists:** today's lessons with marking progress, things needing attention, and attendance by period (present / late / absent / excused / on a trip).
- **Take attendance:** today's lessons for the teacher (or all lessons for an admin), each with progress and an Open button. A past day is read-only for teachers.
- **Lesson roster:** the same as My class now, for any lesson and date. In manual mode it has "Mark the rest present".
- **Exceptions:** a list of things a person should look at, each with a type tag and Resolve with a note:
  - "Salma Gamal came in at 08:20 but hasn't been in 4-A Math in Room 204 (period 3)"
  - "Ali was in 4-A Science for only 40% of the lesson"
  - "Gateway in Room 205 offline, mark manually"
  - "Science lab has no gateway"
  - "Low strap battery"
  - "Left early"
- **Where students are** (live map without a map), refreshing every 10 seconds:
  - **KPIs:**
    - heard in the last 10 minutes
    - not heard for 10+ minutes (only during school hours)
    - out of school
    - not heard today
  - **A "Needs a look" table:** name, class, last heard, where.
  - **A panel for each place:** each room and the gate, with the children in it as name chips. A chip shows "4 min ago" when not fresh.
  - **Panels for:** "Went out through the gate" (with times), "Gone for the day", "Not heard today".
  - **Controls:** search and class filter.
- **Students & parents:** searchable, filterable table (name with Arabic name below, code, class, parents) and an "Add a student" form.
- **Student page:**
  - parents (at most mother and father), with Restrict and Remove, and an add-parent form
  - **Where today:** a timeline, e.g. "07:49–07:49 Gate A", "08:00–09:29 Room 204"…
  - attendance for the last two weeks (date, period, status, how: strap or manual with reason)
- **Import from Excel:**
  1. Download the template.
  2. Upload the file.
  3. Check step: a summary plus a row-by-row list of problems.
  4. Import.
- **Staff:** accounts table (name, role, email, active) and an add form.
- **Classes, rooms & periods:** four small editors.
- **Timetable:** a week grid (days × periods) per class, room or teacher. Each cell shows subject, room and teacher. Clash errors appear inline.
- **Devices:**
  - **Gateways:** claim by code; name; kind (gate or room); room; last seen; firmware.
  - **Straps:** address, student, battery, last seen.
  - **Detection rules form.**
- **Modules & settings:** attendance mode (Manual / Automatic), school days, time of the daily absence message, module feature switches.
- **Audit log:** who did what and when.
- **Owner console:**
  - **Schools:** a list with plan (Essentials / Smart / Complete) and module switches.
  - **Gateways:** register by serial; show the claim code and the one-time secret; "New secret".

### Parent app (phone)
- **Sign in:** mobile number, then "Send code by WhatsApp", then the 6-digit code; a password option as a fallback.
- **Consent:** a one-time screen explaining that the strap tracks the child at school, with "I agree" and "Not now".
- **Child's day:**
  - the child switcher (for two children)
  - arrival time at the gate
  - each lesson: period, subject, room, time, status
- **Notifications:** a list with unread state. The types:
  - arrived
  - absent from a lesson
  - back in the lesson
  - left early
  - absent today

## Constraints

- **Language:** Arabic and English. Layouts must work right-to-left; numbers and times may stay Latin. Use typefaces with good Arabic, for example IBM Plex Sans Arabic or Noto Kufi/Naskh Arabic, paired with a Latin face.
- **Time:** Cairo time, 24-hour clock ("07:42").
- **Status colours** must be told apart without colour too (label or shape):
  - Present: calm green
  - Late: amber
  - Absent: clear red, not alarming
  - Excused and on a trip: blue or neutral
- **Accessibility:** WCAG AA contrast; visible keyboard focus.
- **Classroom PC:** 1366×768 or 1920×1080, sometimes a touch screen.
- **Parent app:** works on cheap Android phones; light and dark.
- **Motion:** live updates must not jump the layout or steal focus. Indicate "updated just now" quietly.
- **Copy:** short plain sentences, like the examples above. No jargon (no "RSSI", "gateway" only in admin screens).

## Sample data to use

- **School:** Nile Valley School (demo). Classes 4-A and 4-B, Rooms 204 and 205, a Science lab, Gate A.
- **Teachers:** Hana Nabil, Sherif Kamal.
- **Students:** Layla Hussein, Omar Ramadan, Yara Adel, Ali Kamal, Karim Fathy, Salma Gamal, Mariam Mostafa, Youssef Nabil, Hana Hussein, Ziad Ramadan, Nour Adel, Adam Kamal.
- **Periods:** 08:00–08:45, 08:45–09:30, 09:50–10:35, 10:35–11:20, 11:40–12:25, 12:25–13:10.

## What I want back

1. A design direction: colour tokens (light and dark), type scale for Arabic and English, spacing, radius, and the status colour system.
2. Components: sidebar, page header, KPI tile, table, status control (P/L/A/E), live-state badge, name chip, place panel, timeline, notice/alert, form fields, empty states, toast.
3. Full screens, in this order:
   1. My class now: live during a lesson, with 3 children not in the room
   2. Where students are
   3. Today
   4. Exceptions
   5. Student page
   6. Parent app: child's day, notifications, sign-in
   7. The rest
4. Each key screen in Arabic (RTL) as well as English.
