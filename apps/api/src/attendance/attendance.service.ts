import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceMode, AttendanceSource, AttendanceStatus, ExceptionStatus, ExceptionType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { NotificationsService } from '../notifications/notifications';
import { ExcusesService } from '../excuses/excuses';
import { AuthUser } from '../auth/auth.decorators';
import { localParts, zonedTime } from '../common/time';
import { LocationsService } from '../devices/locations';
import { rulesFor } from '../devices/rules';
import { dbDate, isoDate, weekday } from '../common/dates';
import { SchoolCalendar } from '../setup/calendar';
import { toMinutes } from '../common/validation';

export interface Mark {
  studentId: string;
  status: AttendanceStatus;
  reason?: string;
}

/** Statuses that mean the child is accounted for at school today. */
const ACCOUNTED: AttendanceStatus[] = [AttendanceStatus.PRESENT, AttendanceStatus.LATE, AttendanceStatus.ON_TRIP, AttendanceStatus.EXCUSED];

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly locations: LocationsService,
    private readonly calendar: SchoolCalendar,
    private readonly excuses: ExcusesService,
  ) {}

  private async school(schoolId: string) {
    return this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  }

  /** Today's date in the school's time zone. */
  async today(schoolId: string, now = new Date()) {
    const school = await this.school(schoolId);
    return localParts(now, school.timezone).date;
  }

  private async loadSlot(schoolId: string, classId: string, periodId: string, date: string) {
    const [cls, period] = await Promise.all([
      this.prisma.class.findFirst({ where: { id: classId, schoolId } }),
      this.prisma.period.findFirst({ where: { id: periodId, schoolId } }),
    ]);
    if (!cls) throw new NotFoundException('Class not found.');
    if (!period) throw new NotFoundException('Period not found.');
    const lesson = await this.prisma.timetableEntry.findFirst({
      where: { classId, periodId, dayOfWeek: weekday(date) },
      include: { subject: { select: { name: true } }, room: { select: { id: true, name: true } }, teacher: { select: { id: true, name: true, honorific: true } } },
    });
    return { cls, period, lesson };
  }

  /**
   * Who may mark this lesson, and until when. Admins can mark or correct any
   * day; a teacher can mark lessons they teach (or their homeroom class)
   * today only. After the day ends a correction needs an admin.
   */
  private async access(user: AuthUser, schoolId: string, slot: Awaited<ReturnType<AttendanceService['loadSlot']>>, date: string, now = new Date()) {
    const today = await this.today(schoolId, now);
    if (date > today) return { canView: true, canEdit: false, why: 'You can’t mark a day that hasn’t happened yet.' };
    if (user.role === Role.SCHOOL_ADMIN) return { canView: true, canEdit: true, why: null };
    if (user.role !== Role.TEACHER) return { canView: false, canEdit: false, why: 'Only teachers and admins take attendance.' };
    const teachesIt = slot.lesson?.teacherId === user.id || slot.cls.homeroomTeacherId === user.id;
    if (!teachesIt) return { canView: false, canEdit: false, why: 'You don’t teach this class in this period.' };
    if (date < today) return { canView: true, canEdit: false, why: 'Past days can only be corrected by an admin.' };
    return { canView: true, canEdit: true, why: null };
  }

  async roster(user: AuthUser, schoolId: string, classId: string, periodId: string, date: string) {
    dbDate(date);
    const slot = await this.loadSlot(schoolId, classId, periodId, date);
    const access = await this.access(user, schoolId, slot, date);
    if (!access.canView) throw new ForbiddenException(access.why);
    const [students, records, school] = await Promise.all([
      this.prisma.student.findMany({ where: { schoolId, classId, active: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      this.prisma.attendanceRecord.findMany({ where: { classId, periodId, date: dbDate(date) }, include: { markedBy: { select: { name: true, honorific: true } } } }),
      this.school(schoolId),
    ]);
    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const live = await this.liveRoom(schoolId, school, slot, date, students.map((s) => s.id));
    return {
      date,
      class: { id: slot.cls.id, name: slot.cls.name },
      period: slot.period,
      lesson: slot.lesson ? { subject: slot.lesson.subject.name, room: slot.lesson.room, teacher: slot.lesson.teacher } : null,
      mode: school.attendanceMode,
      canEdit: access.canEdit,
      readOnlyReason: access.why,
      lessonState: live?.state ?? null,
      gatewayWorking: live?.gatewayWorking ?? false,
      students: students.map((s) => {
        const r = byStudent.get(s.id);
        return {
          live: live?.students.get(s.id) ?? null,
          id: s.id,
          code: s.code,
          name: `${s.firstName} ${s.lastName}`,
          photoUrl: s.photoUrl,
          status: r?.status ?? null,
          source: r?.source ?? null,
          reason: r?.reason ?? null,
          markedBy: r?.markedBy?.name ?? null,
          markedByHonorific: r?.markedBy?.honorific ?? null,
          firstSeenAt: r?.firstSeenAt ?? null,
        };
      }),
    };
  }

  /**
   * While a lesson is on (automatic attendance): who the room's gateway hears
   * now, and where everyone else was last heard. The lesson itself is still
   * decided when it ends; this is what the teacher sees in front of them.
   */
  private async liveRoom(schoolId: string, school: { attendanceMode: AttendanceMode; timezone: string; detection: Prisma.JsonValue }, slot: Awaited<ReturnType<AttendanceService['loadSlot']>>, date: string, studentIds: string[], now = new Date()) {
    if (school.attendanceMode !== AttendanceMode.AUTOMATIC || !slot.lesson || date !== localParts(now, school.timezone).date) return null;
    const start = zonedTime(date, slot.period.startTime, school.timezone);
    const end = zonedTime(date, slot.period.endTime, school.timezone);
    const state = now < start ? 'before' : now < end ? 'now' : 'after';
    const [straps, presence, roomGateways, places, alerts] = await Promise.all([
      this.prisma.strap.findMany({ where: { schoolId, studentId: { in: studentIds } }, select: { id: true, studentId: true } }),
      this.prisma.gatePresence.findMany({ where: { date: dbDate(date), studentId: { in: studentIds } } }),
      this.prisma.gateway.findMany({ where: { schoolId, roomId: slot.lesson.roomId }, select: { id: true, lastSeenAt: true } }),
      this.locations.placesOf(schoolId),
      this.prisma.attendanceException.findMany({
        where: { schoolId, type: ExceptionType.NOT_IN_CLASS, date: dbDate(date), periodId: slot.period.id, studentId: { in: studentIds } },
        select: { studentId: true, createdAt: true },
      }),
    ]);
    const toldAt = new Map(alerts.map((a) => [a.studentId!, a.createdAt]));
    const heard = await this.locations.lastHeard(schoolId, rulesFor(school.detection).room.minRssi, zonedTime(date, '00:00', school.timezone), now, straps.map((x) => x.id));
    const room = new Set(roomGateways.map((g) => g.id));
    const strapOf = new Map(straps.map((x) => [x.studentId!, x.id]));
    const arrivedOf = new Map(presence.map((p) => [p.studentId, p.arrivedAt]));
    const students = new Map(
      studentIds.map((id) => {
        const strap = strapOf.get(id);
        const h = strap ? heard.get(strap) : undefined;
        const inRoom = !!h && state === 'now' && room.has(h.gatewayId) && h.seenAt >= start && now.getTime() - h.seenAt.getTime() <= 3 * 60_000;
        return [id, { hasStrap: !!strap, inRoom, lastPlace: h ? places.get(h.gatewayId)?.name ?? null : null, lastHeardAt: h?.seenAt ?? null, arrivedAt: arrivedOf.get(id) ?? null, parentsToldAt: toldAt.get(id) ?? null }];
      }),
    );
    // A room whose gateway isn't working (not installed yet, or offline) can't say who is there.
    const gatewayWorking = roomGateways.some((g) => g.lastSeenAt && now.getTime() - g.lastSeenAt.getTime() <= rulesFor(school.detection).gatewayOfflineMinutes * 60_000);
    return { state, students, gatewayWorking };
  }

  /** The lesson a teacher has right now, and their next one today. */
  async current(user: AuthUser, schoolId: string, now = new Date()) {
    const school = await this.school(schoolId);
    const { date, time } = localParts(now, school.timezone);
    if (!(await this.calendar.isOpen(school, date))) return { date, now: null, next: null };
    const lessons = await this.myLessons(user, schoolId, date);
    return {
      date,
      now: lessons.find((l) => l.startTime <= time && time < l.endTime) ?? null,
      next: lessons.find((l) => l.startTime > time) ?? null,
    };
  }

  async mark(user: AuthUser, schoolId: string, classId: string, periodId: string, date: string, marks: Mark[], now = new Date()) {
    const day = dbDate(date);
    const school = await this.school(schoolId);
    const status = await this.calendar.day(school, date);
    if (!status.open) throw new BadRequestException(status.name ? `There’s no school that day: ${status.name}.` : 'That day isn’t a school day.');
    const slot = await this.loadSlot(schoolId, classId, periodId, date);
    const access = await this.access(user, schoolId, slot, date, now);
    if (!access.canEdit) throw new ForbiddenException(access.why);

    const inClass = new Set((await this.prisma.student.findMany({ where: { schoolId, classId, active: true }, select: { id: true } })).map((s) => s.id));
    const stranger = marks.find((m) => !inClass.has(m.studentId));
    if (stranger) throw new BadRequestException('A student in the list isn’t in this class.');
    // With automatic attendance, a manual mark is the fallback and must say why
    // (strap forgotten, strap not working, gateway offline…).
    if (school.attendanceMode === AttendanceMode.AUTOMATIC) {
      const missing = marks.find((m) => !m.reason?.trim());
      if (missing) throw new BadRequestException('Automatic attendance is on, so a manual mark needs a reason.');
    }

    await this.prisma.$transaction(
      marks.map((m) =>
        this.prisma.attendanceRecord.upsert({
          where: { studentId_date_periodId: { studentId: m.studentId, date: day, periodId } },
          create: { schoolId, classId, periodId, date: day, studentId: m.studentId, status: m.status, source: AttendanceSource.MANUAL, reason: m.reason, markedById: user.id },
          update: { status: m.status, source: AttendanceSource.MANUAL, reason: m.reason ?? null, markedById: user.id },
        }),
      ),
    );
    // A day with an approved excuse stays excused even if someone marks the child absent.
    await this.excuses.applyApproved(schoolId, { studentIds: marks.map((m) => m.studentId), date });
    await this.clearLessonAlerts(user, schoolId, periodId, date, marks, slot);
    await this.audit.log(user, 'attendance.mark', 'attendance', `${classId}:${periodId}:${date}`, {
      marks: marks.map((m) => ({ studentId: m.studentId, status: m.status, reason: m.reason ?? null })),
    } as Prisma.InputJsonValue);
    return this.roster(user, schoolId, classId, periodId, date);
  }

  /**
   * A child the parents were told was missing from this lesson has now been
   * marked in it (a forgotten strap, say): close the alert and tell them.
   */
  private async clearLessonAlerts(user: AuthUser, schoolId: string, periodId: string, date: string, marks: Mark[], slot: Awaited<ReturnType<AttendanceService['loadSlot']>>) {
    const inClass = marks.filter((m) => m.status === AttendanceStatus.PRESENT || m.status === AttendanceStatus.LATE).map((m) => m.studentId);
    if (!inClass.length) return;
    const open = await this.prisma.attendanceException.findMany({
      where: { schoolId, type: ExceptionType.NOT_IN_CLASS, status: ExceptionStatus.OPEN, date: dbDate(date), periodId, studentId: { in: inClass } },
      include: { student: { include: { guardians: { where: { restricted: false } } } } },
    });
    for (const e of open) {
      await this.prisma.attendanceException.update({
        where: { id: e.id },
        data: { status: ExceptionStatus.RESOLVED, resolvedById: user.id, resolvedAt: new Date(), note: 'Marked present in the lesson' },
      });
      const s = e.student!;
      const where = slot.lesson ? `${slot.lesson.subject.name} in ${slot.lesson.room.name}` : `period ${slot.period.number}`;
      await this.notifications.notify(
        s.guardians.map((g) => ({
          schoolId,
          userId: g.userId,
          type: 'attendance.lessonPresent',
          title: `${s.firstName} is now in ${where}`,
          body: `The teacher has marked ${s.firstName} present in ${where}. Please disregard the earlier message.`,
          data: { studentId: s.id, date, periodId, ...(slot.lesson ? { subject: slot.lesson.subject.name, room: slot.lesson.room.name } : {}) },
        })),
      );
    }
  }

  /** A teacher's lessons on a day, with how far each has been marked. */
  async myLessons(user: AuthUser, schoolId: string, date: string) {
    dbDate(date);
    const lessons = await this.prisma.timetableEntry.findMany({
      where: { schoolId, dayOfWeek: weekday(date), ...(user.role === Role.TEACHER ? { teacherId: user.id } : {}) },
      include: { class: { select: { id: true, name: true } }, period: true, subject: { select: { name: true } }, room: { select: { name: true } } },
      orderBy: { period: { number: 'asc' } },
    });
    const counts = await this.prisma.attendanceRecord.groupBy({
      by: ['classId', 'periodId'],
      where: { schoolId, date: dbDate(date) },
      _count: { _all: true },
    });
    const sizes = await this.prisma.student.groupBy({ by: ['classId'], where: { schoolId, active: true }, _count: { _all: true } });
    const size = new Map(sizes.map((s) => [s.classId, s._count._all]));
    const marked = new Map(counts.map((c) => [`${c.classId}:${c.periodId}`, c._count._all]));
    return lessons.map((l) => ({
      classId: l.classId,
      className: l.class.name,
      periodId: l.periodId,
      period: l.period.number,
      startTime: l.period.startTime,
      endTime: l.period.endTime,
      subject: l.subject.name,
      room: l.room.name,
      students: size.get(l.classId) ?? 0,
      marked: marked.get(`${l.classId}:${l.periodId}`) ?? 0,
    }));
  }

  /** Today at a glance: counts per status per period, across the school. */
  async summary(schoolId: string, date: string) {
    const rows = await this.prisma.attendanceRecord.groupBy({
      by: ['periodId', 'status'],
      where: { schoolId, date: dbDate(date) },
      _count: { _all: true },
    });
    const periods = await this.prisma.period.findMany({ where: { schoolId }, orderBy: { number: 'asc' } });
    const students = await this.prisma.student.count({ where: { schoolId, active: true } });
    const arrived = await this.prisma.gatePresence.count({ where: { date: dbDate(date), arrivedAt: { not: null }, student: { schoolId, active: true } } });
    return {
      date,
      students,
      arrived,
      periods: periods.map((p) => {
        const counts = Object.fromEntries(Object.values(AttendanceStatus).map((s) => [s, 0])) as Record<AttendanceStatus, number>;
        rows.filter((r) => r.periodId === p.id).forEach((r) => (counts[r.status] = r._count._all));
        return { id: p.id, number: p.number, startTime: p.startTime, endTime: p.endTime, counts };
      }),
    };
  }

  async studentHistory(schoolId: string, studentId: string, from: string, to: string) {
    if (!(await this.prisma.student.findFirst({ where: { id: studentId, schoolId } }))) throw new NotFoundException('Student not found.');
    return this.prisma.attendanceRecord.findMany({
      where: { studentId, date: { gte: dbDate(from), lte: dbDate(to) } },
      include: { period: { select: { number: true, startTime: true } } },
      orderBy: [{ date: 'desc' }, { period: { number: 'asc' } }],
    });
  }

  /**
   * Marks a class away (trip, exam elsewhere) for some periods or the whole
   * day, so nobody is flagged absent.
   */
  async markAway(user: AuthUser, schoolId: string, dto: { classId: string; date: string; fromPeriod?: number; toPeriod?: number; reason: string }) {
    const day = dbDate(dto.date);
    const cls = await this.prisma.class.findFirst({ where: { id: dto.classId, schoolId } });
    if (!cls) throw new NotFoundException('Class not found.');
    if (user.role === Role.TEACHER && cls.homeroomTeacherId !== user.id) {
      throw new ForbiddenException('Only the homeroom teacher or an admin can mark this class away.');
    }
    // Same rule as marking: a past day can only be changed by an admin.
    if (user.role !== Role.SCHOOL_ADMIN && dto.date < (await this.today(schoolId))) {
      throw new ForbiddenException('Past days can only be corrected by an admin.');
    }
    if ((dto.fromPeriod == null) !== (dto.toPeriod == null)) throw new BadRequestException('Give both fromPeriod and toPeriod, or neither for the whole day.');
    if (dto.fromPeriod != null && dto.toPeriod! < dto.fromPeriod) throw new BadRequestException('toPeriod must not be before fromPeriod.');
    const periods = await this.prisma.period.findMany({
      where: { schoolId, ...(dto.fromPeriod != null ? { number: { gte: dto.fromPeriod, lte: dto.toPeriod } } : {}) },
    });
    const students = await this.prisma.student.findMany({ where: { schoolId, classId: cls.id, active: true }, select: { id: true } });
    const away = await this.prisma.$transaction(async (tx) => {
      const away = await tx.classAway.create({
        data: { schoolId, classId: cls.id, date: day, fromPeriod: dto.fromPeriod, toPeriod: dto.toPeriod, reason: dto.reason, createdById: user.id },
      });
      for (const p of periods) {
        for (const s of students) {
          await tx.attendanceRecord.upsert({
            where: { studentId_date_periodId: { studentId: s.id, date: day, periodId: p.id } },
            create: { schoolId, classId: cls.id, periodId: p.id, date: day, studentId: s.id, status: AttendanceStatus.ON_TRIP, source: AttendanceSource.MANUAL, reason: dto.reason, markedById: user.id },
            update: { status: AttendanceStatus.ON_TRIP, source: AttendanceSource.MANUAL, reason: dto.reason, markedById: user.id },
          });
        }
      }
      return away;
    });
    await this.audit.log(user, 'attendance.away', 'class', cls.id, { ...dto });
    return { ...away, periods: periods.length, students: students.length };
  }

  aways(schoolId: string, date: string) {
    return this.prisma.classAway.findMany({ where: { schoolId, date: dbDate(date) }, include: { class: { select: { name: true } } } });
  }

  /** A child's lessons on a day for a parent, if the parent may see this child. */
  async childDay(parentId: string, studentId: string, date: string) {
    const link = await this.prisma.studentGuardian.findUnique({ where: { studentId_userId: { studentId, userId: parentId } } });
    if (!link || link.restricted) throw new NotFoundException('Child not found.');
    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, date: dbDate(date) },
      include: { period: true },
      orderBy: { period: { number: 'asc' } },
    });
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    const lessons = student.classId
      ? await this.prisma.timetableEntry.findMany({
          where: { classId: student.classId, dayOfWeek: weekday(date) },
          include: { period: true, subject: { select: { name: true } } },
        })
      : [];
    const subjectOf = new Map(lessons.map((l) => [l.periodId, l.subject.name]));
    return records.map((r) => ({
      period: r.period.number,
      startTime: r.period.startTime,
      endTime: r.period.endTime,
      subject: subjectOf.get(r.periodId) ?? null,
      status: r.status,
      firstSeenAt: r.firstSeenAt,
    }));
  }

  /**
   * A child's whole day for the parent app: when they came in, where the strap
   * was last heard in the past minute, and every lesson on the timetable
   * with its room and, once taken, its attendance.
   */
  async childToday(parentId: string, studentId: string, date: string, now = new Date()) {
    const link = await this.prisma.studentGuardian.findUnique({ where: { studentId_userId: { studentId, userId: parentId } } });
    if (!link || link.restricted) throw new NotFoundException('Child not found.');
    const day = dbDate(date);
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: studentId }, include: { strap: true } });
    const school = await this.school(student.schoolId);
    const [records, lessons, presence] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { studentId, date: day }, include: { period: true } }),
      student.classId
        ? this.prisma.timetableEntry.findMany({
            where: { classId: student.classId, dayOfWeek: weekday(date) },
            include: { period: true, subject: { select: { name: true } }, room: { select: { name: true } } },
          })
        : Promise.resolve([]),
      this.prisma.gatePresence.findUnique({ where: { studentId_date: { studentId, date: day } } }),
    ]);
    const byPeriod = new Map(records.map((r) => [r.periodId, r]));
    const rows = new Map<string, { period: number; startTime: string; endTime: string; subject: string | null; room: string | null; status: AttendanceStatus | null }>();
    for (const l of lessons) {
      rows.set(l.periodId, { period: l.period.number, startTime: l.period.startTime, endTime: l.period.endTime, subject: l.subject.name, room: l.room.name, status: byPeriod.get(l.periodId)?.status ?? null });
    }
    // A mark without a timetable lesson (a trip, a changed timetable) still shows.
    for (const r of records) {
      if (!rows.has(r.periodId)) rows.set(r.periodId, { period: r.period.number, startTime: r.period.startTime, endTime: r.period.endTime, subject: null, room: null, status: r.status });
    }

    // Where the child is now: only with the straps subscription, and only for a
    // parent who agreed to tracking in the app.
    let place: { name: string; kind: string | null; heardAt: Date } | null = null;
    const [mod, parent] = await Promise.all([
      this.prisma.schoolModule.findUnique({ where: { schoolId_key: { schoolId: student.schoolId, key: 'attendance' } } }),
      this.prisma.user.findUnique({ where: { id: parentId }, select: { consentAt: true } }),
    ]);
    const tracking = !!(mod?.features as Record<string, boolean> | undefined)?.automatic && !!parent?.consentAt;
    if (tracking && student.strap && date === localParts(now, school.timezone).date) {
      const heard = await this.locations.lastHeard(student.schoolId, rulesFor(school.detection).room.minRssi, new Date(now.getTime() - 60_000), now, [student.strap.id]);
      const h = heard.get(student.strap.id);
      if (h) {
        const p = (await this.locations.placesOf(student.schoolId)).get(h.gatewayId);
        if (p) place = { name: p.room ?? p.name, kind: p.kind, heardAt: h.seenAt };
      }
    }

    // The "do you know your child isn't at school?" question for today, and any excuse covering the day.
    const [notice, excuse] = await Promise.all([
      this.prisma.absenceNotice.findUnique({ where: { studentId_date: { studentId, date: day } } }),
      this.prisma.excuse.findFirst({ where: { studentId, fromDate: { lte: day }, toDate: { gte: day } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, reason: true, decisionNote: true } }),
    ]);

    return {
      date,
      arrivedAt: presence?.arrivedAt ?? null,
      leftAt: presence?.leftAt ?? null,
      place,
      check: notice ? { askedAt: notice.sentAt, answer: notice.answer, alerted: !!notice.alertedAt } : null,
      excuse,
      lessons: [...rows.values()].sort((a, b) => a.period - b.period),
    };
  }

  /**
   * Sends "absent today" once per child per day, at the school's fixed notice
   * time: a child with an absence and nothing showing they're at school.
   */
  async sendAbsenceNotices(now = new Date()) {
    const schools = await this.prisma.school.findMany({ where: { modules: { some: { key: 'attendance', enabled: true } } } });
    let sent = 0;
    for (const school of schools) {
      const { date, time, dayOfWeek } = localParts(now, school.timezone);
      // No "absent today" on a weekend, holiday or break.
      if (!school.schoolDays.includes(dayOfWeek) || toMinutes(time) < toMinutes(school.absenceNoticeTime) || !(await this.calendar.isOpen(school, date))) continue;
      const day = dbDate(date);
      const absent = await this.prisma.student.findMany({
        where: {
          schoolId: school.id,
          active: true,
          attendance: { some: { date: day, status: AttendanceStatus.ABSENT }, none: { date: day, status: { in: ACCOUNTED } } },
          absenceNotices: { none: { date: day } },
          // A parent who already sent an excuse for this day isn't asked again.
          excuses: { none: { fromDate: { lte: day }, toDate: { gte: day } } },
        },
        include: { guardians: { where: { restricted: false } } },
      });
      for (const s of absent) {
        // The notice row is the lock: a second run can't send twice.
        const created = await this.prisma.absenceNotice.createMany({ data: [{ studentId: s.id, date: day }], skipDuplicates: true });
        if (!created.count) continue;
        sent += await this.notifications.notify(
          s.guardians.map((g) => ({
            schoolId: school.id,
            userId: g.userId,
            type: 'attendance.absentCheck',
            title: `${s.firstName} didn’t come to school today`,
            body: `${s.firstName} hasn’t been marked present at school today. Do you know why ${s.firstName} isn’t at school?`,
            data: { studentId: s.id, date, check: true },
          })),
        );
      }
    }
    return sent;
  }
}
