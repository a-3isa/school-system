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

**There is one design, not two.** Straps are an optional subscription. With them, attendance starts from the straps, a teacher only corrects a child who forgot their strap, and the school also gets tracking (where students are). Without them, the teacher takes the register. **The attendance screen is the same in both cases and for every role.** The only extra layer with straps is the tracking: a short line under each name in the list, plus a few screens that simply don't exist for schools without straps (marked "straps only" below).

## The people, and the screens each one has

Each role sees only its own screens. Design each role's navigation separately; nobody sees an item they can't use.

### 1. Teacher: classroom PC at the front of the room, often with a class waiting
Signs in with email and password. The teacher only opens the PC for one reason: a child forgot their strap (or, at a school without straps, to take the register). So the teacher has **one screen only, and it is the same design with or without straps**. No menu, no other pages, no school-wide data.

**My class now:**
- **Header:** class, subject and room, with the period and time, e.g. "4-A · Math · Room 204 · Period 3 · 09:50–10:35". One big **Save** button with a count ("Save (1)"), or "Saved".
- **Summary line:** "11 present · 1 absent", plus one short sentence:
  - with straps: "from the straps, updated every 15 seconds. Tap Present for a child who forgot their strap."
  - without straps: "everyone starts as present. Tap the absent ones, then Save."
- **The list:** one large row per child (name), with large buttons **Present / Late / Absent / Excused**. An absent row is tinted. This is **the attendance screen for everyone**: the admin opens exactly the same screen from Take attendance.
  - **With straps (straps only):** each row starts as the strap says, and a small line under the name says why: "In the room", "Not in the room · last heard Gate A, 07:42 · parents told 10:00", "No strap" or "Strap not heard today". Absent children come first.
  - **Without straps:** everyone starts as Present.
  - **After saving:** a row shows "Saved by Hana Nabil".
- **Nothing else:** no reason box (filled in automatically), no "manual/automatic" switch, no columns.
- **Between lessons:** "No lesson right now. Next: 4-A Math in Room 204 at 09:50."
- **Design for:** a PC screen read from a step away, and touch screens. Big names and big buttons; the one child who needs a tap must jump out.

### 2. School admin: at a desk, all day
Watches today's attendance, deals with exceptions, finds where a child is, registers students and parents, and sets up the school.

Navigation, grouped:
- **Overview**
  - **Today:**
    - KPIs: students (with "came in through the gate", straps only), present (latest period), absent, needs attention
    - lists: lessons today with marking progress, things needing attention, attendance by period (present / late / absent / excused / on a trip)
    - **Messages** to the school, with "Mark read": e.g. "Amr Gamal changed their mobile: checked a new mobile, +201222222222, when signing up in the app. It replaces +201111111111." 
- **Attendance**
  - **Take attendance:** every lesson, any date, each with marking progress; opening one shows **the same attendance screen as the teacher's** (no separate admin design).
  - **Exceptions:** a list of things to look at, each with a type tag and Resolve with a note:
    - "Salma Gamal came in at 08:20 but hasn't been in 4-A Math in Room 204 (period 3)"
    - "Ali was in 4-A Science for only 40% of the lesson"
    - "Gateway in Room 205 offline, mark manually"
    - "Science lab has no gateway"
    - "Low strap battery"
    - "Left early"
  - **Where students are** (straps only; a live map without a map), refreshing every 10 seconds:
    - **KPIs:** heard in the last 10 minutes, not heard for 10+ minutes (only during school hours), out of school, not heard today
    - **A "Needs a look" table:** name, class, last heard, where
    - **A panel for each place:** each room and the gate, with the children in it as name chips; a chip shows "4 min ago" when not fresh
    - **More panels:** "Went out through the gate" (with times), "Gone for the day", "Not heard today"
    - **Controls:** search and class filter
