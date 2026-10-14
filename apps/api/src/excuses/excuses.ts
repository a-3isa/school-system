import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttendanceStatus, AbsenceAnswer, ExceptionStatus, ExceptionType, ExcuseReason, ExcuseStatus, Prisma, Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId, SCHOOL_WIDE } from '../auth/auth.decorators';
import { DATE_RE, dbDate, isoDate } from '../common/dates';
import { localParts } from '../common/time';
import { NotificationsService } from '../notifications/notifications';
import { sniff } from '../students/files';

/** A parent can send an excuse for an absence up to this many days afterwards. */
export const EXCUSE_WINDOW_DAYS = 7;
/** ...or ahead of time, for a planned absence, up to this many days. */
export const EXCUSE_AHEAD_DAYS = 30;
/** One excuse covers at most this many days. */
export const EXCUSE_MAX_DAYS = 30;
/** A parent who hasn't answered "do you know your child isn't at school?" for this long sets off the alert. */
export const ALERT_AFTER_MINUTES = 15;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DAY_MS = 86400_000;
const shift = (date: string, days: number) => isoDate(new Date(dbDate(date).getTime() + days * DAY_MS));

export class SubmitExcuseDto {
  @Matches(DATE_RE, { message: 'fromDate must look like 2026-09-30' }) fromDate: string;
  @Matches(DATE_RE, { message: 'toDate must look like 2026-09-30' }) toDate: string;
  @IsEnum(ExcuseReason) reason: ExcuseReason;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class AbsenceCheckDto {
  @Matches(DATE_RE, { message: 'date must look like 2026-09-30' }) date: string;
  @IsBoolean() knows: boolean;
}

export class DecisionDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

const excuseView = {
  id: true, studentId: true, fromDate: true, toDate: true, reason: true, note: true, fileMime: true, fileSize: true,
  status: true, decidedAt: true, decisionNote: true, createdAt: true,
} satisfies Prisma.ExcuseSelect;

type ExcuseRow = Prisma.ExcuseGetPayload<{ select: typeof excuseView }>;
const present = ({ fileMime, fileSize, ...e }: ExcuseRow) => ({ ...e, hasFile: !!fileMime, fileMime, fileSize });

@Injectable()
export class ExcusesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async school(schoolId: string) {
    return this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  }

  /** Guardians who may be told things about the child (a restricted parent isn't). */
  private guardians(studentId: string) {
    return this.prisma.studentGuardian.findMany({ where: { studentId, restricted: false }, include: { user: { select: { id: true, name: true, phone: true } } } });
  }

  private admins(schoolId: string) {
    return this.prisma.user.findMany({ where: { schoolId, role: Role.SCHOOL_ADMIN, active: true }, select: { id: true } });
  }

  /** The child, if this parent may act for them. */
  private async ownChild(parentId: string, studentId: string) {
    const link = await this.prisma.studentGuardian.findUnique({
      where: { studentId_userId: { studentId, userId: parentId } },
      include: { student: { include: { class: { select: { name: true } } } } },
    });
    if (!link || link.restricted) throw new NotFoundException('Child not found.');
    return link.student;
  }

  // ---- parent --------------------------------------------------------------

