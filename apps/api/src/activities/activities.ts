import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { EnrolmentStatus, Prisma, Role } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { schoolHas } from '../auth/access.guard';
import { AuthUser, CurrentUser, RequiresFeature, RequiresModule, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { DATE_RE, dbDate, weekday } from '../common/dates';
import { localParts } from '../common/time';
import { TIME_RE, defined, toMinutes } from '../common/validation';
import { ownChild } from '../messaging/shared';
import { NotificationsService } from '../notifications/notifications';
import { SchoolCalendar } from '../setup/calendar';

export class ActivityDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(80) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() supervisorId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) days: number[];
  @IsString() startTime: string;
  @IsString() endTime: string;
  @IsOptional() @IsString() roomId?: string;
  @IsInt() @Min(1) @Max(500) capacity: number;
  @IsOptional() @IsArray() @IsString({ each: true }) gradeIds?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(100000) fee?: number;
  @IsOptional() @IsBoolean() signupOpen?: boolean;
  /** The school year it runs in; the current one when left out. */
  @IsOptional() @IsString() yearId?: string;
}

export class UpdateActivityDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @ValidateIf((d) => d.nameAr !== null) @IsString() @MaxLength(80) nameAr?: string | null;
  @IsOptional() @ValidateIf((d) => d.description !== null) @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @ValidateIf((d) => d.supervisorId !== null) @IsString() supervisorId?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) days?: number[];
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @ValidateIf((d) => d.roomId !== null) @IsString() roomId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(500) capacity?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) gradeIds?: string[];
  @IsOptional() @ValidateIf((d) => d.fee !== null) @IsInt() @Min(0) @Max(100000) fee?: number | null;
  @IsOptional() @IsBoolean() signupOpen?: boolean;
}

export class EnrolDto {
  @IsString() studentId: string;
}

export class PaidDto {
  @IsBoolean() paid: boolean;
}

export class ClubAttendanceDto {
  @IsString() date: string;
  /** studentId → present. */
  @IsObject() present: Record<string, boolean>;
}

const supervisorSelect = { id: true, name: true, honorific: true } as const;

/** Do two clubs' meeting times overlap on a day they share? */
function clashes(a: { days: number[]; startTime: string; endTime: string }, b: { days: number[]; startTime: string; endTime: string }) {
  return a.days.some((d) => b.days.includes(d)) && toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
}

@Injectable()
export class ActivitiesService {
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

  private paidOn(schoolId: string) {
    return schoolHas(this.prisma, schoolId, 'activities', 'paidActivities');
  }

  /** The school year a date falls in, or null. */
  private async currentYearId(schoolId: string, timezone: string, now: Date): Promise<string | null> {
    return (await this.calendar.termOf(schoolId, localParts(now, timezone).date))?.yearId ?? null;
  }

  private async club(schoolId: string, id: string) {
    const club = await this.prisma.activity.findFirst({ where: { id, schoolId } });
    if (!club) throw new NotFoundException('Club not found.');
    return club;
  }

  /** Student Affairs manages every club; a teacher only the ones they supervise. */
  private mayManage(user: AuthUser, club: { supervisorId: string | null }) {
    if (user.role === Role.SCHOOL_ADMIN) return true;
    return user.role === Role.TEACHER && club.supervisorId === user.id;
  }

  private assertMayManage(user: AuthUser, club: { supervisorId: string | null }) {
    if (!this.mayManage(user, club)) throw new ForbiddenException('You can manage only the clubs you supervise.');
  }

