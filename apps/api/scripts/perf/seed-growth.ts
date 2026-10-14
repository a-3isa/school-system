// Fills the perf database with the "growth" scale: 20 schools of about 1,000 students, 10 smart band
// readers each (1 at the gate, 9 in classrooms), and the readings, registers, notifications, chats,
// trips and activity log a school builds up. Writes straight to the database; no API needed.
//
//   npx ts-node scripts/perf/create-db.ts --fresh && npx ts-node scripts/perf/seed-growth.ts
//   options: --schools 20 --classes 36 --per-class 28 --readers 10 --history-days 20
//
// The measured day is PERF_DATE (default 2026-10-15, a Thursday in term). Readings run from 08:00 to
// PERF_TIME (default 10:05) on that day, and for the whole of the school day before it.
import { AttendanceMode, AttendanceSource, AttendanceStatus, GatewayKind, Plan, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { arg, gatewaySecret, PASSWORD, PERF_DATE, PERF_TIME, PERF_URL } from './env';
import { hashSecret } from '../../src/devices/devices';
import { dbDate } from '../../src/common/dates';
import { zonedTime } from '../../src/common/time';

const SCHOOLS = Number(arg('schools', '20'));
const CLASSES = Number(arg('classes', '36'));
const PER_CLASS = Number(arg('per-class', '28'));
const READERS = Number(arg('readers', '10'));
const HISTORY_DAYS = Number(arg('history-days', '20'));
const TZ = 'Africa/Cairo';
const PERIODS = [['08:00', '08:45'], ['08:45', '09:30'], ['09:50', '10:35'], ['10:35', '11:20'], ['11:40', '12:25'], ['12:25', '13:10'], ['13:10', '13:55']];
const SUBJECTS = ['Math', 'Arabic', 'English', 'Science', 'Social Studies', 'Religion', 'Art'];
const TEACHERS = CLASSES + 9;
const FIRST = ['Layla', 'Omar', 'Yara', 'Ali', 'Karim', 'Salma', 'Mariam', 'Youssef', 'Hana', 'Ziad', 'Nour', 'Adam'];
const LAST = ['Hussein', 'Kamal', 'Mostafa', 'Ramadan', 'Fathy', 'Nabil', 'Adel', 'Gamal'];

const prisma = new PrismaClient({ datasources: { db: { url: PERF_URL } } });
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

async function chunked<T>(rows: T[], write: (part: T[]) => Promise<unknown>, size = 5000) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

/** The school days before PERF_DATE, newest first (Sunday to Thursday). */
function schoolDaysBefore(date: string, count: number) {
  const out: string[] = [];
  const d = new Date(`${date}T00:00:00Z`);
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() <= 4) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function seedSchool(k: number, hash: string) {
  const sid = `ps${pad(k)}`;
  await prisma.school.create({
    data: { id: sid, name: `Perf School ${k}`, plan: Plan.COMPLETE, attendanceMode: AttendanceMode.AUTOMATIC, absenceNoticeTime: '08:15' },
  });
  await prisma.schoolModule.createMany({
    data: [
      { schoolId: sid, key: 'core', enabled: true, features: { excelImport: true } },
      { schoolId: sid, key: 'attendance', enabled: true, features: { automatic: true, leaveEarlyAlerts: true } },
      { schoolId: sid, key: 'messaging', enabled: true, features: { chat: true, polls: true, meetings: true } },
      { schoolId: sid, key: 'activities', enabled: true, features: { paidActivities: true, trips: true, events: true } },
      { schoolId: sid, key: 'academics', enabled: true, features: { reportCards: true } },
      { schoolId: sid, key: 'behavior', enabled: true, features: { clinic: true, merits: true } },
    ],
  });
  const year = await prisma.academicYear.create({
    data: { schoolId: sid, name: '2026/2027', startsOn: dbDate('2026-09-13'), endsOn: dbDate('2027-06-30'), term2StartsOn: dbDate('2027-02-07'), breakFrom: dbDate('2027-01-24'), breakTo: dbDate('2027-02-04') },
  });
  await prisma.holiday.createMany({
    data: [
      { schoolId: sid, name: 'Armed Forces Day', fromDate: dbDate('2026-10-06'), toDate: dbDate('2026-10-06') },
      { schoolId: sid, name: 'Christmas', fromDate: dbDate('2027-01-07'), toDate: dbDate('2027-01-07') },
      { schoolId: sid, name: 'Revolution Day', fromDate: dbDate('2027-01-25'), toDate: dbDate('2027-01-25') },
    ],
  });

  // Staff: Student Affairs and the teachers.
  const users = [
    { id: `${sid}-admin`, schoolId: sid, name: `Admin ${k}`, honorific: 'MS', email: `admin@${sid}.perf`, passwordHash: hash, role: Role.SCHOOL_ADMIN },
    ...Array.from({ length: TEACHERS }, (_, t) => ({
      id: `${sid}-t${pad(t, 3)}`, schoolId: sid, name: `Teacher ${t}`, honorific: t % 2 ? 'MR' : 'MS', email: `t${t}@${sid}.perf`, passwordHash: hash, role: Role.TEACHER,
    })),
  ];
  await prisma.user.createMany({ data: users });

  await prisma.grade.createMany({ data: Array.from({ length: 6 }, (_, g) => ({ id: `${sid}-g${g}`, schoolId: sid, name: `Primary ${g + 1}`, order: g + 1, stage: 'PRIMARY' })) });
  await prisma.room.createMany({ data: Array.from({ length: CLASSES }, (_, c) => ({ id: `${sid}-r${pad(c)}`, schoolId: sid, name: `Room ${100 + c}` })) });
  await prisma.class.createMany({
    data: Array.from({ length: CLASSES }, (_, c) => ({
      id: `${sid}-c${pad(c)}`, schoolId: sid, gradeId: `${sid}-g${c % 6}`, name: `${(c % 6) + 1}/${Math.floor(c / 6) + 1}`, section: String(Math.floor(c / 6) + 1),
      homeroomTeacherId: `${sid}-t${pad(c, 3)}`, system: 'NATIONAL_LANGUAGES', capacity: 30,
    })),
  });
  await prisma.subject.createMany({ data: SUBJECTS.map((name, i) => ({ id: `${sid}-sub${i}`, schoolId: sid, name })) });
  await prisma.period.createMany({ data: PERIODS.map(([startTime, endTime], i) => ({ id: `${sid}-p${i + 1}`, schoolId: sid, number: i + 1, startTime, endTime })) });
  // Every class has its own room all day; at one weekday and period every class has a different teacher.
  const lessons = [];
  for (let day = 0; day <= 4; day++) {
    for (let p = 0; p < PERIODS.length; p++) {
      for (let c = 0; c < CLASSES; c++) {
        lessons.push({
          schoolId: sid, classId: `${sid}-c${pad(c)}`, dayOfWeek: day, periodId: `${sid}-p${p + 1}`, roomId: `${sid}-r${pad(c)}`,
          subjectId: `${sid}-sub${(c + p + day) % SUBJECTS.length}`, teacherId: `${sid}-t${pad((c + day * 7 + p) % TEACHERS, 3)}`,
        });
      }
    }
  }
  await prisma.timetableEntry.createMany({ data: lessons });

  // Students, one parent each (consent given), and a smart band each.
  const students = [];
  const parents = [];
  const links = [];
  const straps = [];
  for (let c = 0; c < CLASSES; c++) {
    for (let i = 0; i < PER_CLASS; i++) {
      const n = c * PER_CLASS + i;
      const id = `${sid}-st${pad(n, 4)}`;
      students.push({ id, schoolId: sid, code: `2026-${pad(n, 4)}`, firstName: FIRST[n % FIRST.length], lastName: LAST[(n * 3) % LAST.length], classId: `${sid}-c${pad(c)}`, gender: n % 2 ? 'MALE' as const : 'FEMALE' as const });
      parents.push({ id: `${sid}-pa${pad(n, 4)}`, schoolId: sid, name: `Parent ${n}`, email: `p${n}@${sid}.perf`, passwordHash: hash, role: Role.PARENT, consentAt: new Date('2026-09-10T08:00:00Z') });
      links.push({ studentId: id, userId: `${sid}-pa${pad(n, 4)}`, relation: 'MOTHER' as const });
      straps.push({ id: `${sid}-sp${pad(n, 4)}`, schoolId: sid, mac: `DC:0D:${pad(k)}:${pad(Math.floor(n / 100))}:${pad(n % 100)}:01`, studentId: id, battery: n % 97 === 0 ? 15 : 80 });
    }
  }
  await chunked(students, (d) => prisma.student.createMany({ data: d }));
  await chunked(parents, (d) => prisma.user.createMany({ data: d }));
  await chunked(links, (d) => prisma.studentGuardian.createMany({ data: d }));
  await chunked(straps, (d) => prisma.strap.createMany({ data: d }));

  // Readers: one at the gate, the rest in the first classrooms.
  const tickAt = zonedTime(PERF_DATE, PERF_TIME, TZ);
  await prisma.gateway.createMany({
    data: Array.from({ length: READERS }, (_, g) => {
      const serial = `PERF-${pad(k)}-GW${pad(g)}`;
      return {
        id: `${sid}-gw${pad(g)}`, serial, claimCode: `PERF${pad(k)}${pad(g)}`, secretHash: hashSecret(gatewaySecret(serial)), schoolId: sid,
        name: g === 0 ? 'Main gate' : `Room ${100 + g - 1}`, kind: g === 0 ? GatewayKind.GATE : GatewayKind.ROOM, roomId: g === 0 ? null : `${sid}-r${pad(g - 1)}`, lastSeenAt: tickAt,
      };
    }),
  });
  return { sid, yearId: year.id };
}

/** Readings, gate arrivals, registers and the rest, in set-based SQL so 20 schools take minutes, not hours. */
async function seedVolume(sid: string, yearId: string) {
  const [yesterday] = schoolDaysBefore(PERF_DATE, 1);
  const days: [string, string][] = [[yesterday, PERIODS[PERIODS.length - 1][1]], [PERF_DATE, PERF_TIME]];
  for (const [date, until] of days) {
    const from = zonedTime(date, '08:00', TZ);
    const to = zonedTime(date, until, TZ);
    // Each classroom reader hears its class's bands every 5 seconds (the firmware's report window).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Sighting" ("schoolId", "gatewayId", "strapId", rssi, "seenAt")
       SELECT g."schoolId", g.id, sp.id, -55 - (random() * 12)::int, t
       FROM "Gateway" g
       JOIN "Student" st ON st."classId" = replace(g."roomId", '-r', '-c')
       JOIN "Strap" sp ON sp."studentId" = st.id
       CROSS JOIN generate_series($2::timestamptz, $3::timestamptz, interval '5 seconds') t
       WHERE g."schoolId" = $1 AND g.kind = 'ROOM'`,
      sid, from, to,
    );
    // Arrivals: 97 in 100 children come in through the gate between 07:30 and 07:55.
    const gate = zonedTime(date, '07:30', TZ);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Sighting" ("schoolId", "gatewayId", "strapId", rssi, "seenAt")
       SELECT st."schoolId", $1 || '-gw00', sp.id, -60, $2::timestamptz + (hashtext(st.id) % 1500 + 1500) * interval '1 second' + s * interval '5 seconds'
       FROM "Student" st JOIN "Strap" sp ON sp."studentId" = st.id CROSS JOIN generate_series(0, 2) s
       WHERE st."schoolId" = $1 AND abs(hashtext(st.id || $3)) % 100 >= 3`,
      sid, gate, date,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GatePresence" ("studentId", date, "arrivedAt")
       SELECT st.id, $3::date, $2::timestamptz + (hashtext(st.id) % 1500 + 1500) * interval '1 second'
       FROM "Student" st WHERE st."schoolId" = $1 AND abs(hashtext(st.id || $3)) % 100 >= 3`,
      sid, gate, date,
    );
  }
  await prisma.$executeRawUnsafe(`UPDATE "Strap" SET "lastSeenAt" = $2 WHERE "schoolId" = $1`, sid, zonedTime(PERF_DATE, PERF_TIME, TZ));

  // Registers for the school days before: every student, every period.
  const history = schoolDaysBefore(PERF_DATE, HISTORY_DAYS);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AttendanceRecord" (id, "schoolId", "studentId", "classId", "periodId", date, status, source, "updatedAt")
     SELECT st.id || ':' || d || ':' || p.number, st."schoolId", st.id, st."classId", p.id, d::date,
            (CASE WHEN abs(hashtext(st.id || d)) % 100 < 3 THEN '${AttendanceStatus.ABSENT}' WHEN abs(hashtext(st.id || d || p.id)) % 100 < 5 THEN '${AttendanceStatus.LATE}' ELSE '${AttendanceStatus.PRESENT}' END)::"AttendanceStatus",
            '${AttendanceSource.AUTOMATIC}'::"AttendanceSource", now()
     FROM "Student" st JOIN "Period" p ON p."schoolId" = st."schoolId" CROSS JOIN unnest($2::text[]) d
     WHERE st."schoolId" = $1`,
    sid, history,
  );
  // Notifications: about 30 per parent this term, all sent and most read.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Notification" (id, "schoolId", "userId", type, title, body, "createdAt", "sentAt", "readAt")
     SELECT u.id || ':n' || n, u."schoolId", u.id, 'attendance.arrived', 'Your child has arrived at school', 'Arrived through the main gate at 07:42.',
            now() - n * interval '1 day', now() - n * interval '1 day', CASE WHEN n > 1 THEN now() END
     FROM "User" u CROSS JOIN generate_series(1, 30) n WHERE u."schoolId" = $1 AND u.role = 'PARENT'`,
    sid,
  );
  // Activity log: 3,000 entries.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AuditLog" (id, "schoolId", "actorId", action, entity, "entityId", "createdAt")
     SELECT $1 || ':a' || n, $1, $1 || '-admin', 'attendance.mark', 'attendance', NULL, now() - n * interval '10 minutes'
     FROM generate_series(1, 3000) n`,
    sid,
  );
  // Absence notices for today's absent children, not answered yet (the follow-up job scans these).
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AbsenceNotice" ("studentId", date, "sentAt")
     SELECT st.id, $2::date, $3::timestamptz FROM "Student" st WHERE st."schoolId" = $1 AND abs(hashtext(st.id || $2)) % 100 < 3`,
    sid, PERF_DATE, zonedTime(PERF_DATE, '08:15', TZ),
  );

  // Chats: 150 threads between parents and class teachers, 20 messages each.
  const threads = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "ChatThread" (id, "schoolId", "studentId", "parentId", "staffId", "createdAt", "lastMessageAt")
     SELECT st.id || ':th', st."schoolId", st.id, g."userId", c."homeroomTeacherId", now() - interval '30 days', now() - (row_number() over ()) * interval '1 hour'
     FROM "Student" st JOIN "StudentGuardian" g ON g."studentId" = st.id JOIN "Class" c ON c.id = st."classId"
     WHERE st."schoolId" = $1 AND abs(hashtext(st.id)) % 1000 < 150 RETURNING id`,
    sid,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ChatMessage" (id, "threadId", "senderId", body, "createdAt", "readAt")
     SELECT t.id || ':m' || n, t.id, CASE WHEN n % 2 = 0 THEN t."parentId" ELSE t."staffId" END, 'Thank you, we will practise together this week.', t."lastMessageAt" - (20 - n) * interval '5 minutes', now()
     FROM "ChatThread" t CROSS JOIN generate_series(1, 20) n WHERE t."schoolId" = $1`,
    sid,
  );

  // Trips: 40 this year, each for one class, with every family's answer.
  for (let i = 0; i < 40; i++) {
    const tripId = `${sid}-trip${pad(i)}`;
    const classId = `${sid}-c${pad(i % CLASSES)}`;
    await prisma.trip.create({
      data: { id: tripId, schoolId: sid, title: `Museum visit ${i}`, destination: 'Tahrir, Cairo', date: dbDate(schoolDaysBefore(PERF_DATE, 40)[i]), departTime: '08:30', returnTime: '13:00', consentBy: new Date('2026-09-20T15:00:00Z'), status: 'CLOSED', classes: { create: { classId } } },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TripConsent" ("tripId", "studentId", decision, "byUserId", "signedName")
       SELECT $1, st.id, 'GIVEN', g."userId", 'Parent' FROM "Student" st JOIN "StudentGuardian" g ON g."studentId" = st.id WHERE st."classId" = $2`,
      tripId, classId,
    );
  }
  // Clubs: 10, about 25 children in each.
  for (let i = 0; i < 10; i++) {
    const activityId = `${sid}-act${i}`;
    await prisma.activity.create({ data: { id: activityId, schoolId: sid, yearId, name: `Club ${i}`, days: [i % 5], startTime: '14:00', endTime: '15:00', capacity: 30 } });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ActivityEnrolment" ("activityId", "studentId", status, "updatedAt")
       SELECT $1, st.id, 'ENROLLED', now() FROM "Student" st WHERE st."schoolId" = $2 AND abs(hashtext(st.id || $1)) % 40 = 0`,
      activityId, sid,
    );
  }
  return threads.length;
}

async function main() {
  const started = Date.now();
  const [{ tz }] = await prisma.$queryRawUnsafe<{ tz: string }[]>(`SELECT current_setting('TimeZone') AS tz`);
  if (tz !== 'UTC' && tz !== 'Etc/UTC') throw new Error(`The perf database runs in ${tz}; run create-db.ts --fresh so it runs in UTC.`);
  const hash = await bcrypt.hash(PASSWORD, 10);
  await prisma.user.create({ data: { id: 'perf-owner', email: 'owner@perf', name: 'Owner', role: Role.OWNER, passwordHash: hash } });
  for (let k = 1; k <= SCHOOLS; k++) {
    const t = Date.now();
    const { sid, yearId } = await seedSchool(k, hash);
    await seedVolume(sid, yearId);
    console.log(`School ${k}/${SCHOOLS} (${sid}) in ${Math.round((Date.now() - t) / 1000)} s`);
  }
  await prisma.$executeRawUnsafe('ANALYZE');
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM "Sighting"');
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s: ${SCHOOLS * CLASSES * PER_CLASS} students, ${SCHOOLS * READERS} readers, ${n} readings.`);
  console.log(`Sign in as admin@ps01.perf, t0@ps01.perf or p0@ps01.perf with ${PASSWORD}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