  async submit(user: AuthUser, studentId: string, dto: SubmitExcuseDto, file: Express.Multer.File | undefined, now = new Date()) {
    const student = await this.ownChild(user.id, studentId);
    const school = await this.school(student.schoolId);
    const today = localParts(now, school.timezone).date;
    if (dto.toDate < dto.fromDate) throw new BadRequestException('The last day can’t be before the first day.');
    if (dto.fromDate < shift(today, -EXCUSE_WINDOW_DAYS)) {
      throw new BadRequestException(`An excuse can be sent up to ${EXCUSE_WINDOW_DAYS} days after the absence. For an older one, please contact the school.`);
    }
    if (dto.toDate > shift(today, EXCUSE_AHEAD_DAYS)) throw new BadRequestException(`An excuse can be sent up to ${EXCUSE_AHEAD_DAYS} days ahead.`);
    if ((dbDate(dto.toDate).getTime() - dbDate(dto.fromDate).getTime()) / DAY_MS + 1 > EXCUSE_MAX_DAYS) {
      throw new BadRequestException(`One excuse can cover at most ${EXCUSE_MAX_DAYS} days.`);
    }
    let mime: string | null = null;
    if (file) {
      mime = sniff(file.buffer);
      if (!mime) throw new BadRequestException('Attach a photo (JPG, PNG or WebP) or a PDF.');
    }
    const clash = await this.prisma.excuse.findFirst({
      where: { studentId, status: { in: [ExcuseStatus.PENDING, ExcuseStatus.APPROVED] }, fromDate: { lte: dbDate(dto.toDate) }, toDate: { gte: dbDate(dto.fromDate) } },
      select: { status: true },
    });
    if (clash) {
      throw new BadRequestException(clash.status === ExcuseStatus.PENDING ? 'You already sent an excuse for some of these days. The school hasn’t answered yet.' : 'Some of these days are already excused.');
    }

    const excuse = await this.prisma.excuse.create({
      data: {
        schoolId: student.schoolId, studentId, submittedById: user.id, fromDate: dbDate(dto.fromDate), toDate: dbDate(dto.toDate), reason: dto.reason, note: dto.note?.trim() || null,
        ...(file ? { fileMime: mime, fileSize: file.size, fileData: new Uint8Array(file.buffer) } : {}),
      },
      select: excuseView,
    });
    await this.audit.log({ ...user, schoolId: student.schoolId }, 'excuse.submit', 'student', studentId, { excuseId: excuse.id, from: dto.fromDate, to: dto.toDate, reason: dto.reason });
    await this.parentKnows(student.schoolId, studentId, dto.fromDate, dto.toDate, user.id, now);

    const parent = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });
    const days = dto.fromDate === dto.toDate ? dto.fromDate : `${dto.fromDate} to ${dto.toDate}`;
    await this.notifications.notify(
      (await this.admins(student.schoolId)).map((a) => ({
        schoolId: student.schoolId, userId: a.id, type: 'excuse.submitted',
        title: `${parent.name} sent an excuse for ${student.firstName} ${student.lastName}`,
        body: `${student.firstName} ${student.lastName}${student.class ? ` (${student.class.name})` : ''}: ${dto.reason.toLowerCase()}, ${days}.${dto.note ? ` “${dto.note.trim()}”` : ''}`,
        data: { excuseId: excuse.id, studentId },
      })),
    );
    return present(excuse);
  }

  async listForParent(user: AuthUser, studentId: string) {
    await this.ownChild(user.id, studentId);
    return (await this.prisma.excuse.findMany({ where: { studentId }, select: excuseView, orderBy: { createdAt: 'desc' }, take: 100 })).map(present);
  }

  /** "Do you know your child isn't at school?" Yes: the parent will send an excuse. No: the school is told to find the child. */
  async answerCheck(user: AuthUser, studentId: string, dto: AbsenceCheckDto, now = new Date()) {
    const student = await this.ownChild(user.id, studentId);
    const notice = await this.prisma.absenceNotice.findUnique({ where: { studentId_date: { studentId, date: dbDate(dto.date) } } });
    if (!notice) throw new NotFoundException('There is nothing to answer for that day.');
    if (notice.answer) return { answer: notice.answer, alerted: !!notice.alertedAt };
    const answer = dto.knows ? AbsenceAnswer.KNOWS : AbsenceAnswer.DOESNT_KNOW;
    const { count } = await this.prisma.absenceNotice.updateMany({ where: { studentId, date: notice.date, answer: null }, data: { answer, answeredAt: now, answeredById: user.id } });
    if (count && !dto.knows) await this.raiseAlert(studentId, dto.date, 'said they don’t know where the child is', now);
    return { answer, alerted: !dto.knows || !!notice.alertedAt };
  }

  /** The parent sent an excuse: they know. Stops the clock, and tells staff who are already looking. */
  private async parentKnows(schoolId: string, studentId: string, from: string, to: string, parentId: string, now: Date) {
    const notices = await this.prisma.absenceNotice.findMany({ where: { studentId, date: { gte: dbDate(from), lte: dbDate(to) }, answer: null } });
    for (const n of notices) {
      await this.prisma.absenceNotice.update({ where: { studentId_date: { studentId, date: n.date } }, data: { answer: AbsenceAnswer.KNOWS, answeredAt: now, answeredById: parentId } });
    }
    await this.noteOnAlerts(schoolId, studentId, from, to);
  }

  private async noteOnAlerts(schoolId: string, studentId: string, from: string, to: string) {
    const open = await this.prisma.attendanceException.findMany({
      where: { schoolId, studentId, type: ExceptionType.ABSENT_UNKNOWN, status: ExceptionStatus.OPEN, date: { gte: dbDate(from), lte: dbDate(to) } },
    });
    for (const e of open) {
      if (!e.message.includes('A parent has since replied')) {
        await this.prisma.attendanceException.update({ where: { id: e.id }, data: { message: `${e.message} A parent has since replied that they know about it.` } });
      }
    }
  }

  // ---- the school ----------------------------------------------------------

  list(schoolId: string, status?: ExcuseStatus) {
    return this.prisma.excuse
      .findMany({
        where: { schoolId, status },
        select: {
          ...excuseView,
          student: { select: { id: true, firstName: true, lastName: true, class: { select: { name: true } } } },
          submittedBy: { select: { name: true, phone: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 300,
      })
      .then((rows) => rows.map(({ student, submittedBy, ...e }) => ({ ...present(e), student, submittedBy })));
  }

  async file(schoolId: string, id: string) {
    const e = await this.prisma.excuse.findFirst({ where: { id, schoolId }, select: { fileMime: true, fileData: true } });
    if (!e?.fileData || !e.fileMime) throw new NotFoundException('This excuse has no attachment.');
    return { mime: e.fileMime, data: Buffer.from(e.fileData) };
  }

  async decide(user: AuthUser, schoolId: string, id: string, dto: DecisionDto, now = new Date()) {
    const note = dto.note?.trim() || null;
    if (!dto.approve && !note) throw new BadRequestException('Say why the excuse is rejected: the parent will read it.');
    const excuse = await this.prisma.excuse.findFirst({ where: { id, schoolId }, include: { student: { include: { class: { select: { name: true } } } } } });
    if (!excuse) throw new NotFoundException('Excuse not found.');
    const { count } = await this.prisma.excuse.updateMany({
      where: { id, status: ExcuseStatus.PENDING },
      data: { status: dto.approve ? ExcuseStatus.APPROVED : ExcuseStatus.REJECTED, decidedById: user.id, decidedAt: now, decisionNote: note },
    });
    if (!count) throw new BadRequestException('This excuse has already been decided.');
    if (dto.approve) await this.applyApproved(schoolId, { excuseId: id });
    await this.audit.log(user, dto.approve ? 'excuse.approve' : 'excuse.reject', 'student', excuse.studentId, { excuseId: id, note });

    const s = excuse.student;
    const days = isoDate(excuse.fromDate) === isoDate(excuse.toDate) ? isoDate(excuse.fromDate) : `${isoDate(excuse.fromDate)} to ${isoDate(excuse.toDate)}`;
    await this.notifications.notify(
      (await this.guardians(excuse.studentId)).map((g) => ({
        schoolId, userId: g.userId, type: dto.approve ? 'excuse.approved' : 'excuse.rejected',
        title: dto.approve ? `${s.firstName}’s excuse was accepted` : `${s.firstName}’s excuse was not accepted`,
        body: dto.approve ? `The school accepted the excuse for ${days}.${note ? ` ${note}` : ''}` : `The school did not accept the excuse for ${days}. ${note}`,
        data: { excuseId: id, studentId: excuse.studentId, from: isoDate(excuse.fromDate), to: isoDate(excuse.toDate) },
      })),
    );
    return this.prisma.excuse.findUniqueOrThrow({ where: { id }, select: excuseView }).then(present);
  }

  /**
   * An approved excuse turns the child's absent lessons on those days into
   * excused ones. Runs when an excuse is approved, after lessons are marked, and
   * every minute for the days around today, so an absence recorded later is
   * excused too.
   */
  async applyApproved(schoolId?: string, only: { excuseId?: string; studentIds?: string[]; date?: string } = {}) {
    const excuses = await this.prisma.excuse.findMany({
      where: {
        status: ExcuseStatus.APPROVED,
        ...(schoolId ? { schoolId } : {}),
        ...(only.excuseId ? { id: only.excuseId } : { toDate: { gte: new Date(Date.now() - 3 * DAY_MS) } }),
        ...(only.studentIds ? { studentId: { in: only.studentIds } } : {}),
        ...(only.date ? { fromDate: { lte: dbDate(only.date) }, toDate: { gte: dbDate(only.date) } } : {}),
      },
      select: { id: true, studentId: true, fromDate: true, toDate: true },
    });
    let changed = 0;
    for (const e of excuses) {
      const { count } = await this.prisma.attendanceRecord.updateMany({
        where: { studentId: e.studentId, date: { gte: e.fromDate, lte: e.toDate }, status: AttendanceStatus.ABSENT },
        data: { status: AttendanceStatus.EXCUSED, excuseId: e.id },
      });
      changed += count;
    }
    return changed;
  }

  // ---- the student's absences (for the profile) ---------------------------------

  /** Each day the student was absent, and whether an excuse covers it. */
  async absences(schoolId: string, studentId: string, from?: string, to?: string) {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true } });
    if (!student) throw new NotFoundException('Student not found.');
    const school = await this.school(schoolId);
    const today = localParts(new Date(), school.timezone).date;
    const lo = from ?? shift(today, -180);
    const hi = to ?? today;
    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, date: { gte: dbDate(lo), lte: dbDate(hi) }, status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.EXCUSED] } },
      include: { period: { select: { number: true } } },
      orderBy: [{ date: 'desc' }],
    });
    const excuses = await this.prisma.excuse.findMany({
      where: { studentId, fromDate: { lte: dbDate(shift(today, EXCUSE_AHEAD_DAYS)) }, toDate: { gte: dbDate(lo) } },
      select: { ...excuseView, submittedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const timetable = await this.prisma.timetableEntry.findMany({ where: { class: { students: { some: { id: studentId } } } }, select: { dayOfWeek: true, periodId: true, subject: { select: { name: true } } } });
    const subject = new Map(timetable.map((t) => [`${t.dayOfWeek}:${t.periodId}`, t.subject.name]));

    const byDate = new Map<string, typeof records>();
    for (const r of records) byDate.set(isoDate(r.date), [...(byDate.get(isoDate(r.date)) ?? []), r]);
    const days = [...byDate.entries()].map(([date, rows]) => {
      const absent = rows.filter((r) => r.status === AttendanceStatus.ABSENT);
      const covering = excuses.filter((e) => isoDate(e.fromDate) <= date && date <= isoDate(e.toDate));
      const linked = rows.find((r) => r.excuseId)?.excuseId;
      const excuse = (linked && covering.find((e) => e.id === linked)) || covering[0] || null;
      // The day's state: excused, or what became of the excuse, or none sent.
      const status = absent.length === 0 ? 'EXCUSED' : !excuse ? 'NO_EXCUSE' : excuse.status === ExcuseStatus.REJECTED ? 'REJECTED' : excuse.status === ExcuseStatus.PENDING ? 'PENDING' : 'NO_EXCUSE';
      const dow = dbDate(date).getUTCDay();
      return {
        date, status, absentLessons: absent.length, excusedLessons: rows.length - absent.length,
        lessons: rows.map((r) => ({ period: r.period.number, subject: subject.get(`${dow}:${r.periodId}`) ?? null, status: r.status })).sort((a, b) => a.period - b.period),
        excuse: excuse ? { ...present(excuse), submittedBy: excuse.submittedBy.name } : null,
      };
    });
    const count = (s: string) => days.filter((d) => d.status === s).length;
    return {
      from: lo, to: hi, days,
      totals: { days: days.length, excused: count('EXCUSED'), pending: count('PENDING'), rejected: count('REJECTED'), noExcuse: count('NO_EXCUSE') },
      // Excuses sent for days with no recorded absence yet (a planned absence).
      upcoming: excuses.filter((e) => isoDate(e.toDate) >= today && e.status !== ExcuseStatus.REJECTED).map((e) => ({ ...present(e), submittedBy: e.submittedBy.name })),
    };
  }

  // ---- the "didn't come" alert -----------------------------------------------

  /** Tells the dashboard to find the child: an urgent follow-up, and a message to every admin. Once per child per day. */
  async raiseAlert(studentId: string, date: string, why: string, now = new Date()) {
    const locked = await this.prisma.absenceNotice.updateMany({ where: { studentId, date: dbDate(date), alertedAt: null }, data: { alertedAt: now } });
    if (!locked.count) return false;
    await this.alertFor([{ studentId, date: dbDate(date) }], why);
    return true;
  }

  /** For notices just locked (alertedAt set): a follow-up for Student Affairs, and an urgent message to each admin. */
  private async alertFor(locked: { studentId: string; date: Date }[], why: string) {
    if (!locked.length) return;
    const students = await this.prisma.student.findMany({
      where: { id: { in: [...new Set(locked.map((l) => l.studentId))] } },
      include: { class: { select: { name: true } }, guardians: { include: { user: { select: { name: true, phone: true } } } } },
    });
    const byId = new Map(students.map((s) => [s.id, s]));
    const admins = await this.prisma.user.findMany({
      where: { schoolId: { in: [...new Set(students.map((s) => s.schoolId))] }, role: Role.SCHOOL_ADMIN, active: true },
      select: { id: true, schoolId: true },
    });
    const exceptions: Prisma.AttendanceExceptionCreateManyInput[] = [];
    const messages: Parameters<NotificationsService['notify']>[0] = [];
    for (const l of locked) {
      const student = byId.get(l.studentId);
      if (!student) continue;
      const date = isoDate(l.date);
      const { schoolId, id: studentId } = student;
      const calls = student.guardians.map((g) => `${g.user.name}${g.user.phone ? ` ${g.user.phone}` : ''}`).join(', ');
      const full = `${student.firstName} ${student.lastName}`;
      const message = `${full}${student.class ? ` (${student.class.name})` : ''} didn’t come to school and the parents ${why}. Call the parents to find out where ${student.firstName} is: ${calls || 'no number on file'}.`;
      exceptions.push({ schoolId, type: ExceptionType.ABSENT_UNKNOWN, date: l.date, studentId, message, dedupeKey: `absent-unknown:${studentId}:${date}` });
      for (const a of admins) {
        if (a.schoolId !== schoolId) continue;
        messages.push({
          schoolId, userId: a.id, type: 'attendance.urgentAbsence', title: `URGENT: ${full} isn’t at school and the parents don’t know where`,
          body: message, data: { studentId, date },
        });
      }
    }
    await this.prisma.attendanceException.createMany({ data: exceptions, skipDuplicates: true });
    await this.notifications.notify(messages);
  }

  /** Every minute: sets off the alert for a question left unanswered too long, and closes alerts for children who turned up. */
  async checkAlerts(now = new Date()) {
    // Locking every due notice in one statement means each alert still goes once.
    const due = await this.prisma.$queryRaw<{ studentId: string; date: Date }[]>`
      UPDATE "AbsenceNotice" SET "alertedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
      WHERE "answer" IS NULL AND "alertedAt" IS NULL AND "sentAt" <= (${new Date(now.getTime() - ALERT_AFTER_MINUTES * 60_000)}::timestamptz AT TIME ZONE 'UTC')
      RETURNING "studentId", "date"`;
    await this.alertFor(due, `didn’t answer within ${ALERT_AFTER_MINUTES} minutes`);

    const open = await this.prisma.attendanceException.findMany({ where: { type: ExceptionType.ABSENT_UNKNOWN, status: ExceptionStatus.OPEN, studentId: { not: null } } });
    const byDay = new Map<string, string[]>();
    for (const e of open) {
      const ids = byDay.get(isoDate(e.date));
      if (ids) ids.push(e.studentId!);
      else byDay.set(isoDate(e.date), [e.studentId!]);
    }
    const seenOn = new Map<string, Date>();
    for (const [day, ids] of byDay) {
      const [present, gate] = await Promise.all([
        this.prisma.attendanceRecord.findMany({
          where: { studentId: { in: ids }, date: dbDate(day), status: { in: [AttendanceStatus.PRESENT, AttendanceStatus.LATE] } },
          select: { studentId: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.gatePresence.findMany({ where: { studentId: { in: ids }, date: dbDate(day), arrivedAt: { not: null } }, select: { studentId: true, arrivedAt: true } }),
      ]);
      for (const p of present) seenOn.set(`${p.studentId}|${day}`, p.updatedAt); // newest first, so the earliest is set last
      for (const g of gate) seenOn.set(`${g.studentId}|${day}`, g.arrivedAt!);
    }
    const turnedUp = open.flatMap((e) => {
      const seen = seenOn.get(`${e.studentId}|${isoDate(e.date)}`);
      return seen ? [{ e, seen }] : [];
    });
    if (turnedUp.length) {
      const [schools, students] = await Promise.all([
        this.prisma.school.findMany({ where: { id: { in: [...new Set(turnedUp.map((t) => t.e.schoolId))] } }, select: { id: true, timezone: true } }),
        this.prisma.student.findMany({
          where: { id: { in: [...new Set(turnedUp.map((t) => t.e.studentId!))] } },
          select: { id: true, firstName: true, guardians: { where: { restricted: false }, select: { userId: true } } },
        }),
      ]);
      const zone = new Map(schools.map((s) => [s.id, s.timezone]));
      const byId = new Map(students.map((s) => [s.id, s]));
      const closed = turnedUp.map(({ e, seen }) => ({ e, time: localParts(seen, zone.get(e.schoolId)!).time }));
      await this.prisma.$executeRaw`
        UPDATE "AttendanceException" AS x SET "status" = 'RESOLVED', "resolvedAt" = (${now}::timestamptz AT TIME ZONE 'UTC'), "note" = v.note
        FROM (VALUES ${Prisma.join(closed.map(({ e, time }) => Prisma.sql`(${e.id}, ${`Closed automatically: the student arrived at school at ${time}.`})`))}) AS v(id, note)
        WHERE x.id = v.id`;
      await this.notifications.notify(
        closed.flatMap(({ e, time }) => {
          const student = byId.get(e.studentId!);
          return (student?.guardians ?? []).map((g) => ({
            schoolId: e.schoolId, userId: g.userId, type: 'attendance.arrived', title: `${student!.firstName} has arrived at school`,
            body: `${student!.firstName} arrived at school at ${time}.`, data: { studentId: e.studentId!, date: isoDate(e.date), time },
          }));
        }),
      );
    }
    return { asked: due.length, open: open.length };
  }
}

@RequiresModule('attendance')
@Roles(Role.PARENT)
@Controller('parent/children')
export class ParentExcusesController {
  constructor(private readonly excuses: ExcusesService) {}

  @Get(':id/excuses')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.excuses.listForParent(user, id);
  }

  @Post(':id/excuses')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubmitExcuseDto, @UploadedFile() file?: Express.Multer.File) {
    return this.excuses.submit(user, id, dto, file);
  }

  @Post(':id/absence-check')
  answer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AbsenceCheckDto) {
    return this.excuses.answerCheck(user, id, dto);
  }
}

@RequiresModule('attendance')
@Roles(Role.SCHOOL_ADMIN)
@Controller('excuses')
export class StaffExcusesController {
  constructor(private readonly excuses: ExcusesService) {}

  @Get()
  list(@SchoolId() schoolId: string, @Query('status') status?: ExcuseStatus) {
    if (status && !(status in ExcuseStatus)) throw new BadRequestException('Unknown status.');
    return this.excuses.list(schoolId, status);
  }

  @Get(':id/file')
  async file(@SchoolId() schoolId: string, @Param('id') id: string, @Res() res: Response) {
    const f = await this.excuses.file(schoolId, id);
    res.setHeader('content-type', f.mime);
    res.setHeader('content-disposition', 'inline');
    res.send(f.data);
  }

  @Post(':id/decision')
  decide(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.excuses.decide(user, schoolId, id, dto);
  }
}

@RequiresModule('attendance')
@Roles(...SCHOOL_WIDE)
@Controller('students')
export class StudentAbsencesController {
  constructor(private readonly excuses: ExcusesService) {}

  @Get(':id/absences')
  absences(@SchoolId() schoolId: string, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    if (from) dbDate(from);
    if (to) dbDate(to);
    return this.excuses.absences(schoolId, id, from, to);
  }
}

@Module({
  controllers: [ParentExcusesController, StaffExcusesController, StudentAbsencesController],
  providers: [ExcusesService],
  exports: [ExcusesService],
})
export class ExcusesModule {}
