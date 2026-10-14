import { Injectable, Logger } from '@nestjs/common';
import { AttendanceMode, AttendanceSource, AttendanceStatus, ExceptionType, GatewayKind, Prisma, Role, School } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications';
import { localParts, zonedTime } from '../common/time';
import { dbDate } from '../common/dates';
import { toMinutes } from '../common/validation';
import { SchoolCalendar } from '../setup/calendar';
import { decidePeriod, DetectionRules, rulesFor } from './rules';

const MINUTE = 60_000;
// Wait this long after a period ends before deciding it, so late batches arrive.
const SETTLE_MINUTES = 2;
const KEEP_SIGHTINGS_DAYS = 7;
// Old readings go a batch at a time, and only so many a minute, so a backlog never holds up the job.
const PURGE_BATCH = 10_000;
const PURGE_BATCHES_PER_SCHOOL = 10;

/**
 * Turns strap sightings into attendance, once a minute, for schools using
 * automatic attendance: decides each finished lesson, spots children who went
 * out through the gate, flat strap batteries and silent gateways.
 */
@Injectable()
export class AttendanceEvaluator {
  private readonly logger = new Logger('Evaluator');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly calendar: SchoolCalendar,
  ) {}

  async tick(now = new Date()) {
    const schools = await this.prisma.school.findMany({
      where: { attendanceMode: AttendanceMode.AUTOMATIC, modules: { some: { key: 'attendance', enabled: true } } },
    });
    for (const school of schools) {
      try {
        await this.evaluateSchool(school, now);
      } catch (e) {
        this.logger.error(`School ${school.id}: ${(e as Error).message}`);
      }
    }
    await this.purgeSightings(now);
  }

  /**
   * Removes readings older than a week (decision H38), school by school: the readings are indexed by
   * school and time, and a delete by time alone reads the whole table.
   */
  async purgeSightings(now = new Date()) {
    const before = new Date(now.getTime() - KEEP_SIGHTINGS_DAYS * 24 * 60 * MINUTE);
    const schools = await this.prisma.school.findMany({ select: { id: true } });
    let removed = 0;
    for (const { id } of schools) {
      for (let i = 0; i < PURGE_BATCHES_PER_SCHOOL; i++) {
        const n = await this.prisma.$executeRaw`
          DELETE FROM "Sighting" WHERE id IN (
            SELECT id FROM "Sighting" WHERE "schoolId" = ${id} AND "seenAt" < (${before}::timestamptz AT TIME ZONE 'UTC') LIMIT ${PURGE_BATCH})`;
        removed += n;
        if (n < PURGE_BATCH) break;
      }
    }
    return removed;
  }

  async evaluateSchool(school: School, now: Date) {
    const { date, time, dayOfWeek } = localParts(now, school.timezone);
    if (!school.schoolDays.includes(dayOfWeek) || !(await this.calendar.isOpen(school, date))) return;
    const rules = rulesFor(school.detection);
    const periods = await this.prisma.period.findMany({ where: { schoolId: school.id }, orderBy: { number: 'asc' } });
    if (!periods.length) return;
    const nowMin = toMinutes(time);
    const day = dbDate(date);

    const done = new Set(
      (await this.prisma.evaluatedPeriod.findMany({ where: { schoolId: school.id, date: day } })).map((e) => e.periodId),
    );
    for (const p of periods) {
      if (done.has(p.id) || toMinutes(p.endTime) + SETTLE_MINUTES > nowMin) continue;
      await this.evaluatePeriod(school, rules, date, p);
      await this.prisma.evaluatedPeriod.create({ data: { schoolId: school.id, date: day, periodId: p.id } });
    }

    const dayStart = toMinutes(periods[0].startTime);
    const dayEnd = toMinutes(periods[periods.length - 1].endTime);
    if (nowMin >= dayStart && nowMin <= dayEnd) {
      await this.checkGateways(school, rules, date, now);
      await this.checkLessonsInProgress(school, rules, date, now, periods);
    }
    await this.checkLeftEarly(school, rules, date, now, zonedTime(date, periods[periods.length - 1].endTime, school.timezone));
    await this.checkBatteries(school, rules, date);
  }

  private raise(data: Omit<Prisma.AttendanceExceptionUncheckedCreateInput, 'status'>) {
    return this.prisma.attendanceException.createMany({ data: [data], skipDuplicates: true });
  }

  /** Decides every lesson of one finished period from strap sightings. */
  async evaluatePeriod(school: School, rules: DetectionRules, date: string, period: { id: string; number: number; startTime: string; endTime: string }) {
    const day = dbDate(date);
    const start = zonedTime(date, period.startTime, school.timezone);
    const end = zonedTime(date, period.endTime, school.timezone);
    const lessons = await this.prisma.timetableEntry.findMany({
      where: { schoolId: school.id, dayOfWeek: day.getUTCDay(), periodId: period.id },
      include: { class: true, room: { include: { gateways: true } }, subject: true },
    });
    const aways = await this.prisma.classAway.findMany({ where: { schoolId: school.id, date: day } });

    for (const lesson of lessons) {
      const away = aways.some((a) => a.classId === lesson.classId && (a.fromPeriod == null || (a.fromPeriod <= period.number && period.number <= a.toPeriod!)));
      if (away) continue;
      const label = `${lesson.class.name} ${lesson.subject.name} (period ${period.number})`;

      const roomGateways = lesson.room.gateways.filter((g) => g.kind === GatewayKind.ROOM);
      const alive = roomGateways.filter((g) => g.lastSeenAt && g.lastSeenAt.getTime() >= end.getTime() - rules.gatewayOfflineMinutes * MINUTE);
      if (!alive.length) {
        // No working gateway: the class falls back to manual marking (decision C17).
        await this.raise({
          schoolId: school.id, type: ExceptionType.GATEWAY_OFFLINE, date: day, classId: lesson.classId, periodId: period.id,
          message: roomGateways.length
            ? `The gateway in ${lesson.room.name} was offline. Mark ${label} manually.`
            : `${lesson.room.name} has no gateway. Mark ${label} manually.`,
          dedupeKey: `GATEWAY_OFFLINE:lesson:${lesson.id}:${date}`,
        });
        continue;
      }

      const students = await this.prisma.student.findMany({
        where: { schoolId: school.id, classId: lesson.classId, active: true, strap: { isNot: null } },
        include: { strap: true },
      });
      if (!students.length) continue;
      const existing = await this.prisma.attendanceRecord.findMany({ where: { periodId: period.id, date: day, studentId: { in: students.map((s) => s.id) } } });
      const manual = new Set(existing.filter((r) => r.source === AttendanceSource.MANUAL).map((r) => r.studentId));

      const sightings = await this.prisma.sighting.findMany({
        where: { schoolId: school.id, strapId: { in: students.map((s) => s.strap!.id) }, seenAt: { gte: start, lt: end } },
        select: { strapId: true, gatewayId: true, rssi: true, seenAt: true },
      });
      const byStrap = new Map<string, typeof sightings>();
      for (const s of sightings) byStrap.set(s.strapId, [...(byStrap.get(s.strapId) ?? []), s]);
      const roomIds = new Set(roomGateways.map((g) => g.id));
      const presence = await this.prisma.gatePresence.findMany({ where: { date: day, studentId: { in: students.map((s) => s.id) } } });
      const arrived = new Map(presence.map((p) => [p.studentId, p]));

      for (const student of students) {
        if (manual.has(student.id)) continue; // a person's mark always wins
        const d = decidePeriod(byStrap.get(student.strap!.id) ?? [], roomIds, start, end, rules.room);
        await this.prisma.attendanceRecord.upsert({
          where: { studentId_date_periodId: { studentId: student.id, date: day, periodId: period.id } },
          create: {
            schoolId: school.id, studentId: student.id, classId: lesson.classId, periodId: period.id, date: day,
            status: d.status, source: AttendanceSource.AUTOMATIC, firstSeenAt: d.firstSeenAt, secondsSeen: d.secondsInRoom,
          },
          update: { status: d.status, firstSeenAt: d.firstSeenAt, secondsSeen: d.secondsInRoom },
        });
        if (d.status !== AttendanceStatus.ABSENT) continue;
        const name = `${student.firstName} ${student.lastName}`;
        const gate = arrived.get(student.id);
        if (d.share > 0) {
          await this.raise({
            schoolId: school.id, type: ExceptionType.LEFT_LESSON, date: day, studentId: student.id, classId: lesson.classId, periodId: period.id,
            message: `${name} was in ${label} for only ${Math.round(d.share * 100)}% of the lesson.`,
            dedupeKey: `LEFT_LESSON:${student.id}:${period.id}:${date}`,
          });
        } else if (gate?.arrivedAt && gate.arrivedAt < end && !(gate.leftAt && gate.leftAt < start)) {
          const at = localParts(gate.arrivedAt, school.timezone).time;
          await this.raise({
            schoolId: school.id, type: ExceptionType.NOT_IN_CLASS, date: day, studentId: student.id, classId: lesson.classId, periodId: period.id,
            message: `${name} arrived at ${at} but wasn’t in ${label}.`,
            dedupeKey: `NOT_IN_CLASS:${student.id}:${period.id}:${date}`,
          });
        }
      }
    }
  }

  /**
   * During a lesson: a child who came in through the gate but hasn't been in
   * the lesson's room since it started (10 minutes by default) is reported to
   * the parents straight away, not only when the lesson ends. The teacher can
   * still mark them present (a forgotten strap), which tells the parents again.
   */
  async checkLessonsInProgress(school: School, rules: DetectionRules, date: string, now: Date, periods: { id: string; number: number; startTime: string; endTime: string }[]) {
    const day = dbDate(date);
    const nowMs = now.getTime();
    for (const period of periods) {
      const start = zonedTime(date, period.startTime, school.timezone);
      const end = zonedTime(date, period.endTime, school.timezone);
      if (nowMs < start.getTime() + rules.room.lateAfterMinutes * MINUTE || nowMs >= end.getTime()) continue;
      const lessons = await this.prisma.timetableEntry.findMany({
        where: { schoolId: school.id, dayOfWeek: day.getUTCDay(), periodId: period.id },
        include: { class: true, room: { include: { gateways: true } }, subject: true },
      });
      const aways = await this.prisma.classAway.findMany({ where: { schoolId: school.id, date: day } });
      for (const lesson of lessons) {
        if (aways.some((a) => a.classId === lesson.classId && (a.fromPeriod == null || (a.fromPeriod <= period.number && period.number <= a.toPeriod!)))) continue;
        const roomGateways = lesson.room.gateways.filter(
          (g) => g.kind === GatewayKind.ROOM && g.lastSeenAt && g.lastSeenAt.getTime() >= nowMs - rules.gatewayOfflineMinutes * MINUTE,
        );
        if (!roomGateways.length) continue; // can't tell without a working gateway in the room
        const students = await this.prisma.student.findMany({
          where: { schoolId: school.id, classId: lesson.classId, active: true, strap: { isNot: null } },
          include: { strap: true, guardians: { where: { restricted: false } } },
        });
        if (!students.length) continue;
        const ids = students.map((s) => s.id);
        const [presence, marks] = await Promise.all([
          this.prisma.gatePresence.findMany({ where: { date: day, studentId: { in: ids }, arrivedAt: { not: null, lte: now } } }),
          this.prisma.attendanceRecord.findMany({ where: { date: day, periodId: period.id, studentId: { in: ids }, source: AttendanceSource.MANUAL } }),
        ]);
        // Still at school: not marked as gone, and not heard at the gate on the way out with nothing inside since.
        const gateIds = (await this.prisma.gateway.findMany({ where: { schoolId: school.id, kind: GatewayKind.GATE }, select: { id: true } })).map((g) => g.id);
        const stillIn = [];
        for (const p of presence) {
          if (p.leftAt && p.leftAt <= now) continue;
          if (p.lastGateAt && p.lastGateAt > p.arrivedAt!) {
            const inside = await this.prisma.sighting.count({ where: { strap: { studentId: p.studentId }, seenAt: { gt: p.lastGateAt, lte: now }, gatewayId: { notIn: gateIds } } });
            if (!inside) continue;
          }
          stillIn.push(p);
        }
        const arrived = new Map(stillIn.map((p) => [p.studentId, p.arrivedAt!]));
        const marked = new Set(marks.map((m) => m.studentId)); // the teacher already decided
        const candidates = students.filter((s) => arrived.has(s.id) && !marked.has(s.id));
        if (!candidates.length) continue;
        const sightings = await this.prisma.sighting.findMany({
          where: { schoolId: school.id, strapId: { in: candidates.map((s) => s.strap!.id) }, seenAt: { gte: start, lte: now } },
          select: { strapId: true, gatewayId: true, rssi: true, seenAt: true },
        });
        const roomIds = new Set(roomGateways.map((g) => g.id));
        for (const student of candidates) {
          const d = decidePeriod(sightings.filter((x) => x.strapId === student.strap!.id), roomIds, start, now, rules.room);
          if (d.share > 0) continue; // has been in the room
          const where = `${lesson.subject.name} in ${lesson.room.name}`;
          const created = await this.raise({
            schoolId: school.id, type: ExceptionType.NOT_IN_CLASS, date: day, studentId: student.id, classId: lesson.classId, periodId: period.id,
            message: `${student.firstName} ${student.lastName} came in at ${localParts(arrived.get(student.id)!, school.timezone).time} but hasn’t been in ${lesson.class.name} ${where} (period ${period.number}).`,
            dedupeKey: `NOT_IN_CLASS:${student.id}:${period.id}:${date}`,
          });
          if (!created.count) continue; // already told
          await this.notifications.notify(
            student.guardians.map((g) => ({
              schoolId: school.id,
              userId: g.userId,
              type: 'attendance.lessonAbsent',
              title: `${student.firstName} hasn’t joined ${where}`,
              body: `${student.firstName} arrived at ${localParts(arrived.get(student.id)!, school.timezone).time} but hasn’t been in ${where}, which began at ${period.startTime}. The school has been informed and is following up.`,
              data: { studentId: student.id, date, periodId: period.id, subject: lesson.subject.name, room: lesson.room.name },
            })),
          );
        }
      }
    }
  }

  /**
   * A child heard at the gate and then nowhere for a while has probably gone
   * out: tell the parents and the school (decision R9).
   */
  private async checkLeftEarly(school: School, rules: DetectionRules, date: string, now: Date, dayEnd: Date) {
    const day = dbDate(date);
    const candidates = await this.prisma.gatePresence.findMany({
      where: {
        date: day, leftAt: null, lastGateAt: { not: null, lte: new Date(now.getTime() - rules.leftAfterMinutes * MINUTE), lt: dayEnd },
        student: { schoolId: school.id, active: true },
      },
      include: { student: { include: { strap: true, guardians: { where: { restricted: false } } } } },
    });
    if (!candidates.length) return;
    const admins = await this.prisma.user.findMany({ where: { schoolId: school.id, role: Role.SCHOOL_ADMIN, active: true } });
    for (const c of candidates) {
      const lastSeen = c.student.strap?.lastSeenAt;
      if (lastSeen && lastSeen.getTime() > c.lastGateAt!.getTime() + 30_000) continue; // still around
      await this.prisma.gatePresence.update({ where: { studentId_date: { studentId: c.studentId, date: day } }, data: { leftAt: c.lastGateAt } });
      const at = localParts(c.lastGateAt!, school.timezone).time;
      const name = c.student.firstName;
      await this.raise({
        schoolId: school.id, type: ExceptionType.LEFT_EARLY, date: day, studentId: c.studentId,
        message: `${name} ${c.student.lastName} went out through the gate at ${at} before the end of the school day.`,
        dedupeKey: `LEFT_EARLY:${c.studentId}:${date}`,
      });
      await this.notifications.notify([
        ...c.student.guardians.map((g) => ({
          schoolId: school.id, userId: g.userId, type: 'attendance.left',
          title: `${name} left school early`, body: `${name} left through the school gate at ${at}. The school has been informed.`,
          data: { studentId: c.studentId, date, time: at },
        })),
        ...admins.map((a) => ({
          schoolId: school.id, userId: a.id, type: 'attendance.left',
          title: `${name} ${c.student.lastName} left early`, body: `Went out through the gate at ${at} without a dismissal.`,
          data: { studentId: c.studentId, date, time: at },
        })),
      ]);
    }
  }

  private async checkGateways(school: School, rules: DetectionRules, date: string, now: Date) {
    const silent = await this.prisma.gateway.findMany({
      where: {
        schoolId: school.id, kind: { in: [GatewayKind.GATE, GatewayKind.ROOM] },
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - rules.gatewayOfflineMinutes * MINUTE) } }],
      },
      include: { room: true },
    });
    for (const g of silent) {
      await this.raise({
        schoolId: school.id, type: ExceptionType.GATEWAY_OFFLINE, date: dbDate(date), gatewayId: g.id,
        message: `Gateway “${g.name ?? g.serial}”${g.room ? ` in ${g.room.name}` : ''} isn’t reporting. Lessons there switch to manual marking.`,
        dedupeKey: `GATEWAY_OFFLINE:gateway:${g.id}:${date}`,
      });
    }
  }

  private async checkBatteries(school: School, rules: DetectionRules, date: string) {
    const low = await this.prisma.strap.findMany({
      where: { schoolId: school.id, battery: { lt: rules.lowBattery }, studentId: { not: null } },
      include: { student: true },
    });
    const month = date.slice(0, 7);
    for (const s of low) {
      await this.raise({
        schoolId: school.id, type: ExceptionType.LOW_BATTERY, date: dbDate(date), studentId: s.studentId,
        message: `${s.student!.firstName} ${s.student!.lastName}’s strap battery is at ${s.battery}%. Replace the battery soon.`,
        dedupeKey: `LOW_BATTERY:${s.id}:${month}`,
      });
    }
  }
}