  /** Checks a whole club (create, or an update merged onto what is there). */
  private async validate(schoolId: string, school: { schoolDays: number[] }, c: { days: number[]; startTime: string; endTime: string; capacity: number; gradeIds: string[]; fee: number | null; supervisorId: string | null; roomId: string | null }, feeWasGiven: boolean) {
    if (new Set(c.days).size !== c.days.length) throw new BadRequestException('Each day can be chosen once.');
    if (c.days.some((d) => !school.schoolDays.includes(d))) throw new BadRequestException('Choose days the school is open.');
    if (!TIME_RE.test(c.startTime) || !TIME_RE.test(c.endTime)) throw new BadRequestException('Times must look like 14:30.');
    if (toMinutes(c.startTime) >= toMinutes(c.endTime)) throw new BadRequestException('The club must start before it ends.');
    if (c.gradeIds.length) {
      const found = await this.prisma.grade.count({ where: { schoolId, id: { in: c.gradeIds } } });
      if (found !== new Set(c.gradeIds).size) throw new BadRequestException('Year group not found.');
    }
    if (feeWasGiven && c.fee != null && !(await this.paidOn(schoolId))) throw new BadRequestException('Fees for clubs are switched off for this school.');
    if (c.supervisorId && !(await this.prisma.user.findFirst({ where: { id: c.supervisorId, schoolId, active: true, role: { in: [Role.TEACHER, Role.SCHOOL_ADMIN] } } }))) {
      throw new BadRequestException('Supervisor not found in this school.');
    }
    if (c.roomId && !(await this.prisma.room.findFirst({ where: { id: c.roomId, schoolId } }))) throw new BadRequestException('Room not found in this school.');
  }

  private present(a: Prisma.ActivityGetPayload<{ include: { supervisor: { select: typeof supervisorSelect }; room: { select: { id: true; name: true } } } }> & { _count?: { enrolments: number }; enrolled?: number; waitlisted?: number }, paid: boolean, user?: AuthUser) {
    const { fee, archivedAt: _, ...rest } = a as any;
    return { ...rest, fee: paid ? fee : null, ...(user ? { canManage: this.mayManage(user, a) } : {}) };
  }

  /**
   * Fills any free places from the waitlist, earliest first, and says who moved up.
   * Runs inside the transaction of whatever freed the place.
   */
  private async promoteNext(tx: Prisma.TransactionClient, activityId: string, capacity: number): Promise<string[]> {
    const promoted: string[] = [];
    for (;;) {
      const enrolled = await tx.activityEnrolment.count({ where: { activityId, status: EnrolmentStatus.ENROLLED } });
      if (enrolled >= capacity) break;
      const next = await tx.activityEnrolment.findFirst({ where: { activityId, status: EnrolmentStatus.WAITLISTED }, orderBy: { joinedAt: 'asc' } });
      if (!next) break;
      await tx.activityEnrolment.update({ where: { activityId_studentId: { activityId, studentId: next.studentId } }, data: { status: EnrolmentStatus.ENROLLED } });
      promoted.push(next.studentId);
    }
    return promoted;
  }

  private async tellPromoted(schoolId: string, club: { id: string; name: string; nameAr: string | null }, studentIds: string[]) {
    if (!studentIds.length) return;
    const students = await this.prisma.student.findMany({
      where: { id: { in: studentIds }, schoolId },
      select: { id: true, firstName: true, guardians: { where: { restricted: false, user: { active: true } }, select: { userId: true } } },
    });
    await this.notifications.notify(
      students.flatMap((s) =>
        s.guardians.map((g) => ({
          schoolId, userId: g.userId, type: 'activity.promoted',
          title: `Good news: ${s.firstName} now has a place in ${club.name}`, body: club.name,
          data: { studentId: s.id, activityId: club.id, name: club.name, nameAr: club.nameAr },
        })),
      ),
    );
  }

  // ---- staff -----------------------------------------------------------------

