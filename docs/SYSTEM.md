# What the system does (Phase 1)

This describes every part that exists in the code today. Phase 1 is attendance. It works with or without the BLE straps and gateways, on one platform you run for many schools.

---

## The pieces

| Piece | Who uses it | Where it runs |
|---|---|---|
| **Server (API)** | Everything talks to it | A server you host (NestJS + PostgreSQL) |
| **Dashboard** | You (owner), school admins, teachers | Any browser, including the classroom PC |
| **Parent app** | Parents and guardians (mother, father or another responsible adult, each with their own account) | Phone (Flutter; Android, iPhone, web) |
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
  - Messaging comes in two sizes: **Essentials and Smart** get announcements and the emergency message; **Complete** adds parent–teacher chat, polls and meetings. Changing a school's plan sets these for it.
- **Module switches:** turn any module on or off per school, and the features that come with the subscription: **automatic attendance (straps)** inside Attendance, and **chat, polls and meetings** inside Messaging. A school's own admin can't switch these; they see "In your subscription" or "Not in your subscription".
  - Other features (for example, trips or merit points) are the school's own to switch in **School settings**.
  - Switching one on also switches on what it needs; for example, Transport needs Attendance.
  - Switching one off is refused while another module still needs it.
- **Gateways:** register each gateway before it ships. You get:
  - a **serial**
  - a **claim code**, to print on its label
  - a **secret**, to write into its settings
- **New secret:** gives a gateway a new secret if the old one is lost; the old one stops working at once.

## 3. School setup (admin)

- **Getting your school ready.** A new school has a long chain to set up, each step needing the ones before it: year groups and classes, the school year, subjects (and which year group studies which), classrooms and periods, teachers, who teaches each subject in each class, the timetable, then students. Until every step is done, **Today** opens with a checklist of them in that order: how far it has got, the next step first and highlighted, and a button on each that goes straight to the right place (School structure & year, Faculty & staff, Timetable, Add a student). It disappears by itself once all eight are done. School structure & year has links across its top to jump between its sections.
- **School settings:**
  - school days (Sunday–Thursday by default)
  - the time of the daily "absent today" message (08:15 by default)
- **Grades, classes, rooms, subjects and bell periods.** Periods can't overlap.
- **How the school is organised (as in Egypt):**
  - **stages and grades:** KG (2 years), primary (6), preparatory (3), secondary (3). "Add these grades" creates the grades of the ticked stages with their English and Arabic names (Primary 4 · الصف الرابع الابتدائي); a school can add its own grades too
  - **classes:** a grade and a section (4/1, Prep 2/3, Sec 1/2), with the system it follows (national Arabic, national languages, British, American, IB, French, German, Al-Azhar), boys, girls or mixed, the secondary stream (science, mathematics, literary; secondary only), the number of places and the homeroom teacher. The Classes tab groups classes by stage and shows how full each is; adding a student to a full class warns
  - **school year:** first and last day, when the second term starts and the mid-year break. Outside the year, on the break, on the weekend and on holidays there is no school: no attendance, no "absent today" messages, no lesson alerts, and Today and the teacher's screen say why ("No school today: Armed Forces Day")
  - **holidays:** "Add Egypt's fixed holidays" adds the fixed public holidays that fall on a school day of the year (Coptic Christmas, 25 January, Sinai Liberation Day, Labour Day, 30 June, 23 July, Armed Forces Day). The Eids, the Hijri new year and the Prophet's birthday move with the moon, so the school adds them when announced
  - a school without a school year keeps working as before: every school weekday counts
