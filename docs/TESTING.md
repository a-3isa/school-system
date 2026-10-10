# Testing the whole system on your computer

These steps take you from nothing to every part running: the API, the staff dashboard, the parent app and a pretend gateway. Then they walk you through what to check as each person who uses it.

## 1. Install the tools (once)

| Tool | Version | Check with |
|---|---|---|
| Git | any | `git --version` |
| Node.js | 22 | `node --version` |
| PostgreSQL | 16 | `psql --version` |
| Flutter (parent app only) | Dart 3.6 or newer | `flutter --version` |
| Chrome | any | for the dashboard and the parent app on the web |

- **Windows:** install each from its website. On Windows, run the commands below in **Git Bash**, which comes with Git, so that they work as written.
- **macOS:** `brew install git node@22 postgresql@16`, then install Flutter from flutter.dev.
- **Ubuntu:** `sudo apt install git postgresql`, then install Node 22 from nodejs.org and Flutter from flutter.dev.

## 2. Get the code (first time)

```bash
git clone https://github.com/a-3isa/school-system.git
cd school-system
git checkout main
```

## 3. Get the latest code (every time after that)

```bash
cd school-system
git checkout main
git pull origin main
npm install                                   # new packages, if any
cd apps/api && npx prisma migrate dev && cd ../..   # new database changes, if any
cd apps/parent && flutter pub get && cd ../..       # new app packages, if any
```

To try a pull request before it's merged, check out its branch, then run the same three install steps:

```bash
git fetch origin <branch-name>
git checkout <branch-name>
```

When you're done, go back with `git checkout main`.

## 4. Create the database user and databases (once)

Open the PostgreSQL shell as its admin user:

- **Ubuntu:** `sudo -u postgres psql`
- **macOS and Windows:** `psql -U postgres`

Then run:

```sql
CREATE ROLE school LOGIN PASSWORD 'school' CREATEDB;
CREATE DATABASE school_dev OWNER school;
CREATE DATABASE school_test OWNER school;
\q
```

- `school_dev` is the database you click around in.
- `school_test` is for the automated tests, which **empty it on every run**. Its name must end in `_test`.

## 5. Configure and fill the database (once)

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

In `apps/api/.env`:

- Set `JWT_SECRET` to any long random text.
- Keep `DATABASE_URL=postgresql://school:school@localhost:5432/school_dev`.
- Leave `SMTP_URL` and `WHATSAPP_*` empty. Emails and WhatsApp codes are then printed in the API's terminal instead of being sent.

Then create the tables and the platform owner. The owner email and password are your choice; you sign in with them later.

```bash
cd apps/api
npx prisma migrate dev
OWNER_EMAIL=you@example.com OWNER_PASSWORD=choose-one npm run seed
cd ../..
```

## 6. Run the automated tests

Run these from the `school-system` folder.

```bash
npm test -w apps/api                          # API unit tests
npm run test:e2e -w apps/api                  # API tests against school_test
#   If your database user isn't school:school, point the tests at it first:
#   TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/school_test
npm run build -w apps/web                     # the dashboard compiles
cd apps/parent && flutter analyze && flutter test && cd ../..
```

Everything should pass. If a test fails, keep its output and send it over.

## 7. Start everything

Open four terminals, each in the `school-system` folder.

```bash
# Terminal 1: API (leave it running; codes and emails print here)
cd apps/api && npm run start:dev                  # http://localhost:3000/api

# Terminal 2: the demo school (run once, after the API is up)
cd apps/api && OWNER_EMAIL=you@example.com OWNER_PASSWORD=choose-one npx ts-node scripts/demo.ts
#   It prints each demo gateway's secret; keep them for step 10.

# Terminal 3: staff dashboard
npm run dev -w apps/web                           # open http://localhost:3001

# Terminal 4: parent app in Chrome
cd apps/parent && flutter run -d chrome --dart-define=API_URL=http://localhost:3000/api
```

