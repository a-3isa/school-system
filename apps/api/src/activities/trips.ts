import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { AttendanceSource, AttendanceStatus, ConsentDecision, Prisma, Role, TripStatus } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsISO8601, IsIn, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { schoolHas } from '../auth/access.guard';
import { AuthUser, CurrentUser, RequiresFeature, RequiresModule, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { DATE_RE, dbDate, isoDate } from '../common/dates';
import { localParts, zonedTime } from '../common/time';
import { TIME_RE, defined, toMinutes } from '../common/validation';
import { ownChild, teacherClassIds } from '../messaging/shared';
import { NotificationsService } from '../notifications/notifications';
import { SchoolCalendar } from '../setup/calendar';

const HOUR = 3600_000;

export class TripDto {
  @IsString() @MinLength(2) @MaxLength(120) title: string;
  @IsString() @MinLength(2) @MaxLength(120) destination: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() date: string;
  @IsString() departTime: string;
  @IsString() returnTime: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) fromPeriod?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) toPeriod?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) fee?: number;
  /** Parents answer before this moment (ISO date-time). */
  @IsISO8601() consentBy: string;
  @IsOptional() @IsString() leaderId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) classIds: string[];
}

export class UpdateTripDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) destination?: string;
  @IsOptional() @ValidateIf((d) => d.description !== null) @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() departTime?: string;
  @IsOptional() @IsString() returnTime?: string;
  @IsOptional() @ValidateIf((d) => d.fromPeriod !== null) @IsInt() @Min(1) @Max(20) fromPeriod?: number | null;
  @IsOptional() @ValidateIf((d) => d.toPeriod !== null) @IsInt() @Min(1) @Max(20) toPeriod?: number | null;
  @IsOptional() @ValidateIf((d) => d.fee !== null) @IsInt() @Min(0) @Max(100000) fee?: number | null;
  @IsOptional() @IsISO8601() consentBy?: string;
  @IsOptional() @ValidateIf((d) => d.leaderId !== null) @IsString() leaderId?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) classIds?: string[];
}