- **Social worker:** a staff role (أخصائي اجتماعي) that sees students, attendance and exceptions and resolves exceptions, to follow up absences with families.
- **Subjects.** Each has a name in English and, optionally, in Arabic; Arabic screens, the parent app and report cards show the Arabic one when it is there. Student Affairs can fix a name later. On Student Affairs' **Subjects** list each subject shows how many year groups and classes use it, and opening it shows where: its year groups (with the lessons a week), and its classes with their teachers and lessons. A subject can be deleted as long as no lesson in the timetable and no mark uses it, and deleting it also takes it out of its year groups and classes (and the teachers given it there); the confirmation says how many.
- **Timetable:** for each day and period, which class is in which room, with which subject and teacher. Clashes are refused with a clear message: the same class, room or teacher twice at once.
- **Periods, year groups and classes.** The bell schedule (the periods) belongs to the school: it is the same for every grade and class. What changes **from grade to grade is the subjects** (a year group has its own list, set under School structure & year, with the lessons a week of each if the school counts them), and what changes **from class to class is the distribution**: who teaches each subject there, and where each subject sits in the week. A new class studies its year group's subjects straight away; a subject added to a year group appears in all of its classes.
- **Who teaches a subject.** The school **assigns subjects to teachers, class by class**: under **Teachers of this class** (on the Timetable page) each of the class's subjects gets **one teacher**, so all of its lessons are theirs, and the lessons themselves are the teacher's own responsibility. This is the one fact read everywhere: who sees the subject in the Gradebook and marks it (even before it is in the timetable), who takes its attendance, and whose subject a parent sees when writing or booking a meeting. The same subject can have different teachers in different classes (Maths is Ms. Hana's in 4/1 and Mr. Karim's in 4/2); a teacher can teach several classes. Handing a subject to another teacher is one change: all of its lessons move, the new teacher takes over its assessments and marks, and it is refused, with nothing moved, if that teacher is already in another class at one of those times.
- **Building a class's week.** Choose a period and then a subject from the class's own subjects: the teacher comes with it (shown beside the subject). A subject with no teacher yet asks for one the first time it is placed, and that person then takes the whole subject in the class; a teacher already in another class at that time can't be chosen. Until a subject has a teacher, only Student Affairs can mark it.
- **Copying a week.** Classes of one year group have the same subjects in the same periods, so a class's week can be copied to another class of its year group (**Copy this week to another class**, on the Timetable page; a class with no lessons yet offers **Copy 4/1's week** for each sibling that has one). Student Affairs picks the class, and the classroom for its lessons (the one that class already uses is suggested), and whether to fill only its empty periods or replace its week. Each copied lesson takes **the new class's own teacher** for the subject, not the first class's. A lab or hall can't hold two classes at once, so a lesson held in one takes a free room of the same kind. Lessons that can't go in (the room or the teacher is busy then) are listed afterwards instead of being dropped silently, and so are subjects the new class has no teacher for yet: those lessons are copied with no teacher and take theirs as soon as one is chosen under **Teachers of this class**. Periods the class had already filled are left alone and counted.
- **Staff accounts:** add teachers and other staff; reset passwords; deactivate. Each person has a **profile** (open it from their name in Faculty & staff). A teacher's profile shows the classes and subjects they teach with the lessons a week, the classes they lead as class teacher, and their week as a timetable. A teacher sees their own under **My profile**.
- **Students:**
  - added on their own screen (**Add a student**), in sections:
    - **student:** name, full Arabic name, code (the next one is suggested), gender, date of birth (with the age on 1 October), nationality, the 14-digit **national number** for an Egyptian (it must agree with the birth date and gender; typing it fills them in) or a passport number, place of birth, religion (for religious education)
    - **at school:** class, the date they joined, previous school, home address
    - **health:** blood type, allergies, conditions and medication; an **emergency contact** besides the parents
    - **parents:** the first one is required; up to a mother, a father and a guardian at once
    - **photo and papers:** photos or scans (JPG, PNG, WebP or PDF, 5 MB each; big phone photos are shrunk first). The **student's photo** and **birth certificate** are required; the vaccination record, parents' IDs, previous school reports, transfer letter, passport and others are optional
  - name, code, gender, date of birth, nationality, the national number (Egyptians), a parent, the photo and the birth certificate are required; two students can't share a national number
  - the student page shows the photo, the details (**Edit details**) and the papers; the admin adds more papers there. Every staff member sees the photo; the nurse also the vaccination record; the other papers are for the admin
  - students imported from Excel or added before this keep working; their page lists the papers still needed
  - **at least one and at most three**: a mother, a father and a **guardian** (another adult responsible for the child, e.g. for an orphan). A student is always added with their first parent or guardian, and the last one can't be removed. Each has a name, an **email** (required: they sign up with it and get the school's emails at it) and, optionally, a mobile; the parent's checked mobile from the app replaces it
  - a parent with two children at the school uses one account (found by email)
  - each parent shows **Signed up in the app / Not signed up yet** and **Mobile checked by WhatsApp / not checked yet**
  - the admin can **restrict** a parent, who then no longer sees that child, or remove the link