  async list(user: AuthUser, schoolId: string, yearId?: string, now = new Date()) {
    const school = await this.school(schoolId);
    const year = yearId ?? (await this.currentYearId(schoolId, school.timezone, now));
    if (!year) return [];
    const paid = await this.paidOn(schoolId);
    const clubs = await this.prisma.activity.findMany({
      where: { schoolId, yearId: year, archivedAt: null },
      include: {
        supervisor: { select: supervisorSelect },
        room: { select: { id: true, name: true } },
        enrolments: { where: { status: { in: [EnrolmentStatus.ENROLLED, EnrolmentStatus.WAITLISTED] } }, select: { status: true } },
      },
      orderBy: [{ name: 'asc' }],
    });
    return clubs.map(({ enrolments, ...c }) =>
      this.present({ ...c, enrolled: enrolments.filter((e) => e.status === 'ENROLLED').length, waitlisted: enrolments.filter((e) => e.status === 'WAITLISTED').length } as any, paid, user),
    );
  }

  async create(user: AuthUser, schoolId: string, dto: ActivityDto, now = new Date()) {
    const school = await this.school(schoolId);
    const yearId = dto.yearId ?? (await this.currentYearId(schoolId, school.timezone, now));
    if (!yearId) throw new BadRequestException('Set the school year first, under School structure & year.');
    if (!(await this.prisma.academicYear.findFirst({ where: { id: yearId, schoolId } }))) throw new BadRequestException('School year not found.');
    const club = { days: dto.days, startTime: dto.startTime, endTime: dto.endTime, capacity: dto.capacity, gradeIds: dto.gradeIds ?? [], fee: dto.fee ?? null, supervisorId: dto.supervisorId ?? null, roomId: dto.roomId ?? null };
    await this.validate(schoolId, school, club, dto.fee != null);
    const created = await this.prisma.activity.create({
      data: { schoolId, yearId, name: dto.name.trim(), nameAr: dto.nameAr?.trim() || null, description: dto.description?.trim() || null, signupOpen: dto.signupOpen ?? true, ...club },
      include: { supervisor: { select: supervisorSelect }, room: { select: { id: true, name: true } } },
    });
    await this.audit.log(user, 'activity.create', 'activity', created.id, { name: created.name });
    return this.present({ ...created, enrolled: 0, waitlisted: 0 } as any, await this.paidOn(schoolId), user);
  }

  async update(user: AuthUser, schoolId: string, id: string, dto: UpdateActivityDto) {
    const club = await this.club(schoolId, id);
    const school = await this.school(schoolId);
    const data = defined({
      name: dto.name?.trim(), nameAr: typeof dto.nameAr === 'string' ? dto.nameAr.trim() || null : dto.nameAr, description: typeof dto.description === 'string' ? dto.description.trim() || null : dto.description,
      supervisorId: dto.supervisorId, days: dto.days, startTime: dto.startTime, endTime: dto.endTime, roomId: dto.roomId, capacity: dto.capacity, gradeIds: dto.gradeIds, fee: dto.fee, signupOpen: dto.signupOpen,
    });
    const merged = { ...club, ...data } as typeof club;
    if (dto.capacity !== undefined) {
      const enrolled = await this.prisma.activityEnrolment.count({ where: { activityId: id, status: EnrolmentStatus.ENROLLED } });
      if (dto.capacity < enrolled) throw new BadRequestException('More students are enrolled than the new number of places.');
    }
    await this.validate(schoolId, school, merged, dto.fee !== undefined && dto.fee !== null);
    // Raising the number of places moves people up from the waitlist.
    const promoted = await this.prisma.$transaction(async (tx) => {
      await tx.activity.updateMany({ where: { id, schoolId }, data });
      return this.promoteNext(tx, id, merged.capacity);
    });
    await this.audit.log(user, 'activity.update', 'activity', id, { ...dto });
    await this.tellPromoted(schoolId, merged, promoted);
    const [updated] = (await this.list(user, schoolId, club.yearId)).filter((c: any) => c.id === id);
    return updated;
  }