export class ConsentDto {
  @IsEnum(ConsentDecision) decision: ConsentDecision;
  @IsString() @MinLength(3) @MaxLength(100) signedName: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class TripPaidDto {
  @IsBoolean() paid: boolean;
}

export class HeadcountDto {
  @IsString() studentId: string;
  @IsIn(['LEFT', 'BACK']) leg: 'LEFT' | 'BACK';
  @IsOptional() @IsISO8601() at?: string;
}

const leaderSelect = { id: true, name: true, honorific: true } as const;

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly calendar: SchoolCalendar,
  ) {}

  // ---- helpers ---------------------------------------------------------------

  private school(schoolId: string) {
    return this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  }

  private async trip(schoolId: string, id: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id, schoolId }, include: { classes: { select: { classId: true, class: { select: { id: true, name: true } } } }, leader: { select: leaderSelect } } });
    if (!trip) throw new NotFoundException('Trip not found.');
    return trip;
  }

  /** Student Affairs, a teacher of one of the classes and the trip's leader may look at the answers. */
  private async assertMayWatch(user: AuthUser, schoolId: string, trip: { leaderId: string | null; classes: { classId: string }[] }) {
    if (user.role === Role.SCHOOL_ADMIN || trip.leaderId === user.id) return;
    if (user.role === Role.TEACHER) {
      const own = await teacherClassIds(this.prisma, schoolId, user.id);
      if (trip.classes.some((c) => own.has(c.classId))) return;
    }
    throw new ForbiddenException('You can see only the trips of your own classes.');
  }

  /** The active students going to the classes of a trip, with the parents to tell. */
  private students(schoolId: string, classIds: string[]) {
    return this.prisma.student.findMany({
      where: { schoolId, active: true, classId: { in: classIds } },
      select: {
        id: true, firstName: true, lastName: true, nameAr: true, gender: true, classId: true, class: { select: { name: true } },
        guardians: { select: { userId: true, restricted: true, relation: true, user: { select: { name: true, phone: true, active: true } } } },
      },
      orderBy: [{ class: { name: 'asc' } }, { firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  private departure(trip: { date: Date; departTime: string }, timezone: string) {
    return zonedTime(isoDate(trip.date), trip.departTime, timezone);
  }

  /** Checks the whole trip, whether new or an update merged onto what is there. */
  private async validate(schoolId: string, school: { id: string; schoolDays: number[]; timezone: string }, t: { date: string; departTime: string; returnTime: string; fromPeriod: number | null; toPeriod: number | null; consentBy: Date; leaderId: string | null }, classIds: string[] | null, now: Date, deadlineChanged: boolean) {
    if (!DATE_RE.test(t.date)) throw new BadRequestException('Dates must look like 2026-09-30.');
    if (!(await this.calendar.isOpen(school, t.date))) throw new BadRequestException('The school is closed that day.');
    if (!TIME_RE.test(t.departTime) || !TIME_RE.test(t.returnTime)) throw new BadRequestException('Times must look like 08:30.');
    if (toMinutes(t.departTime) >= toMinutes(t.returnTime)) throw new BadRequestException('The trip must leave before it returns.');
    if ((t.fromPeriod == null) !== (t.toPeriod == null)) throw new BadRequestException('Give both fromPeriod and toPeriod, or neither for the whole day.');
    if (t.fromPeriod != null && t.toPeriod! < t.fromPeriod) throw new BadRequestException('toPeriod must not be before fromPeriod.');
    if (deadlineChanged) {
      if (t.consentBy.getTime() <= now.getTime()) throw new BadRequestException('The answer deadline must be in the future.');
      if (t.consentBy.getTime() >= zonedTime(t.date, t.departTime, school.timezone).getTime()) throw new BadRequestException('The answer deadline must be before the trip leaves.');
    }
    if (classIds) {
      const found = await this.prisma.class.count({ where: { schoolId, id: { in: classIds } } });
      if (found !== new Set(classIds).size) throw new BadRequestException('Class not found in this school.');
    }
    if (t.leaderId && !(await this.prisma.user.findFirst({ where: { id: t.leaderId, schoolId, active: true, role: { in: [Role.TEACHER, Role.SCHOOL_ADMIN] } } }))) {
      throw new BadRequestException('Trip leader not found in this school.');
    }
  }

  private async tellParents(schoolId: string, classIds: string[], make: (s: { id: string; firstName: string }) => { type: string; title: string; body: string; data: Prisma.InputJsonValue }, only?: (studentId: string) => boolean) {
    const students = await this.students(schoolId, classIds);
    const items = students
      .filter((s) => !only || only(s.id))
      .flatMap((s) =>
        s.guardians
          .filter((g) => !g.restricted && g.user.active)
          .map((g) => ({ schoolId, userId: g.userId, ...make(s) })),
      );
    return this.notifications.notify(items);
  }

  private present(t: Awaited<ReturnType<TripsService['trip']>>) {
    const { classes, ...rest } = t;
    return { ...rest, classes: classes.map((c) => c.class) };
  }

  // ---- staff -----------------------------------------------------------------

  async list(user: AuthUser, schoolId: string, from?: string, to?: string) {
    for (const d of [from, to]) if (d && !DATE_RE.test(d)) throw new BadRequestException('Dates must look like 2026-09-30.');
    const own = user.role === Role.TEACHER ? await teacherClassIds(this.prisma, schoolId, user.id) : null;
    const trips = await this.prisma.trip.findMany({
      where: {
        schoolId,
        ...(from || to ? { date: { ...(from ? { gte: dbDate(from) } : {}), ...(to ? { lte: dbDate(to) } : {}) } } : {}),
        ...(own ? { classes: { some: { classId: { in: [...own] } } } } : {}),
      },
      include: { classes: { select: { classId: true, class: { select: { id: true, name: true } } } }, leader: { select: leaderSelect }, consents: { select: { decision: true, paidAt: true } } },
      orderBy: [{ date: 'desc' }, { departTime: 'asc' }],
    });
    // Students per class, read once for all the trips.
    const perClass = new Map<string, number>();
    const classIds = [...new Set(trips.flatMap((t) => t.classes.map((c) => c.classId)))];
    if (classIds.length) {
      const rows = await this.prisma.student.groupBy({ by: ['classId'], where: { schoolId, active: true, classId: { in: classIds } }, _count: true });
      for (const r of rows) if (r.classId) perClass.set(r.classId, r._count);
    }
    return trips.map(({ consents, classes, ...t }) => {
      const going = classes.reduce((sum, c) => sum + (perClass.get(c.classId) ?? 0), 0);
      const given = consents.filter((c) => c.decision === 'GIVEN').length;
      const declined = consents.filter((c) => c.decision === 'DECLINED').length;
      return {
        ...t, classes: classes.map((c) => c.class),
        counts: { students: going, given, declined, waiting: Math.max(0, going - given - declined), paid: consents.filter((c) => c.decision === 'GIVEN' && c.paidAt).length },
      };
    });
  }

  async create(user: AuthUser, schoolId: string, dto: TripDto, now = new Date()) {
    const school = await this.school(schoolId);
    const merged = { date: dto.date, departTime: dto.departTime, returnTime: dto.returnTime, fromPeriod: dto.fromPeriod ?? null, toPeriod: dto.toPeriod ?? null, consentBy: new Date(dto.consentBy), leaderId: dto.leaderId ?? null };
    await this.validate(schoolId, school, merged, dto.classIds, now, true);
    const trip = await this.prisma.trip.create({
      data: {
        schoolId, title: dto.title.trim(), destination: dto.destination.trim(), description: dto.description?.trim() || null, date: dbDate(dto.date),
        departTime: dto.departTime, returnTime: dto.returnTime, fromPeriod: merged.fromPeriod, toPeriod: merged.toPeriod, fee: dto.fee ?? null, consentBy: merged.consentBy,
        leaderId: merged.leaderId, createdById: user.id, classes: { create: [...new Set(dto.classIds)].map((classId) => ({ classId })) },
      },
    });
    await this.audit.log(user, 'trip.create', 'trip', trip.id, { title: trip.title, date: dto.date });
    return this.present(await this.trip(schoolId, trip.id));
  }

  async update(user: AuthUser, schoolId: string, id: string, dto: UpdateTripDto, now = new Date()) {
    const trip = await this.trip(schoolId, id);
    if (trip.status === TripStatus.CLOSED) throw new BadRequestException('This trip is closed. Cancel it and create a new one to change it.');
    if (trip.status === TripStatus.CANCELLED) throw new BadRequestException('This trip has been cancelled.');
    if (dto.classIds && trip.status !== TripStatus.DRAFT) throw new BadRequestException('The classes can be changed only while the trip is a draft.');
    const school = await this.school(schoolId);
    const data = defined({
      title: dto.title?.trim(), destination: dto.destination?.trim(), description: typeof dto.description === 'string' ? dto.description.trim() || null : dto.description,
      date: dto.date ? dbDate(dto.date) : undefined, departTime: dto.departTime, returnTime: dto.returnTime, fromPeriod: dto.fromPeriod, toPeriod: dto.toPeriod, fee: dto.fee,
      consentBy: dto.consentBy ? new Date(dto.consentBy) : undefined, leaderId: dto.leaderId,
    });
    const merged = {
      date: dto.date ?? isoDate(trip.date), departTime: dto.departTime ?? trip.departTime, returnTime: dto.returnTime ?? trip.returnTime,
      fromPeriod: dto.fromPeriod !== undefined ? dto.fromPeriod : trip.fromPeriod, toPeriod: dto.toPeriod !== undefined ? dto.toPeriod : trip.toPeriod,
      consentBy: dto.consentBy ? new Date(dto.consentBy) : trip.consentBy, leaderId: dto.leaderId !== undefined ? dto.leaderId : trip.leaderId,
    };
    await this.validate(schoolId, school, merged, dto.classIds ?? null, now, !!(dto.consentBy || dto.date || dto.departTime));
    await this.prisma.$transaction(async (tx) => {
      await tx.trip.updateMany({ where: { id, schoolId }, data });
      if (dto.classIds) {
        await tx.tripClass.deleteMany({ where: { tripId: id } });
        await tx.tripClass.createMany({ data: [...new Set(dto.classIds)].map((classId) => ({ tripId: id, classId })) });
      }
    });
    await this.audit.log(user, 'trip.update', 'trip', id, { ...dto });
    // Parents who already answered are told when the day, the times or the fee change under them.
    if (trip.status === TripStatus.OPEN && (dto.date || dto.departTime || dto.returnTime || dto.fee !== undefined)) {
      const answered = new Set((await this.prisma.tripConsent.findMany({ where: { tripId: id }, select: { studentId: true } })).map((c) => c.studentId));
      await this.tellParents(schoolId, trip.classes.map((c) => c.classId), (s) => ({ type: 'trip.changed', title: `The trip ${trip.title} has changed`, body: 'Please check the details.', data: { tripId: id, studentId: s.id, title: dto.title ?? trip.title } }), (sid) => answered.has(sid));
    }
    return this.present(await this.trip(schoolId, id));
  }

  /** DRAFT to OPEN: parents of every student in the classes are asked for permission. */
  async open(user: AuthUser, schoolId: string, id: string, now = new Date()) {
    const trip = await this.trip(schoolId, id);
    if (trip.status !== TripStatus.DRAFT) throw new BadRequestException('Only a draft trip can be opened.');
    if (trip.consentBy.getTime() <= now.getTime()) throw new BadRequestException('The answer deadline has passed. Move it later before opening the trip.');
    const { count } = await this.prisma.trip.updateMany({ where: { id, schoolId, status: TripStatus.DRAFT }, data: { status: TripStatus.OPEN } });
    if (!count) throw new BadRequestException('Only a draft trip can be opened.');
    await this.audit.log(user, 'trip.open', 'trip', id, {});
    const date = isoDate(trip.date);
    const told = await this.tellParents(schoolId, trip.classes.map((c) => c.classId), (s) => ({
      type: 'trip.consent', title: `Permission needed: ${trip.title} on ${date} for ${s.firstName}`, body: trip.destination,
      data: { tripId: id, studentId: s.id, title: trip.title, date },
    }));
    return { ok: true, told };
  }

  /** OPEN to CLOSED: the list is final, and the students going are marked On a trip in the registers. */
  async close(user: AuthUser, schoolId: string, id: string) {
    const trip = await this.trip(schoolId, id);
    if (trip.status !== TripStatus.OPEN) throw new BadRequestException('Only an open trip can be closed.');
    await this.prisma.trip.updateMany({ where: { id, schoolId, status: TripStatus.OPEN }, data: { status: TripStatus.CLOSED } });
    const marked = await this.applyAttendance(trip, user);
    await this.audit.log(user, 'trip.close', 'trip', id, { marked });
    return { ok: true, marked };
  }

  async cancel(user: AuthUser, schoolId: string, id: string) {
    const trip = await this.trip(schoolId, id);
    if (trip.status === TripStatus.CANCELLED) throw new BadRequestException('This trip is already cancelled.');
    await this.prisma.$transaction([
      this.prisma.trip.updateMany({ where: { id, schoolId }, data: { status: TripStatus.CANCELLED } }),
      // Exactly the records the trip wrote.
      this.prisma.attendanceRecord.deleteMany({ where: { tripId: id, schoolId } }),
    ]);
    await this.audit.log(user, 'trip.cancel', 'trip', id, { wasStatus: trip.status });
    // A draft was never shown to anyone.
    if (trip.status !== TripStatus.DRAFT) {
      const date = isoDate(trip.date);
      await this.tellParents(schoolId, trip.classes.map((c) => c.classId), (s) => ({ type: 'trip.cancelled', title: `The trip ${trip.title} on ${date} has been cancelled`, body: trip.destination, data: { tripId: id, studentId: s.id, title: trip.title, date } }));
    }
    return { ok: true };
  }

  /** Marks every student with permission "On a trip" for the trip's periods (the whole day when none are given). */
  async applyAttendance(trip: { id: string; schoolId: string; title: string; date: Date; fromPeriod: number | null; toPeriod: number | null }, actor: AuthUser) {
    const [periods, consents] = await Promise.all([
      this.prisma.period.findMany({ where: { schoolId: trip.schoolId, ...(trip.fromPeriod != null ? { number: { gte: trip.fromPeriod, lte: trip.toPeriod! } } : {}) } }),
      this.prisma.tripConsent.findMany({ where: { tripId: trip.id, decision: ConsentDecision.GIVEN, student: { active: true, classId: { not: null } } }, select: { student: { select: { id: true, classId: true } } } }),
    ]);
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const c of consents) {
      for (const p of periods) {
        ops.push(
          this.prisma.attendanceRecord.upsert({
            where: { studentId_date_periodId: { studentId: c.student.id, date: trip.date, periodId: p.id } },
            create: { schoolId: trip.schoolId, classId: c.student.classId!, periodId: p.id, date: trip.date, studentId: c.student.id, status: AttendanceStatus.ON_TRIP, source: AttendanceSource.MANUAL, reason: `Trip: ${trip.title}`, tripId: trip.id, markedById: actor.id },
            update: { status: AttendanceStatus.ON_TRIP, source: AttendanceSource.MANUAL, reason: `Trip: ${trip.title}`, tripId: trip.id, markedById: actor.id },
          }),
        );
      }
    }
    if (ops.length) await this.prisma.$transaction(ops);
    return ops.length;
  }

  /** One row for each student going: the answer, who signed it, and the parents' phones for chasing. */
  async consents(user: AuthUser, schoolId: string, id: string) {
    const trip = await this.trip(schoolId, id);
    await this.assertMayWatch(user, schoolId, trip);
    const [students, consents] = await Promise.all([
      this.students(schoolId, trip.classes.map((c) => c.classId)),
      this.prisma.tripConsent.findMany({ where: { tripId: id }, include: { byUser: { select: { name: true } } } }),
    ]);
    const byStudent = new Map(consents.map((c) => [c.studentId, c]));
    return {
      trip: { id: trip.id, title: trip.title, status: trip.status, fee: trip.fee, consentBy: trip.consentBy },
      rows: students.map((s) => {
        const c = byStudent.get(s.id);
        return {
          studentId: s.id, name: `${s.firstName} ${s.lastName}`, nameAr: s.nameAr, class: s.class?.name ?? null,
          decision: c?.decision ?? null, signedName: c?.signedName ?? null, signedBy: c?.byUser.name ?? null, note: c?.note ?? null, at: c?.at ?? null, paidAt: c?.paidAt ?? null,
          parents: s.guardians.map((g) => ({ name: g.user.name, phone: g.user.phone, relation: g.relation, restricted: g.restricted })),
        };
      }),
    };
  }

  async setPaid(user: AuthUser, schoolId: string, id: string, studentId: string, paid: boolean) {
    const trip = await this.trip(schoolId, id);
    if (trip.fee == null) throw new BadRequestException('This trip has no fee.');
    const { count } = await this.prisma.tripConsent.updateMany({ where: { tripId: id, studentId, decision: ConsentDecision.GIVEN }, data: { paidAt: paid ? new Date() : null } });
    if (!count) throw new BadRequestException('Only students with permission can be marked as paid.');
    await this.audit.log(user, 'trip.paid', 'trip', id, { studentId, paid });
    return { ok: true };
  }

  async headcount(user: AuthUser, schoolId: string, id: string) {
    const trip = await this.trip(schoolId, id);
    this.assertCounts(user, trip);
    const consents = await this.prisma.tripConsent.findMany({
      where: { tripId: id, decision: ConsentDecision.GIVEN, student: { active: true } },
      select: { student: { select: { id: true, firstName: true, lastName: true, nameAr: true, class: { select: { name: true } } } } },
    });
    const checks = new Map((await this.prisma.tripCheck.findMany({ where: { tripId: id } })).map((c) => [c.studentId, c]));
    const rows = consents
      .map((c) => ({ studentId: c.student.id, name: `${c.student.firstName} ${c.student.lastName}`, nameAr: c.student.nameAr, class: c.student.class?.name ?? null, leftAt: checks.get(c.student.id)?.leftAt ?? null, backAt: checks.get(c.student.id)?.backAt ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { trip: { id: trip.id, title: trip.title, date: isoDate(trip.date), status: trip.status }, going: rows.length, left: rows.filter((r) => r.leftAt).length, back: rows.filter((r) => r.backAt).length, rows };
  }

  private assertCounts(user: AuthUser, trip: { leaderId: string | null }) {
    if (user.role !== Role.SCHOOL_ADMIN && trip.leaderId !== user.id) throw new ForbiddenException('Only Student Affairs or the trip leader can take the headcount.');
  }

  async takeHeadcount(user: AuthUser, schoolId: string, id: string, dto: HeadcountDto, now = new Date()) {
    const trip = await this.trip(schoolId, id);
    this.assertCounts(user, trip);
    const school = await this.school(schoolId);
    if (localParts(now, school.timezone).date !== isoDate(trip.date)) throw new BadRequestException('Headcount is taken on the day of the trip.');
    if (trip.status !== TripStatus.OPEN && trip.status !== TripStatus.CLOSED) throw new BadRequestException('Headcount can be taken for an open or closed trip.');
    const consent = await this.prisma.tripConsent.findFirst({ where: { tripId: id, studentId: dto.studentId, decision: ConsentDecision.GIVEN } });
    if (!consent) throw new BadRequestException('That student isn’t going on this trip.');
    const at = dto.at ? new Date(dto.at) : now;
    const existing = await this.prisma.tripCheck.findUnique({ where: { tripId_studentId: { tripId: id, studentId: dto.studentId } } });
    if (dto.leg === 'BACK' && !existing?.leftAt) throw new BadRequestException('Mark that the student left first.');
    await this.prisma.tripCheck.upsert({
      where: { tripId_studentId: { tripId: id, studentId: dto.studentId } },
      create: { tripId: id, studentId: dto.studentId, ...(dto.leg === 'LEFT' ? { leftAt: at } : {}) },
      update: dto.leg === 'LEFT' ? { leftAt: at, backAt: null } : { backAt: at },
    });
    return { ok: true };
  }

  /**
   * Once for each open trip whose deadline is a day away: parents who haven't answered are reminded.
   * Called from the minute tick; it sends at most one reminder for a trip.
   */
  async remind(now = new Date()) {
    const due = await this.prisma.trip.findMany({
      where: { status: TripStatus.OPEN, remindedAt: null, consentBy: { gte: new Date(now.getTime() + 23 * HOUR), lt: new Date(now.getTime() + 24 * HOUR) } },
      include: { classes: { select: { classId: true } } },
    });
    let sent = 0;
    const enabled = new Map<string, boolean>();
    for (const trip of due) {
      if (!enabled.has(trip.schoolId)) enabled.set(trip.schoolId, await schoolHas(this.prisma, trip.schoolId, 'activities', 'trips'));
      if (!enabled.get(trip.schoolId)) continue;
      // Claim it first, so two ticks can't both send it.
      const { count } = await this.prisma.trip.updateMany({ where: { id: trip.id, remindedAt: null }, data: { remindedAt: now } });
      if (!count) continue;
      const answered = new Set((await this.prisma.tripConsent.findMany({ where: { tripId: trip.id }, select: { studentId: true } })).map((c) => c.studentId));
      sent += await this.tellParents(trip.schoolId, trip.classes.map((c) => c.classId), (s) => ({
        type: 'trip.reminder', title: `Reminder: please answer the permission slip for ${s.firstName} by tomorrow`, body: trip.title,
        data: { tripId: trip.id, studentId: s.id, title: trip.title },
      }), (sid) => !answered.has(sid));
    }
    return sent;
  }

  // ---- parent ----------------------------------------------------------------

  private async myTrip(childId: string, classId: string | null, schoolId: string, tripId: string) {
    const trip = classId
      ? await this.prisma.trip.findFirst({ where: { id: tripId, schoolId, status: { not: TripStatus.DRAFT }, classes: { some: { classId } } } })
      : null;
    if (!trip) throw new NotFoundException('Trip not found.');
    return trip;
  }

  async forChild(user: AuthUser, childId: string, now = new Date()) {
    const child = await ownChild(this.prisma, user.id, childId);
    if (!child.classId) return [];
    const school = await this.school(child.schoolId);
    const since = new Date(dbDate(localParts(now, school.timezone).date).getTime() - 30 * 86400_000);
    const trips = await this.prisma.trip.findMany({
      where: { schoolId: child.schoolId, status: { not: TripStatus.DRAFT }, date: { gte: since }, classes: { some: { classId: child.classId } } },
      include: { leader: { select: leaderSelect }, consents: { where: { studentId: childId }, include: { byUser: { select: { name: true } } } } },
      orderBy: { date: 'asc' },
    });
    return trips.map(({ consents, leaderId: _, ...t }) => {
      const mine = consents[0];
      return {
        ...t,
        myConsent: mine ? { decision: mine.decision, signedName: mine.signedName, signedBy: mine.byUser.name, note: mine.note, at: mine.at } : null,
        canAnswer: t.status === TripStatus.OPEN && now.getTime() < t.consentBy.getTime(),
        paid: !!mine?.paidAt,
      };
    });
  }

  async consent(user: AuthUser, childId: string, tripId: string, dto: ConsentDto, now = new Date()) {
    const child = await ownChild(this.prisma, user.id, childId);
    const trip = await this.myTrip(childId, child.classId, child.schoolId, tripId);
    if (trip.status === TripStatus.CANCELLED) throw new BadRequestException('This trip has been cancelled.');
    if (trip.status !== TripStatus.OPEN || now.getTime() >= trip.consentBy.getTime()) {
      throw new BadRequestException('The deadline for this permission slip has passed. Please contact the school.');
    }
    const signedName = dto.signedName.trim().replace(/\s+/g, ' ');
    if (signedName.length < 3) throw new BadRequestException('Type your full name to sign.');
    await this.prisma.tripConsent.upsert({
      where: { tripId_studentId: { tripId, studentId: childId } },
      create: { tripId, studentId: childId, decision: dto.decision, byUserId: user.id, signedName, note: dto.note?.trim() || null, at: now },
      update: { decision: dto.decision, byUserId: user.id, signedName, note: dto.note?.trim() || null, at: now },
    });
    // The legal trail: who said what, and the name they typed as their signature.
    await this.audit.log(user, 'trip.consent', 'trip', tripId, { studentId: childId, decision: dto.decision, signedName });
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });
    const others = await this.prisma.studentGuardian.findMany({ where: { studentId: childId, restricted: false, userId: { not: user.id }, user: { active: true } }, select: { userId: true } });
    await this.notifications.notify(
      others.map((g) => ({
        schoolId: child.schoolId, userId: g.userId, type: 'trip.answered',
        title: `${me.name} answered the permission slip for ${child.firstName}: ${dto.decision === 'GIVEN' ? 'Yes' : 'No'}`, body: trip.title,
        data: { tripId, studentId: childId, decision: dto.decision, by: me.name, title: trip.title },
      })),
    );
    return { ok: true, decision: dto.decision };
  }
}

@RequiresModule('activities')
@RequiresFeature('activities', 'trips')
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.trips.list(user, schoolId, from, to);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: TripDto) {
    return this.trips.create(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateTripDto) {
    return this.trips.update(user, schoolId, id, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/open')
  open(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.trips.open(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/close')
  close(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.trips.close(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.trips.cancel(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Get(':id/consents')
  consents(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.trips.consents(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/students/:studentId/paid')
  paid(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('studentId') studentId: string, @Body() dto: TripPaidDto) {
    return this.trips.setPaid(user, schoolId, id, studentId, dto.paid);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Get(':id/headcount')
  headcount(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.trips.headcount(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post(':id/headcount')
  takeHeadcount(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: HeadcountDto) {
    return this.trips.takeHeadcount(user, schoolId, id, dto);
  }
}

@RequiresModule('activities')
@RequiresFeature('activities', 'trips')
@Roles(Role.PARENT)
@Controller('parent/children')
export class ParentTripsController {
  constructor(private readonly trips: TripsService) {}

  @Get(':id/trips')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.trips.forChild(user, id);
  }

  @Post(':id/trips/:tripId/consent')
  consent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('tripId') tripId: string, @Body() dto: ConsentDto) {
    return this.trips.consent(user, id, tripId, dto);
  }
}