- **Import from Excel:** students, parents (mother, father, guardian columns; at least one per student) and strap addresses in one sheet.
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
  - signs in on the classroom PC and lands on **My class now**: the lesson in front of them, moving on by itself when the bell goes (it is the first link in their menu; later features, like messages and the gradebook, add more)
  - at a school with straps, they open it only when a child forgot their strap: tap **Present**, then **Save**
  - at a school without straps, they tap the absent ones, then **Save**
  - can change today's lessons they teach
- **The admin:** opens the same screen from the **Attendance register** for any lesson on any day.
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
  - no strap column in the Excel import, and no tracking consent in the parent app
  - the server refuses every Devices request (gateways, straps, rules) and keeps no readings from a gateway

  The attendance screen is the same; teachers take the register.
- **With it:** attendance starts from the straps, each lesson is decided when it ends (section 6), and the tracking screens appear.

## 5. What parents are told

All messages arrive as **app notifications**, and every one is also kept in the app's list. When Firebase is connected (`docs/PUSH.md`), each also rings the parent's phone, worded in the language their app is in and agreeing with the child's gender in Arabic. A parent can have several phones; signing out stops the phone from ringing. Staff get no push.

| When | Message (example) |
|---|---|
| The child comes in through the gate | "Salma arrived at school. Salma came in through Gate A at 07:42." |
| **10 minutes into a lesson**, the child came to school but isn't in the lesson's room | "**Salma was absent from Math in Room 204.** Salma came in through the gate at 07:42 but hasn't been in Math in Room 204 since it started at 09:50. The school has been told." |
| The teacher then marks that child present | "Salma is in Math in Room 204. The teacher marked Salma present … Ignore the earlier message." |
| The child goes out through the gate during the school day and isn't heard again | "Salma left school early." The admins are told too. |
| At the school's fixed time (08:15), the child is absent and not accounted for, and no excuse covers the day | "Salma didn't come to school today. Do you know why?" with **Yes** and **No** (see Excuses below). Sent once per day. |
| The school decides an excuse | "The school accepted Salma's excuse", or "did not accept" with the school's reason. |

**Rules about who is told:**
- A child who never came through the gate (strap forgotten, or at home) gets **no lesson message**; the daily "absent today" message covers it.
- A child who went out through the gate before the lesson gets **no lesson message**.
- Each message is sent **once**.
- A **restricted** parent isn't told anything about that child.

### Excuses (every school)

A parent can excuse an absence from the app, and the system asks for one when a child doesn't come.

- **The question.** At the fixed time, a child who has no lesson marked present, late, excused or on a trip, and who has no excuse for that day, triggers the question above to every parent who may be told about the child.
  - **Yes:** the app opens the excuse form for today. Sending an excuse also counts as "Yes".
  - **No, or no answer in 15 minutes:** an **urgent alert** goes up on the dashboard: a red banner on every page, an urgent item in Follow-ups with the parents' phone numbers, and a message to every admin. It closes by itself when the child is marked present or heard at the gate (the parents are told), or staff close it with a note.
  - The first reply from either parent counts. A "Yes" after the alert is noted on it, and the alert stays for staff.
- **The excuse.** Whole days: a day or a date range, a reason (illness, appointment, family reason, other), a note and an optional photo or PDF (up to 5 MB). It can be sent up to **7 days after** the absence, or up to 30 days ahead for a planned absence, and covers at most 30 days. A parent with limited access can't send one.
- **The decision.** Student Affairs sees it under **Excuses**, with the attachment, and accepts or rejects it. A rejection needs a reason, which the parent reads. Accepting turns the child's absent lessons on those days into **Excused**, and any absence marked later on those days too. After a rejection the parent can send another within the window.
- **The student's profile** has an **Absences and excuses** list for the last 6 months: each absent day is **Excused** (green), **Excuse waiting** (grey), **No excuse yet** (amber) or **Excuse rejected** (red), with the parent's reason and the school's note, and the totals.

### Messaging (Messaging module)