  async archive(user: AuthUser, schoolId: string, id: string) {
    await this.club(schoolId, id);
    await this.prisma.$transaction([
      this.prisma.activity.updateMany({ where: { id, schoolId }, data: { archivedAt: new Date() } }),
      this.prisma.activityEnrolment.updateMany({ where: { activityId: id, status: { in: [EnrolmentStatus.ENROLLED, EnrolmentStatus.WAITLISTED] } }, data: { status: EnrolmentStatus.WITHDRAWN } }),
    ]);
    await this.audit.log(user, 'activity.archive', 'activity', id, {});
    return { ok: true };
  }

  async roster(user: AuthUser, schoolId: string, id: string) {
    const club = await this.club(schoolId, id);
    this.assertMayManage(user, club);
    const paid = await this.paidOn(schoolId);
    const rows = await this.prisma.activityEnrolment.findMany({
      where: { activityId: id, status: { in: [EnrolmentStatus.ENROLLED, EnrolmentStatus.WAITLISTED] } },
      orderBy: { joinedAt: 'asc' },
      include: {
        student: {
          select: {
            id: true, code: true, firstName: true, lastName: true, nameAr: true, class: { select: { name: true } },
            guardians: { select: { relation: true, user: { select: { name: true, phone: true } } } },
          },
        },
      },
    });
    const marks = await this.prisma.activityAttendance.groupBy({ by: ['studentId', 'present'], where: { activityId: id }, _count: true });
    const rate = (studentId: string) => {
      const mine = marks.filter((m) => m.studentId === studentId);
      const total = mine.reduce((n, m) => n + m._count, 0);
      return total ? Math.round((mine.filter((m) => m.present).reduce((n, m) => n + m._count, 0) / total) * 100) : null;
    };
    const row = (e: (typeof rows)[number]) => ({
      studentId: e.studentId, name: `${e.student.firstName} ${e.student.lastName}`, nameAr: e.student.nameAr, code: e.student.code, class: e.student.class?.name ?? null,
      parents: e.student.guardians.map((g) => ({ name: g.user.name, phone: g.user.phone, relation: g.relation })),
      joinedAt: e.joinedAt, paidAt: paid ? e.paidAt : null, attendanceRate: rate(e.studentId),
    });
    const enrolled = rows.filter((e) => e.status === 'ENROLLED').map(row);
    const waitlist = rows.filter((e) => e.status === 'WAITLISTED').map((e, i) => ({ ...row(e), position: i + 1 }));
    return { activity: { id: club.id, name: club.name, nameAr: club.nameAr, capacity: club.capacity, days: club.days, startTime: club.startTime, endTime: club.endTime, fee: paid ? club.fee : null }, enrolled, waitlist };
  }

  async enrol(user: AuthUser, schoolId: string, id: string, dto: EnrolDto) {
    const club = await this.club(schoolId, id);
    const student = await this.prisma.student.findFirst({ where: { id: dto.studentId, schoolId, active: true }, select: { id: true, firstName: true } });
    if (!student) throw new BadRequestException('Student not found.');
    const existing = await this.prisma.activityEnrolment.findUnique({ where: { activityId_studentId: { activityId: id, studentId: student.id } } });
    if (existing?.status === EnrolmentStatus.ENROLLED) throw new BadRequestException(`${student.firstName} is already on the list.`);
    const enrolled = await this.prisma.activityEnrolment.count({ where: { activityId: id, status: EnrolmentStatus.ENROLLED } });
    await this.prisma.activityEnrolment.upsert({
      where: { activityId_studentId: { activityId: id, studentId: student.id } },
      create: { activityId: id, studentId: student.id, status: EnrolmentStatus.ENROLLED, byUserId: user.id },
      update: { status: EnrolmentStatus.ENROLLED, joinedAt: new Date(), byUserId: user.id, paidAt: null },
    });
    await this.audit.log(user, 'activity.enrol', 'activity', id, { studentId: student.id, overCapacity: enrolled >= club.capacity });
    return { ok: true, overCapacity: enrolled >= club.capacity };
  }