- **People**
  - **Students:** a searchable, filterable table (name with Arabic name below, code, class) and "Add a student".
  - **Add a student:** one long form in sections: student (name, Arabic name, suggested code, nationality, national number that fills in the birth date and gender, gender, date of birth with the age on 1 October, place of birth, religion), at school (class, joined on, previous school, address), health and emergency contact, parents (first required, add up to three), and photo and papers (one row per paper with a thumbnail and "Choose photo or scan"; the photo and birth certificate are required).
  - **Student page:**
    - **Header** with the student's photo.
    - **Details** with "Edit details", and **Photo and papers** (thumbnails, "Still needed" when the photo or birth certificate is missing).
    - **Parents** (mother, father and one guardian at most; at least one). Each name opens the parent's page; the class opens the class page. Each shows name, email, mobile, and two status tags: "Signed up in the app" or "Not signed up yet", and "Mobile checked by WhatsApp" or "Mobile not checked yet". Actions: Restrict, Remove.
    - **Add-parent form:** relation, name, **email (required)**, mobile (optional). Explain under it that the parent signs up in the app with this email, and that their mobile is checked by WhatsApp then and saved here.
    - **Where today** (straps only): a timeline, e.g. "07:49 Gate A", "08:00–09:29 Room 204"…
    - **Attendance for the last two weeks:** date, period, status, and how (strap, or manual with the reason).
  - **Parents:** a searchable table (name, children with relation and class, email, mobile).
  - **Parent page:** details (email, mobile, sign-up and WhatsApp tags, tracking consent), their children (each opens the student page, the class opens the class page) and "Link a child".
  - **Classes:** a table (class, grade, homeroom teacher, students).
  - **Class page:** grade, homeroom teacher, and the students with their parents; every name links to its page.
  - **Import from Excel:** download the template, upload, a check step (summary plus a row-by-row list of problems), import. Columns include the mother's, father's and guardian's email (required for each one given; at least one per student) and mobile (optional).
  - **Staff:** accounts table (name, role, email, active) and an add form.
- **School setup**
  - **Timetable:** a week grid (days × periods) for a chosen class; each cell shows subject, room and teacher; add or remove lessons; clash errors inline.
  - **Classes, rooms & periods:** four small editors.
  - **Devices** (straps only):
    - **Gateways:** claim by code; name; kind (gate or room); room; last seen; firmware.
    - **Straps:** address, student, battery, last seen.
    - **Detection rules form.**
  - **Modules & settings:** school days, time of the daily absence message, module feature switches, and a read-only line "Automatic attendance (straps): in your subscription / not in your subscription". There is no attendance-mode choice.
  - **Audit log:** who did what and when.

### 3. Owner (the platform operator): runs the platform for many schools
Navigation:
- **Schools:** a list with plan (Essentials / Smart / Complete), create a school with its first admin, module switches per school, and under Attendance the **Automatic attendance (straps)** switch, which is the subscription.
- **Gateways:** register by serial; show the claim code and the one-time secret; "New secret".

### 4. Parent: on a phone, Arabic or English
Glances at notifications and wants to trust them. Parents don't use the dashboard.

Screens:
- **Sign in:** email and password, with two links:
  - **New here? Create your account:** three steps with a step indicator.
    1. **Email:** explain it must be the email the school registered. Then "Send me a code".
    2. **Code and mobile:** the code from the email, then the mobile number with country code (prefilled "+20"). Then "Send a WhatsApp code". Say what to do if no email arrives (ask the school to check the email).
    3. **WhatsApp code and password:** the WhatsApp code and a new password. Then "Create account", plus "No code, or wrong number? Fix the number and send again".
  - **Forgot password?:** email, then the code from the email and a new password.
- **Consent:** a one-time screen explaining that the strap tracks the child at school, with "I agree" and "Not now".
- **Child's day:**
  - the child switcher (for two children)
  - arrival time at the gate
  - **where the child is now** (straps only): the room or the gate where the strap was heard in the last minute, e.g. "In Math, Room 204 · heard 09:41"
  - each lesson: period, subject, room, time, status
- **Account:** name and email; mobile with "Checked on WhatsApp"; **Change mobile** (new number, then the WhatsApp code, then "Your mobile is now … The school has been told."); sign out.
- **Notifications:** a list with unread state. The types:
  - "Salma arrived at school"
  - "Salma was absent from Math in Room 204"
  - "Salma is in Math in Room 204"
  - "Salma left school early"
  - "Salma is absent today"

### Shared
- **Dashboard sign-in** (teachers, admins, owner): email and password, with **Forgot password?** (email, then the code from the email and a new password).
- **Shell:** a sidebar grouped as above, showing the school name and the signed-in person with their role.

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
3. Full screens, by role, in this order:
   1. Teacher: My class now, with straps (one child shown absent, about to be tapped Present) and without straps (everyone present, one tapped Absent), and between lessons
   2. Parent app: sign in, create account (all three steps), child's day, notifications, account with change mobile
   3. Admin: Where students are, Today, Exceptions, Student page (with parents' sign-up status), then the rest
   4. Owner: Schools, Gateways
4. Each key screen in Arabic (RTL) as well as English.