Parents read all of this in the app's **Messages** tab. Announcements and the emergency message are in every plan; chat, polls and meetings are in Complete (section 2).

- **Announcements.** Student Affairs writes one to the whole school, to year groups or to classes; a teacher writes to their own classes only (the ones they teach or lead). A draft can be edited, given a photo or PDF (up to 5 MB) and deleted; **Send** reaches each parent once, and the sender sees how many that is first. Student Affairs sees who has read it. A parent restricted for a child isn't sent what is written to that child's class.
- **Emergency message.** Only Student Affairs, only to **every** parent. It shows in red at the top of the parent's Today screen until they press **I have read this**, and the dashboard shows how many have confirmed.
- **Polls.** A question with 2 to 10 answers, one choice or several, a closing time, anonymous or not, with results shown to parents after they vote or not. A parent can change their answer until it closes. Student Affairs sees who voted for what only when the poll was not anonymous. A teacher sees only their own polls.
- **Chat.** A parent writes to a child's teachers, the class teacher or Student Affairs, and a teacher sees only their own conversations. Messages arrive live while the app or dashboard is open; otherwise the other person gets a notification. Text up to 2,000 characters, with an optional photo or PDF. A message shows **Seen** once the other side has opened it.
  - Student Affairs is one name for parents. Any admin can answer it, and any admin can read every conversation, but answers only their own.
  - **Office hours** (in School settings) are shown to parents; messages can be sent at any time.
  - A parent the school has restricted for a child can no longer open that child's conversations, and teachers can't write to them.
- **Meetings.** A teacher offers times on a school day (a window cut into slots of 10 to 30 minutes, with a place). A parent books one slot with one of their child's teachers, with a note; one meeting per teacher per day. Two parents tapping the same time at once: one gets it, the other is asked to choose another. A parent can cancel until **2 hours before**; the teacher can cancel at any time, and removing a whole window tells everyone who booked.
- **Who is told:** new announcements, polls and cancelled meetings by app notification. Chat messages only when the person isn't connected.

### Behaviour notes (Behaviour module)

Teachers and Student Affairs write short notes about a student; parents read them in the app's **School** tab, under **Behaviour**.

- **Three kinds, each with a shape and a word:** praise ★, a note to follow up !, and an incident ⚠. Each has a fixed list of categories (kindness, effort, homework, punctuality and so on; incidents: fighting, bullying, damage, safety, other).
- **Who writes what.** A teacher writes praise and concerns, only about students in the classes they teach or lead. Student Affairs and the social worker write about any student, and are the only ones who record **incidents**, with a severity (minor, moderate, serious), a place and what the school did.
- **What parents see.** Praise and concerns are shared with the parents by default (the writer can untick it). An incident is **kept back** until Student Affairs shares it. Parents see the note, who wrote it and when; the severity and the school's action only on incidents. Each shared note sends the parents one notification; opening the screen marks the notes as read, and Student Affairs sees which notes the parents have read. A parent restricted for a child sees nothing about that child (T4).
- **Merit points** (a feature the owner switches on, in the subscription). Praise carries +1 to +5, a concern −1 to −5, an incident −10 to 0. The student's page and the parent's screen show the total for the current school year. Without the feature, points can't be set and nobody sees them.
- **Changing a note.** The writer can edit or withdraw their own note for **24 hours**; after that, Student Affairs does it. Notes can be dated up to 30 days back, never in the future. Every edit and withdrawal goes in the activity log.
- **Where it shows on the dashboard.** **Behaviour notes** in the menu (the feed, with kind, class and date filters); a **Behaviour** section on each student's page (this year's totals and the last 10 notes); and a ★ button on every row of the attendance register to write a note about that child in a click.
### Academics (Academics module)

Marks, exams and report cards. Teachers work in **Gradebook**; parents read the results in the app's **School** tab, under **Grades**. (In the code and the API this is "assessments" and "marks", because "grade" already means a year group.)