  async withdraw(user: AuthUser, schoolId: string, id: string, studentId: string) {
    const club = await this.club(schoolId, id);
    this.assertMayManage(user, club);
    const promoted = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.activityEnrolment.updateMany({
        where: { activityId: id, studentId, status: { in: [EnrolmentStatus.ENROLLED, EnrolmentStatus.WAITLISTED] } },
        data: { status: EnrolmentStatus.WITHDRAWN },
      });
      if (!count) throw new NotFoundException('That student isn’t in this club.');
      return this.promoteNext(tx, id, club.capacity);
    });
    await this.audit.log(user, 'activity.withdraw', 'activity', id, { studentId });
    await this.tellPromoted(schoolId, club, promoted);
    return { ok: true, promoted: promoted.length };
  }

  async setPaid(user: AuthUser, schoolId: string, id: string, studentId: string, paid: boolean) {
    const club = await this.club(schoolId, id);
    if (club.fee == null) throw new BadRequestException('This club has no fee.');
    const { count } = await this.prisma.activityEnrolment.updateMany({ where: { activityId: id, studentId, status: EnrolmentStatus.ENROLLED }, data: { paidAt: paid ? new Date() : null } });
    if (!count) throw new BadRequestException('Only enrolled students can be marked as paid.');
    await this.audit.log(user, 'activity.paid', 'activity', id, { studentId, paid });
    return { ok: true };
  }

  async attendance(user: AuthUser, schoolId: string, id: string, date: string) {
    if (!DATE_RE.test(date ?? '')) throw new BadRequestException('Dates must look like 2026-09-30.');
    const club = await this.club(schoolId, id);
    this.assertMayManage(user, club);
    const [students, saved] = await Promise.all([
      this.prisma.activityEnrolment.findMany({
        where: { activityId: id, status: EnrolmentStatus.ENROLLED }, orderBy: { joinedAt: 'asc' },
        select: { studentId: true, student: { select: { firstName: true, lastName: true, nameAr: true, class: { select: { name: true } } } } },
      }),
      this.prisma.activityAttendance.findMany({ where: { activityId: id, date: dbDate(date) } }),
    ]);
    const marks = new Map(saved.map((m) => [m.studentId, m.present]));
    return {
      date, meets: club.days.includes(weekday(date)),
      students: students.map((e) => ({ studentId: e.studentId, name: `${e.student.firstName} ${e.student.lastName}`, nameAr: e.student.nameAr, class: e.student.class?.name ?? null, present: marks.get(e.studentId) ?? null })),
    };
  }

  async markAttendance(user: AuthUser, schoolId: string, id: string, dto: ClubAttendanceDto, now = new Date()) {
    if (!DATE_RE.test(dto.date)) throw new BadRequestException('Dates must look like 2026-09-30.');
    const club = await this.club(schoolId, id);
    this.assertMayManage(user, club);
    const school = await this.school(schoolId);
    if (!club.days.includes(weekday(dto.date))) throw new BadRequestException('The club doesn’t meet that day.');
    if (!(await this.calendar.isOpen(school, dto.date))) throw new BadRequestException('The school is closed that day.');
    if (dto.date > localParts(now, school.timezone).date) throw new BadRequestException('Attendance can’t be taken for a day that hasn’t come.');
    const enrolled = new Set((await this.prisma.activityEnrolment.findMany({ where: { activityId: id, status: EnrolmentStatus.ENROLLED }, select: { studentId: true } })).map((e) => e.studentId));
    const ids = Object.keys(dto.present);
    if (ids.some((s) => !enrolled.has(s) || typeof dto.present[s] !== 'boolean')) throw new BadRequestException('Some of those students aren’t enrolled in this club.');
    await this.prisma.$transaction(
      ids.map((studentId) =>
        this.prisma.activityAttendance.upsert({
          where: { activityId_studentId_date: { activityId: id, studentId, date: dbDate(dto.date) } },
          create: { activityId: id, studentId, date: dbDate(dto.date), present: dto.present[studentId], markedById: user.id },
          update: { present: dto.present[studentId], markedById: user.id, markedAt: new Date() },
        }),
      ),
    );
    await this.audit.log(user, 'activity.attendance', 'activity', id, { date: dto.date, marked: ids.length });
    return { ok: true, marked: ids.length };
  }

  // ---- parent ----------------------------------------------------------------

  /** The clubs a child may join this year, with places left and where the child stands in each. */
  async forChild(user: AuthUser, childId: string, now = new Date()) {
    const child = await ownChild(this.prisma, user.id, childId);
    const school = await this.school(child.schoolId);
    const yearId = await this.currentYearId(child.schoolId, school.timezone, now);
    if (!yearId) return [];
    const gradeId = child.classId ? (await this.prisma.class.findUnique({ where: { id: child.classId }, select: { gradeId: true } }))?.gradeId : undefined;
    const paid = await this.paidOn(child.schoolId);
    const clubs = await this.prisma.activity.findMany({
      where: { schoolId: child.schoolId, yearId, archivedAt: null, OR: [{ gradeIds: { isEmpty: true } }, ...(gradeId ? [{ gradeIds: { has: gradeId } }] : [])] },
      include: {
        supervisor: { select: supervisorSelect },
        room: { select: { id: true, name: true } },
        enrolments: { where: { status: { in: [EnrolmentStatus.ENROLLED, EnrolmentStatus.WAITLISTED] } }, select: { studentId: true, status: true, joinedAt: true, paidAt: true } },
      },
      orderBy: { name: 'asc' },
    });
    return clubs.map((c) => {
      const enrolled = c.enrolments.filter((e) => e.status === 'ENROLLED');
      const mine = c.enrolments.find((e) => e.studentId === childId);
      const waiting = c.enrolments.filter((e) => e.status === 'WAITLISTED').sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
      return {
        id: c.id, name: c.name, nameAr: c.nameAr, description: c.description, days: c.days, startTime: c.startTime, endTime: c.endTime,
        supervisor: c.supervisor, room: c.room?.name ?? null, capacity: c.capacity, places: Math.max(0, c.capacity - enrolled.length), signupOpen: c.signupOpen,
        fee: paid ? c.fee : null, paid: paid && !!mine?.paidAt,
        status: mine?.status ?? null, waitlistPosition: mine?.status === 'WAITLISTED' ? waiting.findIndex((w) => w.studentId === childId) + 1 : null,
      };
    });
  }

  async join(user: AuthUser, childId: string, activityId: string, now = new Date()) {
    const child = await ownChild(this.prisma, user.id, childId);
    const school = await this.school(child.schoolId);
    const club = await this.prisma.activity.findFirst({ where: { id: activityId, schoolId: child.schoolId, archivedAt: null } });
    if (!club) throw new NotFoundException('Club not found.');
    if (!club.signupOpen) throw new BadRequestException('Sign-up for this club is closed.');
    if (club.yearId !== (await this.currentYearId(child.schoolId, school.timezone, now))) throw new BadRequestException('Sign-up for this club is closed.');
    const gradeId = child.classId ? (await this.prisma.class.findUnique({ where: { id: child.classId }, select: { gradeId: true } }))?.gradeId : undefined;
    if (club.gradeIds.length && (!gradeId || !club.gradeIds.includes(gradeId))) throw new BadRequestException(`This club isn’t open to ${child.firstName}’s year group.`);

    const result = await this.prisma.$transaction(async (tx) => {
      // One at a time for this club, so two parents racing for the last place can't both get it.
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${club.id} FOR UPDATE`;
      const existing = await tx.activityEnrolment.findUnique({ where: { activityId_studentId: { activityId, studentId: childId } } });
      if (existing && existing.status !== EnrolmentStatus.WITHDRAWN) throw new BadRequestException(`${child.firstName} is already on the list.`);
      const enrolled = await tx.activityEnrolment.count({ where: { activityId, status: EnrolmentStatus.ENROLLED } });
      const status = enrolled < club.capacity ? EnrolmentStatus.ENROLLED : EnrolmentStatus.WAITLISTED;
      const joinedAt = new Date();
      await tx.activityEnrolment.upsert({
        where: { activityId_studentId: { activityId, studentId: childId } },
        create: { activityId, studentId: childId, status, joinedAt, byUserId: user.id },
        update: { status, joinedAt, byUserId: user.id, paidAt: null },
      });
      const position = status === EnrolmentStatus.WAITLISTED ? await tx.activityEnrolment.count({ where: { activityId, status: EnrolmentStatus.WAITLISTED, joinedAt: { lte: joinedAt } } }) : undefined;
      return { status, waitlistPosition: position };
    });

    const others = await this.prisma.activity.findMany({
      where: { schoolId: child.schoolId, yearId: club.yearId, archivedAt: null, id: { not: club.id }, enrolments: { some: { studentId: childId, status: EnrolmentStatus.ENROLLED } } },
      select: { name: true, nameAr: true, days: true, startTime: true, endTime: true },
    });
    const clash = others.find((o) => clashes(o, club));
    await this.audit.log(user, 'activity.join', 'activity', activityId, { studentId: childId, status: result.status });
    return { ...result, ...(clash ? { clash: { name: clash.name, nameAr: clash.nameAr } } : {}) };
  }

  async leave(user: AuthUser, childId: string, activityId: string) {
    const child = await ownChild(this.prisma, user.id, childId);
    const club = await this.prisma.activity.findFirst({ where: { id: activityId, schoolId: child.schoolId } });
    if (!club) throw new NotFoundException('Club not found.');
    const promoted = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${club.id} FOR UPDATE`;
      const { count } = await tx.activityEnrolment.updateMany({
        where: { activityId, studentId: childId, status: { in: [EnrolmentStatus.ENROLLED, EnrolmentStatus.WAITLISTED] } },
        data: { status: EnrolmentStatus.WITHDRAWN },
      });
      if (!count) throw new BadRequestException(`${child.firstName} isn’t in this club.`);
      return this.promoteNext(tx, activityId, club.capacity);
    });
    await this.audit.log(user, 'activity.leave', 'activity', activityId, { studentId: childId });
    await this.tellPromoted(child.schoolId, club, promoted);
    return { ok: true };
  }
}

