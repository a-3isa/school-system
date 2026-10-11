import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresFeature, RequiresModule, Roles, SchoolId } from '../auth/auth.decorators';
import { DATE_RE, dbDate } from '../common/dates';
import { localParts, zonedTime } from '../common/time';
import { TIME_RE, toMinutes } from '../common/validation';
import { NotificationsService } from '../notifications/notifications';
import { SchoolCalendar } from '../setup/calendar';
import { childTeachers, ownChild, titled } from './shared';

/** A parent can cancel online until this long before the meeting. */
export const CANCEL_UNTIL_MINUTES = 120;

export class CreateWindowDto {
  @IsOptional() @IsString() teacherId?: string;
  @Matches(DATE_RE, { message: 'date must look like 2026-09-30' }) date: string;
  @Matches(TIME_RE, { message: 'fromTime must look like 14:30' }) fromTime: string;
  @Matches(TIME_RE, { message: 'toTime must look like 15:30' }) toTime: string;
  @IsInt() @Min(5) @Max(60) slotMinutes: number;
  @IsString() @MinLength(1) @MaxLength(120) place: string;
}

export class BookDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class RangeQuery {
  @IsOptional() @Matches(DATE_RE) from?: string;
  @IsOptional() @Matches(DATE_RE) to?: string;
  @IsOptional() @IsString() teacherId?: string;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The meeting slots a window is cut into: back to back, with no part-slot left over at the end. */
export function slotsFor(date: string, from: string, to: string, minutes: number, timeZone: string): { startsAt: Date; endsAt: Date }[] {
  const out: { startsAt: Date; endsAt: Date }[] = [];
  for (let t = toMinutes(from); t + minutes <= toMinutes(to); t += minutes) {
    out.push({ startsAt: zonedTime(date, hhmm(t), timeZone), endsAt: zonedTime(date, hhmm(t + minutes), timeZone) });
  }
  return out;
}

const slotInclude = {
  bookedBy: { select: { id: true, name: true } },
  student: { select: { id: true, firstName: true, lastName: true, class: { select: { name: true } } } },
} satisfies Prisma.MeetingSlotInclude;

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly calendar: SchoolCalendar,
  ) {}

  private school(schoolId: string) {
    return this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  }

  private when(at: Date, timeZone: string) {
    const p = localParts(at, timeZone);
    return { date: p.date, time: p.time };
  }

  // ---- staff ---------------------------------------------------------------

  async createWindow(user: AuthUser, schoolId: string, dto: CreateWindowDto, now = new Date()) {
    let teacherId = user.id;
    if (user.role === Role.SCHOOL_ADMIN) {
      if (!dto.teacherId) throw new BadRequestException('Choose the teacher.');
      teacherId = dto.teacherId;
    } else if (dto.teacherId && dto.teacherId !== user.id) {
      throw new ForbiddenException('You can add meeting times for yourself only.');
    }
    if (!(await this.prisma.user.findFirst({ where: { id: teacherId, schoolId, role: Role.TEACHER, active: true }, select: { id: true } }))) {
      throw new NotFoundException('Teacher not found.');
    }
    if (toMinutes(dto.toTime) <= toMinutes(dto.fromTime)) throw new BadRequestException('The end time must be after the start time.');
    if (toMinutes(dto.toTime) - toMinutes(dto.fromTime) < dto.slotMinutes) throw new BadRequestException('This time is too short for one meeting.');
    const school = await this.school(schoolId);
    if (dto.date < localParts(now, school.timezone).date) throw new BadRequestException('Choose a day that hasn’t passed.');
    if (!(await this.calendar.day(school, dto.date)).open) throw new BadRequestException('The school is closed that day.');
    const clash = await this.prisma.meetingWindow.findFirst({
      where: { schoolId, teacherId, date: dbDate(dto.date), fromTime: { lt: dto.toTime }, toTime: { gt: dto.fromTime } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('This overlaps another meeting time on the same day.');

    const slots = slotsFor(dto.date, dto.fromTime, dto.toTime, dto.slotMinutes, school.timezone);
    const window = await this.prisma.meetingWindow.create({
      data: {
        schoolId, teacherId, date: dbDate(dto.date), fromTime: dto.fromTime, toTime: dto.toTime, slotMinutes: dto.slotMinutes, place: dto.place.trim(),
        slots: { create: slots },
      },
      include: { slots: { orderBy: { startsAt: 'asc' } } },
    });
    await this.audit.log(user, 'meeting.window', 'user', teacherId, { windowId: window.id, date: dto.date, slots: slots.length });
    return window;
  }

  async list(user: AuthUser, schoolId: string, q: RangeQuery, now = new Date()) {
    const school = await this.school(schoolId);
    const today = localParts(now, school.timezone).date;
    return this.prisma.meetingWindow.findMany({
      where: {
        schoolId,
        date: { gte: dbDate(q.from ?? today), ...(q.to ? { lte: dbDate(q.to) } : {}) },
        ...(user.role === Role.TEACHER ? { teacherId: user.id } : q.teacherId ? { teacherId: q.teacherId } : {}),
      },
      include: { teacher: { select: { id: true, name: true, honorific: true } }, slots: { include: slotInclude, orderBy: { startsAt: 'asc' } } },
      orderBy: [{ date: 'asc' }, { fromTime: 'asc' }],
      take: 200,
    });
  }

  private async ownWindow(user: AuthUser, schoolId: string, id: string) {
    const w = await this.prisma.meetingWindow.findFirst({
      where: { id, schoolId }, include: { teacher: { select: { name: true, honorific: true } }, slots: { where: { bookedById: { not: null } } } },
    });
    if (!w) throw new NotFoundException('Meeting time not found.');
    if (user.role !== Role.SCHOOL_ADMIN && w.teacherId !== user.id) throw new NotFoundException('Meeting time not found.');
    return w;
  }

  private async tellCancelled(schoolId: string, slots: { id: string; bookedById: string | null; studentId: string | null; startsAt: Date }[], teacher: { name: string; honorific: string | null }) {
    const school = await this.school(schoolId);
    await this.notifications.notify(
      slots.filter((s) => s.bookedById).map((s) => {
        const w = this.when(s.startsAt, school.timezone);
        return {
          schoolId, userId: s.bookedById!, type: 'meeting.cancelled',
          title: `Your meeting with ${titled(teacher)} on ${w.date} at ${w.time} was cancelled`, body: 'You can choose another time in the app.',
          data: { slotId: s.id, teacher: titled(teacher), date: w.date, time: w.time, ...(s.studentId ? { studentId: s.studentId } : {}) },
        };
      }),
    );
  }

  async removeWindow(user: AuthUser, schoolId: string, id: string) {
    const w = await this.ownWindow(user, schoolId, id);
    await this.prisma.meetingWindow.deleteMany({ where: { id, schoolId } });
    await this.tellCancelled(schoolId, w.slots, w.teacher);
    await this.audit.log(user, 'meeting.window.delete', 'user', w.teacherId, { windowId: id, cancelled: w.slots.length });
    return { ok: true, cancelled: w.slots.length };
  }

  async cancelSlot(user: AuthUser, schoolId: string, slotId: string) {
    const slot = await this.prisma.meetingSlot.findFirst({ where: { id: slotId, window: { schoolId } }, include: { window: { include: { teacher: { select: { name: true, honorific: true } } } } } });
    if (!slot || (user.role !== Role.SCHOOL_ADMIN && slot.window.teacherId !== user.id)) throw new NotFoundException('Meeting time not found.');
    if (!slot.bookedById) throw new BadRequestException('This time isn’t booked.');
    await this.prisma.meetingSlot.update({ where: { id: slotId }, data: { bookedById: null, studentId: null, note: null, bookedAt: null } });
    await this.tellCancelled(schoolId, [slot], slot.window.teacher);
    await this.audit.log(user, 'meeting.cancel', 'user', slot.window.teacherId, { slotId });
    return { ok: true };
  }

  // ---- parent --------------------------------------------------------------

  async forParent(user: AuthUser, studentId: string, now = new Date()) {
    const child = await ownChild(this.prisma, user.id, studentId);
    const teachers = await childTeachers(this.prisma, child.schoolId, child.classId);
    const slots = await this.prisma.meetingSlot.findMany({
      where: { startsAt: { gt: now }, window: { schoolId: child.schoolId, teacherId: { in: teachers.map((t) => t.id) } }, OR: [{ bookedById: null }, { bookedById: user.id, studentId }] },
      include: { window: { select: { teacherId: true, place: true } } },
      orderBy: { startsAt: 'asc' },
    });
    const view = (s: (typeof slots)[number]) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, place: s.window.place });
    return {
      booked: slots.filter((s) => s.bookedById === user.id).map((s) => ({ ...view(s), teacher: teachers.find((t) => t.id === s.window.teacherId), note: s.note })),
      teachers: teachers.map((t) => ({ teacher: t, slots: slots.filter((s) => !s.bookedById && s.window.teacherId === t.id).map(view) })),
    };
  }

  async book(user: AuthUser, studentId: string, slotId: string, dto: BookDto, now = new Date()) {
    const child = await ownChild(this.prisma, user.id, studentId);
    const teachers = await childTeachers(this.prisma, child.schoolId, child.classId);
    const slot = await this.prisma.meetingSlot.findFirst({ where: { id: slotId, window: { schoolId: child.schoolId } }, include: { window: true } });
    const teacher = slot && teachers.find((t) => t.id === slot.window.teacherId);
    if (!slot || !teacher) throw new NotFoundException('Meeting time not found.');
    if (slot.startsAt.getTime() <= now.getTime()) throw new BadRequestException('That time has passed.');
    const again = await this.prisma.meetingSlot.findFirst({ where: { bookedById: user.id, window: { teacherId: teacher.id, date: slot.window.date } }, select: { id: true } });
    if (again) throw new BadRequestException('You already have a meeting with this teacher that day.');
    // Two parents tapping the same time at once: only one update finds it free.
    const { count } = await this.prisma.meetingSlot.updateMany({
      where: { id: slotId, bookedById: null },
      data: { bookedById: user.id, studentId, note: dto.note?.trim() || null, bookedAt: now },
    });
    if (!count) throw new ConflictException('Someone has just booked this time. Please choose another.');

    const school = await this.school(child.schoolId);
    const w = this.when(slot.startsAt, school.timezone);
    const parent = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });
    await this.notifications.notify([{
      schoolId: child.schoolId, userId: teacher.id, type: 'meeting.booked',
      title: `${parent.name} booked a meeting about ${child.firstName} ${child.lastName}`, body: `${w.date} at ${w.time}, ${slot.window.place}.${dto.note?.trim() ? ` “${dto.note.trim()}”` : ''}`,
      data: { slotId, studentId, startsAt: slot.startsAt.toISOString() },
    }]);
    await this.audit.log({ ...user, schoolId: child.schoolId }, 'meeting.book', 'student', studentId, { slotId });
    return { id: slotId, startsAt: slot.startsAt, endsAt: slot.endsAt, place: slot.window.place };
  }

  async cancelOwn(user: AuthUser, slotId: string, now = new Date()) {
    const slot = await this.prisma.meetingSlot.findFirst({ where: { id: slotId, bookedById: user.id }, include: { window: { include: { teacher: { select: { id: true, name: true, honorific: true } } } } } });
    if (!slot) throw new NotFoundException('Meeting time not found.');
    if (slot.startsAt.getTime() - now.getTime() < CANCEL_UNTIL_MINUTES * 60_000) {
      throw new BadRequestException('It’s too late to cancel online. Please call the school.');
    }
    await this.prisma.meetingSlot.updateMany({ where: { id: slotId, bookedById: user.id }, data: { bookedById: null, studentId: null, note: null, bookedAt: null } });
    const school = await this.school(slot.window.schoolId);
    const w = this.when(slot.startsAt, school.timezone);
    const parent = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });
    await this.notifications.notify([{
      schoolId: slot.window.schoolId, userId: slot.window.teacher.id, type: 'meeting.cancelled',
      title: `${parent.name} cancelled the meeting on ${w.date} at ${w.time}`, body: 'The time is free again.', data: { slotId },
    }]);
    return { ok: true };
  }
}

@RequiresModule('messaging')
@RequiresFeature('messaging', 'meetings')
@Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query() q: RangeQuery) {
    return this.meetings.list(user, schoolId, q);
  }

  @Post('windows')
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: CreateWindowDto) {
    return this.meetings.createWindow(user, schoolId, dto);
  }

  @Delete('windows/:id')
  remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.meetings.removeWindow(user, schoolId, id);
  }

  @Post('slots/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.meetings.cancelSlot(user, schoolId, id);
  }
}

@RequiresModule('messaging')
@RequiresFeature('messaging', 'meetings')
@Roles(Role.PARENT)
@Controller('parent')
export class ParentMeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get('children/:id/meetings')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetings.forParent(user, id);
  }

  @Post('children/:id/meetings/:slotId/book')
  book(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('slotId') slotId: string, @Body() dto: BookDto) {
    return this.meetings.book(user, id, slotId, dto);
  }

  @Post('meetings/:slotId/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('slotId') slotId: string) {
    return this.meetings.cancelOwn(user, slotId);
  }
}