- **Assessments.** Anything marked: classwork, quiz, homework, project, midterm exam, final exam. Each belongs to one class, one subject, one school year and one term (the date decides the term; the mid-year break counts as term 1). It has a maximum score and a **weight** (how much it counts towards the term, 1 to 10; a quiz is 1, a project 2, a midterm 3, a final exam 4, unless the teacher changes it). A date outside every school year is refused.
- **Who marks what.** A teacher creates assessments and enters marks for the subjects they teach in a class (the teacher on its lessons in the timetable, see section 3). If the subject is handed to another teacher, the new one takes over its assessments and marks. The **class teacher** can read every subject of their class, but marks only their own. Student Affairs can do everything; the social worker can read. A teacher can't open another teacher's subject.
- **Entering marks.** One grid per class and subject: a row for each student, a column for each assessment. Scores can have two decimals and must be between 0 and the maximum. **Abs.** marks a student absent; pressing it again records the absence as **excused**. A blank cell clears the mark.
- **Term percentage.** The weighted average of a student's marks: each assessment counts its weight times score ÷ maximum, divided by the total weight. An **excused absence** is left out; an absence **without an excuse** counts as 0; an assessment the student has no mark for yet is left out. The **overall** result is the plain average of the subjects.
- **Grade bands.** A percentage is called something: «ممتاز» / Excellent, A*, B+ and so on. There are defaults for the Egyptian national systems (Excellent from 85, Very good 75, Good 65, Pass 50), British (A* from 90 down to U) and American (A to F, each with a grade point). Student Affairs can replace the bands of any school system in **School settings**, and **Reset to default** brings the defaults back. A band is found from the exact percentage, not the rounded one (84.99 is still "Very good").
- **Publishing marks.** Marks stay private until the teacher publishes the assessment; then each parent who may be told gets one notification. What parents see (their percentages, bands and progress line) counts **published assessments only**; the gradebook counts everything marked. A mark changed after publishing shows to parents straight away. Only Student Affairs can unpublish, and an assessment with published marks can't be deleted.
- **Exams.** A midterm or final exam also has a start time, an end time and a room. A class can't have two exams that overlap, and a room can't hold two at once. The **Exam timetable** lists every exam by day and can be printed; parents see their child's class's upcoming exams, published or not.
- **Report cards** (when the school has the Report cards feature on). The class teacher or Student Affairs **prepares** the cards for a class and term, one per student. Each subject teacher writes a comment on their own subject, the class teacher writes theirs, Student Affairs writes the principal's. The principal's name (School settings) prints under their comment. A draft always shows the card as it is now; **Student Affairs publishes** it, which freezes it: the percentages, bands, comments, teachers and the days at school (present, late, absent, excused, on a trip; whole days only, over the open school days of the term so far) are stored then. A mark changed later does not change a published card. Unpublishing returns it to a draft and parents stop seeing it until it is published again. Only published cards reach parents, with a notification.
- **Printing.** Each card has a **Print** page: A4, with the crest, in English or Arabic (a switch on the page); the browser's Print saves it as a PDF. The app shows the same card on screen.
- **Separated families.** A parent restricted for a child sees none of this for that child, and isn't told about it (T4).


### Clubs and activities (Activities module)

Clubs and after-school activities. Student Affairs sets them up under **Clubs & activities**; parents sign their children up in the app's **School** tab, under **Clubs**.

- **A club** has a name (and an Arabic one), the days it meets, its times, a room, a supervisor, the number of places, the year groups that may join (all of them when none is chosen), whether sign-up is open and, when the school keeps paid clubs on (the `paidActivities` feature), a fee for the term. It belongs to a school year and is archived, not deleted, when it ends: archiving withdraws everyone without a message.
- **Joining.** A parent sees the clubs open to their child's year group, with the places left, and joins in one tap. When the club is full the child goes on the **waiting list** instead and sees their number. Two parents racing for the last place can't both get it: one is enrolled and the other waits. Joining a club that meets at the same time as another the child is in is allowed, with a note.
- **Leaving.** A parent can take their child out (after a confirmation). When a place frees up, whether a parent left or Student Affairs withdrew someone or raised the number of places, the first on the waiting list moves up and their family is told.
- **Student Affairs** adds a student to a club even when it is full (recorded in the activity log), withdraws a student, and marks a fee **paid** by hand (real payment comes with Phase 3). A club's **members** page shows who is in it, the waiting list in order, each family's phone numbers and each member's attendance.
- **The supervisor** (a teacher) manages their own clubs: members and attendance. Other teachers see the catalogue only.
- **Attendance** is taken on a day the club meets, a school day that has come: present or absent for each member. A day can be marked again to correct it.
- **A club is also an audience.** An announcement, a poll or an event can go to the members of one club.