@RequiresModule('activities')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query('yearId') yearId?: string) {
    return this.activities.list(user, schoolId, yearId);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: ActivityDto) {
    return this.activities.create(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateActivityDto) {
    return this.activities.update(user, schoolId, id, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.activities.archive(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Get(':id/roster')
  roster(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.activities.roster(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/enrol')
  enrol(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: EnrolDto) {
    return this.activities.enrol(user, schoolId, id, dto);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post(':id/students/:studentId/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('studentId') studentId: string) {
    return this.activities.withdraw(user, schoolId, id, studentId);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @RequiresFeature('activities', 'paidActivities')
  @Post(':id/students/:studentId/paid')
  paid(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('studentId') studentId: string, @Body() dto: PaidDto) {
    return this.activities.setPaid(user, schoolId, id, studentId, dto.paid);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Get(':id/attendance')
  attendance(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Query('date') date: string) {
    return this.activities.attendance(user, schoolId, id, date);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Put(':id/attendance')
  markAttendance(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: ClubAttendanceDto) {
    return this.activities.markAttendance(user, schoolId, id, dto);
  }
}

@RequiresModule('activities')
@Roles(Role.PARENT)
@Controller('parent/children')
export class ParentActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get(':id/activities')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.activities.forChild(user, id);
  }

  @Post(':id/activities/:activityId/join')
  join(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('activityId') activityId: string) {
    return this.activities.join(user, id, activityId);
  }

  @Post(':id/activities/:activityId/leave')
  leave(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('activityId') activityId: string) {
    return this.activities.leave(user, id, activityId);
  }
}