- **Run the demo on a school day.** On Sunday to Thursday, the demo also plays the day so far: arrivals, lessons and one absent child per class. On other days it only creates the school. To play a day later, run `npx ts-node scripts/demo-day.ts` with the same owner email and password.
- **Start again from scratch:** `cd apps/api && npx prisma migrate reset`. This deletes all data in `school_dev`. Then run the seed and the demo again.

**Demo accounts**

| Who | Email | Password |
|---|---|---|
| Platform owner | the email you chose | the password you chose |
| Student Affairs (school admin) | admin@demo.school (Ms. Samia Adel) | demo-admin-1 |
| Teacher | hana@demo.school | demo-teacher-1 |
| Parents | parent1@demo.school … parent23@demo.school, and guardian24@demo.school | demo-parent-1 |

## 8. Check the dashboard as the admin

Sign in at http://localhost:3001 as admin@demo.school.

1. **Sign-in page**
   - It has the navy panel and serif headings.
   - Try **Forgot password?**. The code appears in Terminal 1.
2. **School settings**
   - Upload a square PNG as the school crest. It appears in the sidebar.
   - **Remove** brings back the gold initials.
   - An SVG or a PDF is refused.
3. **School structure & year**
   - Check the stages, the school year, and the mid-year break.
   - Press **Add the fixed public holidays**.
4. **Classes**
   - Each class shows its year group, class teacher and how full it is.
   - Open a class, then one of its students, then go back.
5. **Students → New enrolment**
   - Saving without a parent or guardian, or without the required documents, is refused.
   - Fill in everything and save. The new student's profile opens.
6. **Student profile**
   - The parents link to their own profiles, and back again.
   - Removing the last parent or guardian is refused.
   - **Limit access** restricts a guardian.
7. **Parents**
   - Search by name, phone or a child's name.
   - Open a parent to see their children.
8. **Import from Excel**
   - Download the template.
   - Upload it with one bad row, fix that row, and import.
9. **Timetable**, **Faculty & staff** (set each person's title), **Smart band readers**, **Activity log**: each page opens and shows the demo data.
10. **Today**, **Follow-ups**, **On campus now**: these show the day the demo played.

## 9. Check the classroom PC as a teacher

1. Sign in as hana@demo.school. You see only **My class now**, with the crest in the top bar.
2. Mark a child Absent and save.
3. When a child misses the first minute of a lesson, their parents are told.

## 10. Check the smart bands (no hardware needed)

1. Use a secret printed in step 7:

   ```bash
   cd apps/api
   npx ts-node scripts/simulate-gateway.ts --serial DEMO-R204 --secret <secret> \
     --macs DC:0D:30:00:00:00,DC:0D:30:00:00:01
   ```

2. Those two children appear in Room 204 under **On campus now**.
3. If the simulator answers `401`, sign in as the owner, open **Gateways**, press **New secret**, and use the new secret.

## 11. Check the parent app

1. Sign in as parent1@demo.school.
2. **Child's day** shows the arrival time, where the child is now, and every lesson.
3. **Notifications** name the child. In Arabic, they agree with the child's gender («وصل…» or «وصلت…»).
4. **Create account** with a parent the school registered:
   - a code to their email
   - then a WhatsApp code to their mobile
   - then a password

   Both codes appear in Terminal 1.
5. **Account → change mobile**. Staff then see "… updated their mobile number".
6. A parent with two children can switch between them.

## 12. Check the owner console

1. Sign in with the owner email from step 5.
2. **Schools**: create a school and turn its modules and plan on or off.
3. **Gateways**: see the list and issue a new secret.

## 13. Check language, dark mode and keyboard

1. Switch to **عربي**:
   - Every screen flips right to left.
   - Headings use the Naskh typeface.
   - Counts read correctly («طالبان»، «3 طلاب»، «24 طالبًا»).
2. Switch the computer to dark mode. The dashboard and the parent app both go dark.
3. Press **Tab** through a form. The focus ring is always visible.

## Not testable yet

- **Real emails and WhatsApp codes:** these need `SMTP_URL` and a WhatsApp Business account set in `apps/api/.env`.
- **Push notifications to phones:** these need Firebase.
- **The gateway firmware:** it compiles in CI but hasn't run on a real ESP32 yet.