### Trips and permission slips (Activities module, Trips feature)

- **Planning.** Student Affairs makes a trip: title, destination, date (a school day), leaving and return times, the lessons it takes (or the whole day), a fee, a leader, the classes going and the **answer deadline**, which must be before it leaves. It starts as a **draft** that no parent sees.
- **Opening it** asks the parents of every student in the classes for permission, with a notification. A parent restricted for a child (T4) hears nothing and sees nothing.
- **The permission slip.** The parent reads the declaration, **types their full name as their signature**, may add a note (medicine, allergies on the day) and answers Yes or No. Either parent can answer and the latest answer stands, until the deadline. Every answer goes into the activity log with the decision and the typed name, and the other parent is told who answered. After the deadline the slip is closed and the parent is told to contact the school.
- **Following up.** The trip's page lists every student: agreed, declined or still waiting, who signed, the note, and for those waiting the parents' phone numbers (with **Copy phone numbers of those waiting**). Student Affairs, the trip's leader and the teachers of the classes see it. A fee is marked paid by hand. If the day, the times or the fee change while it is open, the parents who already answered are told. One reminder goes to the parents who haven't answered a day before the deadline.
- **Closing the answers** makes the list final: every student with permission is marked **On a trip** in the registers for the lessons the trip takes (the whole day when none are given), so nobody is flagged absent; students without permission stay expected at school. A closed trip can't be edited: cancel it and make a new one. **Cancelling** tells the parents and removes exactly the records the trip wrote.
- **The headcount.** On the day of the trip the leader (or Student Affairs) opens it and taps each student when they get on, and again when they are back: "On the bus 23 of 25", "Back 0 of 25".

### Events and the school calendar (Activities module, Events feature)

- **Events.** Student Affairs writes an event (title, description, start and end or all day, place) for an audience: the whole school, year groups, classes or a club. It stays private until **published**, which tells each parent in the audience once.
- **The gallery.** An event can have up to 30 photos, JPEG, PNG or WebP (judged by their bytes, never the file name), up to 2 MB each. Staff and the parents the event is for can see them; nobody else. Parents open a photo full size from the event in the app.
- **The calendar.** In the app's **School** tab, **Calendar** shows a month as one agenda by day: published events for the parent, their children's trips and exams, their children's clubs (on days the school is open), holidays and the mid-year break. With more than one child it can show one child or all of them, and each item names its child. It works for any school with the Activities module, even one without events or trips.


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
| **My class now:** the lesson in front of them, where a teacher lands (section 4). A teacher has a menu too, which shows only what is theirs. | ✓ | | |
| **Today:** students enrolled and how many came in through the gate, present and absent per period, open exceptions, lessons today, and **Messages** to the school (e.g. a parent changed their mobile) | | ✓ | |
| **Attendance register:** every lesson; opens the same attendance screen for any lesson, any day. With many classes it can be narrowed to one class, or to the lessons still to mark | | ✓ | |
| **Exceptions:** things a person should look at, each resolved with a note:<ul><li>at school but not in the lesson</li><li>left a lesson</li><li>left early</li><li>gateway offline / room without a gateway</li><li>low battery</li></ul> | | ✓ | |
| **Where students are** (only with straps): live every 10 seconds:<ul><li>each room and the gate, with who is in it now</li><li>"needs a look": not heard for 10+ minutes during school hours</li><li>who went out through the gate</li><li>who hasn't been heard today</li></ul>Has search and a class filter. | | ✓ | |
| **School structure & year:** stages and grades, classes (section, system, boys/girls, stream, places, homeroom), school year (terms, mid-year break), holidays, rooms, periods, subjects | | ✓ | |
| **Students:** search; **Add a student** (details, health, emergency contact, parents, photo and papers); each student's page (photo, details and Edit details, papers, parents and guardian, class, where today, two weeks of attendance) | | ✓ | |
| **Parents:** search by name, email, mobile or child; each parent's page (details, sign-up and tracking consent, their children with class; link another child) | | ✓ | |
| **Classes:** each class's page (grade, homeroom teacher, students with their parents). Student, parent and class pages link to each other. | | ✓ | |
| **Import from Excel:** template, check, import | | ✓ | |
| **Gradebook, Exam timetable, Report cards:** marks for each class and subject, exams by day, and the term report for each student (a teacher sees and writes only their own subjects; the class teacher reads the whole class; Student Affairs publishes report cards and edits the grade bands in School settings) | ✓ | ✓ | |
| **Clubs & activities:** the catalogue, a club's members, waiting list and attendance (Student Affairs; a teacher manages the clubs they supervise and sees the rest) | ✓ | ✓ | |
| **Trips:** plan, open, close and cancel (Student Affairs); who has answered (Student Affairs, the trip's leader, teachers of the classes); the headcount (Student Affairs, the leader) | ✓ | ✓ | |
| **Events:** write, publish, add photos | | ✓ | |
| **Behaviour notes:** the feed, writing a note, a student's behaviour section (a teacher sees and edits only their own classes and notes; incidents are Student Affairs only) | ✓ | ✓ | |
| **Staff:** accounts | | ✓ | |
| **Timetable** (whole school), **School structure & year** | | ✓ | |
| **Smart band readers** (only with straps): gateways, straps, detection rules | | ✓ | |
| **School settings:** school days, absence message time, whether straps are in the subscription | | ✓ | |
| **Audit log** | | ✓ | |
| **Schools, Gateways** (section 2) | | | ✓ |

The server enforces this: a teacher asking for school-wide data (the student list, where students are, the day's summary, exceptions) is refused, not just hidden from the menu. Parents can't use the dashboard; they use the app.

## 8. Parent app

1. **Sign in** with email and password.
   - **Create account** (first time): email code, then mobile with a WhatsApp code, then a password (section 1).
   - **Forgot password:** a code by email, then a new password.
2. **Consent** once.
3. **The tabs.** Five at most, along the bottom of the app: **Today**, **Messages**, **School**, **Notifications** and **Account**.
   - **Messages** shows only when the school has Messaging; **School** (grades, behaviour, clubs, trips, calendar, meetings) only when it has one of those. A school sees just the tabs it has.
   - With more than one child, the child chosen on one tab stays chosen on the others.
4. **The child's day (Today):** arrival time, **where the child is now** (the room or the gate where the strap was heard in the last minute, e.g. "In Math, Room 204 · heard 09:41"), and each lesson's status. With two children there is a switcher. Where the child is now shows only at schools with the straps subscription, only after the parent agreed on the consent screen, and only for today.
5. **Notifications:** the list, marked read when opened. Marks published together arrive as one push each, but the list shows one child's marks of a day as one row ("4 new marks for Layla", and "in Science" when they are all one subject's); opening it marks them all read and opens the grades. A single mark keeps its own sentence.
6. **Account:** name, email, mobile ("checked on WhatsApp"), **Change mobile**, and sign out.

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
  - It adds three clubs (Chess is full with a waiting list, Art has a fee that is partly paid), a trip next week for 4/1 that is open for permission with two answers, a past event with three photos and an upcoming one.
- **`scripts/simulate-gateway.ts`:** sends live readings for chosen straps.

---

## 11. Voice and look

The platform is made for Egypt's private, language and international schools, and the families who choose them. It follows the Claude Design handoff v2, "Ivory, Oxford navy & a crest: the school's own register".

**Words**
- English uses British spelling (enrolment, colour).
- Arabic is refined Modern Standard Arabic with polite forms («يُرجى»، «أدخلوا»).
- Parents are reassured first: "Salma arrived safely at school", "Salma missed Math in Room 204. Student Affairs is following up."
  - The Arabic agrees with the child's gender: «وصل أحمد المدرسة بالسلامة», «وصلت ليلى المدرسة بالسلامة».
  - Staff messages use gender-neutral noun forms.
- Staff are addressed by title, set on the Faculty & staff page: Mr., Ms., Mrs. or Dr. (مستر، مس، مدام، د.). For example, "Ms. Hana Nabil" or "Saved by Mr. Sherif Kamal".
- Fixed vocabulary:

  | English | Arabic |
  |---|---|
  | Attendance register | كشف الحضور |
  | Follow-ups | المتابعات |
  | On campus now | داخل المدرسة الآن |
  | Student Affairs (the school admin role) | شؤون الطلبة |
  | Faculty & staff | هيئة التدريس والعاملون |
  | Smart band | السوار الذكي |
  | Smart band readers | أجهزة قراءة الأساور |
  | School settings | إعدادات المدرسة |
  | Activity log | سجل النشاط |
  | Class teacher (of a class) | رائد الفصل |
  | Student ID | كود الطالب |
  | Year group | الصف الدراسي |
  | New enrolment | قيد طالب جديد |
  | Activate your account (parents) | تفعيل حسابكم |
- Emails come from the school, by name, in both languages.

**Look**
- **Colours:**
  - Light: ivory ground `#F6F4EF`, white panels, hairlines `#DEDAD0`, ink `#1A1D24`.
  - Oxford navy `#1B2A4E` for actions and the sidebar.
  - The crest is burgundy `#7A1F2E` with a gold `#C9A75A` edge. Gold also labels the sidebar groups and rings the current page.
  - Dark: ground `#12141A`, panels `#1A1D25`, and gold `#D6BA75` takes over actions from navy.
- **Type:**
  - Headings use serifs: Source Serif 4 in English and Noto Naskh Arabic in Arabic.
  - Text, data and controls use IBM Plex Sans and IBM Plex Sans Arabic.
  - Times stay Latin, with tabular figures.
  - All the fonts are bundled locally under the OFL.
- **Corners and depth:**
  - Corners are 4 px for chips, 6 px for controls, 8 px for big buttons and 10 px for panels.
  - Cards have no shadows: surfaces separate by a hairline and a tone step.
  - Only floating layers (the toast) have a shadow.
- **The crest:**
  - It is a shield with the school's initials, or the crest an admin uploads under School settings (PNG, JPEG or WebP, up to 1 MB).
  - It appears in the sidebar, on the classroom PC's top bar and on the sign-in panel.
  - In the parent app it appears on the day screen next to the greeting ("Good morning, Dina"), and on the sign-in screen once the phone has signed in to a school.
- **How a screen is laid out:**
  - The heading holds the page's one main action ("New note", "New announcement", "Publish for the class").
  - What narrows the list below (tabs for Sent and Drafts, the class, the day, from and to) sits in a row of its own under the heading, never inside it, so the heading never wraps. Dates in a filter say which is "from" and which "to".
  - Times are typed as 24-hour, Latin digits (`TimeInput`), because the browser's own time picker follows the device and shows 12-hour with Arabic digits on an Arabic phone or PC.
  - Small links inside panels have a larger tap area than they look, and every field has a label a screen reader can read.
- **Rules of the room:**
  - Status colours always keep their glyph and word.
  - Live updates never jump the layout or move focus.
  - RTL works by mirroring, not rewriting.
  - Keyboard focus is always visible, and motion respects reduced-motion settings.

## Not done yet in Phase 1

- **Real hardware:**
  - The firmware compiles but hasn't run on an ESP32 with real straps.
  - The detection numbers (−70 / −85 dBm, 70%, 10 minutes) need tuning in real rooms.
- **Sending for real:**
  - **Push notifications:** connected to Firebase (project `school-platform-eg`), but not yet tried on a real phone. Android should work once the server has its key (`FIREBASE_SERVICE_ACCOUNT`); iPhones need an Apple APNs key uploaded in the Firebase console and the Push Notifications capability in Xcode. Tapping a push (or a notification in the list) opens what it is about; on the web it only opens the app. The web build gets browser push too. See `docs/PUSH.md`.
  - **Email:** needs an email account to send from (`SMTP_URL` in `apps/api/.env`). Until then, sign-up and password codes are written in the server log.
  - **WhatsApp:** needs a WhatsApp Business account with an approved code template (`WHATSAPP_*` in `apps/api/.env`). Until then, mobile codes are written in the server log.
  - **School emails to parents:** announcements reach parents as app notifications only. Emailed newsletters aren't built.
  - **Opening a PDF in the app:** a PDF sent with an announcement can't be opened in the parent app yet (photos show in full); parents ask the school office for a copy.
- **Hosting:** no production server, domain, HTTPS or MQTT broker is set up yet.
- **Passwords:** changing a password doesn't sign out sessions that are already open; deactivating the account does.
