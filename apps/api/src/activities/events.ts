import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssessmentKind, EnrolmentStatus, Prisma, Role, TripStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { schoolHas } from '../auth/access.guard';
import { AuthUser, CurrentUser, RequiresFeature, RequiresModule, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { AudienceDto, AudienceService } from '../common/audience';
import { DATE_RE, dbDate, isoDate, weekday } from '../common/dates';
import { localParts } from '../common/time';
import { defined } from '../common/validation';
import { NotificationsService } from '../notifications/notifications';
import { SchoolCalendar } from '../setup/calendar';
import { sniff } from '../students/files';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTOS = 30;
/** The calendar can be asked for about three months at a time. */
const MAX_SPAN_DAYS = 92;
const DAY_MS = 86400_000;

export class EventDto {
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsISO8601() startsAt: string;
  @IsISO8601() endsAt: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() @MaxLength(200) place?: string;
  @ValidateNested() @Type(() => AudienceDto) audience: AudienceDto;
}

export class UpdateEventDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() @MaxLength(200) place?: string;
  @IsOptional() @ValidateNested() @Type(() => AudienceDto) audience?: AudienceDto;
}

export class CaptionDto {
  @IsOptional() @IsString() @MaxLength(200) caption?: string;
}

export class CalendarQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() childId?: string;
}

export type CalendarKind = 'EVENT' | 'TRIP' | 'EXAM' | 'HOLIDAY' | 'BREAK' | 'CLUB';
export interface CalendarItem {
  kind: CalendarKind;
  date: string;
  /** The last day, for a holiday or break that runs for several. */
  until?: string;
  start?: string;
  end?: string;
  title: string;
  titleAr?: string | null;
  studentId?: string;
  id?: string;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly audience: AudienceService,
    private readonly calendar: SchoolCalendar,
  ) {}

  private async event(schoolId: string, id: string) {
    const event = await this.prisma.event.findFirst({ where: { id, schoolId } });
    if (!event) throw new NotFoundException('Event not found.');
    return event;
  }

  private checkTimes(startsAt: Date, endsAt: Date) {
    if (startsAt.getTime() >= endsAt.getTime()) throw new BadRequestException('The event must start before it ends.');
  }

  private shape<T extends { audience: Prisma.JsonValue; _count?: { photos: number } }>(e: T) {
    const { _count, ...rest } = e;
    return { ...rest, photoCount: _count?.photos ?? 0 };
  }

  // ---- staff -----------------------------------------------------------------

  async list(schoolId: string, from?: string, to?: string) {
    for (const d of [from, to]) if (d && !DATE_RE.test(d)) throw new BadRequestException('Dates must look like 2026-09-30.');
    const events = await this.prisma.event.findMany({
      where: {
        schoolId,
        ...(to ? { startsAt: { lt: new Date(dbDate(to).getTime() + DAY_MS) } } : {}),
        ...(from ? { endsAt: { gte: dbDate(from) } } : {}),
      },
      include: { _count: { select: { photos: true } } },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    return events.map((e) => this.shape(e));
  }

  async get(schoolId: string, id: string) {
    const event = await this.prisma.event.findFirst({ where: { id, schoolId }, include: { _count: { select: { photos: true } }, photos: { select: { id: true, caption: true, mime: true, size: true }, orderBy: { createdAt: 'asc' } } } });
    if (!event) throw new NotFoundException('Event not found.');
    return this.shape(event);
  }

  async create(user: AuthUser, schoolId: string, dto: EventDto) {
    this.checkTimes(new Date(dto.startsAt), new Date(dto.endsAt));
    await this.audience.validate(schoolId, dto.audience);
    const event = await this.prisma.event.create({
      data: {
        schoolId, title: dto.title.trim(), description: dto.description?.trim() || null, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt),
        allDay: dto.allDay ?? false, place: dto.place?.trim() || null, audience: { kind: dto.audience.kind, ids: dto.audience.ids ?? [] }, createdById: user.id,
      },
    });
    await this.audit.log(user, 'event.create', 'event', event.id, { title: event.title });
    return this.get(schoolId, event.id);
  }

  async update(user: AuthUser, schoolId: string, id: string, dto: UpdateEventDto) {
    const event = await this.event(schoolId, id);
    this.checkTimes(dto.startsAt ? new Date(dto.startsAt) : event.startsAt, dto.endsAt ? new Date(dto.endsAt) : event.endsAt);
    if (dto.audience) await this.audience.validate(schoolId, dto.audience);
    const data = defined({
      title: dto.title?.trim(), description: dto.description?.trim(), startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      allDay: dto.allDay, place: dto.place?.trim(), audience: dto.audience ? { kind: dto.audience.kind, ids: dto.audience.ids ?? [] } : undefined,
    });
    await this.prisma.event.updateMany({ where: { id, schoolId }, data });
    await this.audit.log(user, 'event.update', 'event', id, { fields: Object.keys(dto) });
    return this.get(schoolId, id);
  }

  async remove(user: AuthUser, schoolId: string, id: string) {
    await this.event(schoolId, id);
    await this.prisma.event.deleteMany({ where: { id, schoolId } });
    await this.audit.log(user, 'event.delete', 'event', id, {});
    return { ok: true };
  }

  /** Publishing tells every parent in the audience, once. */
  async publish(user: AuthUser, schoolId: string, id: string, now = new Date()) {
    const event = await this.event(schoolId, id);
    if (event.publishedAt) throw new BadRequestException('This event is already published.');
    const { count } = await this.prisma.event.updateMany({ where: { id, schoolId, publishedAt: null }, data: { publishedAt: now } });
    if (!count) throw new BadRequestException('This event is already published.');
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
    const reach = await this.audience.reach(schoolId, event.audience as unknown as AudienceDto);
    const date = localParts(event.startsAt, school.timezone).date;
    const told = await this.notifications.notify(
      reach.parentIds.map((userId) => ({
        schoolId, userId, type: 'event.new', title: `School event: ${event.title} on ${date}`, body: event.place ?? event.title,
        data: { eventId: id, title: event.title, startsAt: event.startsAt.toISOString(), date },
      })),
    );
    await this.audit.log(user, 'event.publish', 'event', id, { told });
    return { ok: true, told };
  }

  async addPhoto(user: AuthUser, schoolId: string, id: string, file: Express.Multer.File | undefined, caption?: string) {
    await this.event(schoolId, id);
    if (!file) throw new BadRequestException('Attach the photo as “file”.');
    const mime = sniff(file.buffer);
    if (!mime || !IMAGE_TYPES.includes(mime)) throw new BadRequestException('Photos must be JPEG, PNG or WebP.');
    if ((await this.prisma.eventPhoto.count({ where: { eventId: id } })) >= MAX_PHOTOS) throw new BadRequestException('An event can have up to 30 photos.');
    const photo = await this.prisma.eventPhoto.create({ data: { eventId: id, mime, size: file.size, data: new Uint8Array(file.buffer), caption: caption?.trim() || null }, select: { id: true, caption: true, mime: true, size: true } });
    await this.audit.log(user, 'event.photo', 'event', id, { photoId: photo.id });
    return photo;
  }

  async removePhoto(user: AuthUser, schoolId: string, id: string, photoId: string) {
    await this.event(schoolId, id);
    const { count } = await this.prisma.eventPhoto.deleteMany({ where: { id: photoId, eventId: id } });
    if (!count) throw new NotFoundException('Photo not found.');
    await this.audit.log(user, 'event.photo.delete', 'event', id, { photoId });
    return { ok: true };
  }

  /** The bytes of a photo: for staff, and for parents whose child the published event is for. */
  async photo(user: AuthUser, schoolId: string, id: string, photoId: string) {
    const event = await this.event(schoolId, id);
    if (user.role === Role.PARENT) await this.assertParentMaySee(user, schoolId, event);
    const photo = await this.prisma.eventPhoto.findFirst({ where: { id: photoId, eventId: id } });
    if (!photo) throw new NotFoundException('Photo not found.');
    return photo;
  }

  private async assertParentMaySee(user: AuthUser, schoolId: string, event: { publishedAt: Date | null; audience: Prisma.JsonValue }) {
    if (!event.publishedAt || !(await this.audience.includesParent(schoolId, event.audience as unknown as AudienceDto, user.id))) throw new NotFoundException('Event not found.');
  }

  // ---- parent ----------------------------------------------------------------

  async forParent(user: AuthUser, id: string) {
    const schoolId = user.schoolId!;
    const event = await this.event(schoolId, id);
    await this.assertParentMaySee(user, schoolId, event);
    const photos = await this.prisma.eventPhoto.findMany({ where: { eventId: id }, select: { id: true, caption: true }, orderBy: { createdAt: 'asc' } });
    const { audience: _a, createdById: _c, ...rest } = event;
    return { ...rest, photos };
  }

  /** One list of everything dated that a parent cares about: events, their children's trips and exams, clubs, holidays. */
  async parentCalendar(user: AuthUser, q: CalendarQuery, now = new Date()) {
    const schoolId = user.schoolId!;
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const today = localParts(now, school.timezone).date;
    const [y, m] = today.split('-').map(Number);
    const from = q.from ?? `${y}-${String(m).padStart(2, '0')}-01`;
    const to = q.to ?? `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    for (const d of [from, to]) if (!DATE_RE.test(d)) throw new BadRequestException('Dates must look like 2026-09-30.');
    if (to < from) throw new BadRequestException('The end of the range is before its start.');
    if ((dbDate(to).getTime() - dbDate(from).getTime()) / DAY_MS > MAX_SPAN_DAYS) throw new BadRequestException('Ask for about three months at a time.');

    const links = await this.prisma.studentGuardian.findMany({
      where: { userId: user.id, restricted: false, student: { schoolId, active: true }, ...(q.childId ? { studentId: q.childId } : {}) },
      select: { student: { select: { id: true, firstName: true, classId: true } } },
    });
    if (q.childId && !links.length) throw new NotFoundException('Child not found.');
    const children = links.map((l) => l.student);
    const classIds = [...new Set(children.map((c) => c.classId).filter((c): c is string => !!c))];
    const items: CalendarItem[] = [];
    const rangeStart = dbDate(from);
    const rangeEnd = dbDate(to);
    const after = new Date(rangeEnd.getTime() + DAY_MS);

    // Published events for the parent's audience.
    if (await schoolHas(this.prisma, schoolId, 'activities', 'events')) {
      const events = await this.prisma.event.findMany({ where: { schoolId, publishedAt: { not: null }, startsAt: { lt: after }, endsAt: { gte: rangeStart } }, orderBy: { startsAt: 'asc' } });
      for (const e of events) {
        if (!(await this.audience.includesParent(schoolId, e.audience as unknown as AudienceDto, user.id))) continue;
        const s = localParts(e.startsAt, school.timezone);
        const f = localParts(e.endsAt, school.timezone);
        items.push({ kind: 'EVENT', date: s.date, ...(f.date > s.date ? { until: f.date } : {}), ...(e.allDay ? {} : { start: s.time, end: f.time }), title: e.title, id: e.id });
      }
    }

    // Trips of the children (not drafts or cancelled ones).
    if (classIds.length && (await schoolHas(this.prisma, schoolId, 'activities', 'trips'))) {
      const trips = await this.prisma.trip.findMany({ where: { schoolId, status: { in: [TripStatus.OPEN, TripStatus.CLOSED] }, date: { gte: rangeStart, lte: rangeEnd }, classes: { some: { classId: { in: classIds } } } }, include: { classes: { select: { classId: true } } } });
      for (const t of trips) for (const c of children.filter((k) => k.classId && t.classes.some((tc) => tc.classId === k.classId))) {
        items.push({ kind: 'TRIP', date: isoDate(t.date), start: t.departTime, end: t.returnTime, title: t.title, studentId: c.id, id: t.id });
      }
    }

    // Exams of the children's classes, when the school keeps academics.
    if (classIds.length && (await schoolHas(this.prisma, schoolId, 'academics'))) {
      const exams = await this.prisma.assessment.findMany({
        where: { schoolId, kind: { in: [AssessmentKind.MIDTERM, AssessmentKind.FINAL] }, classId: { in: classIds }, date: { gte: rangeStart, lte: rangeEnd } },
        select: { id: true, title: true, date: true, startTime: true, endTime: true, classId: true, subject: { select: { name: true, nameAr: true } } },
      });
      for (const e of exams) for (const c of children.filter((k) => k.classId === e.classId)) {
        items.push({ kind: 'EXAM', date: isoDate(e.date), ...(e.startTime ? { start: e.startTime } : {}), ...(e.endTime ? { end: e.endTime } : {}), title: `${e.subject.name}: ${e.title}`, titleAr: e.subject.nameAr ? `${e.subject.nameAr}: ${e.title}` : null, studentId: c.id, id: e.id });
      }
    }

    // Holidays and the mid-year break.
    const [holidays, years] = await Promise.all([
      this.prisma.holiday.findMany({ where: { schoolId, fromDate: { lte: rangeEnd }, toDate: { gte: rangeStart } }, orderBy: { fromDate: 'asc' } }),
      this.prisma.academicYear.findMany({ where: { schoolId, breakFrom: { lte: rangeEnd }, breakTo: { gte: rangeStart } } }),
    ]);
    const clip = (a: Date, b: Date) => ({ date: isoDate(a) < from ? from : isoDate(a), until: isoDate(b) > to ? to : isoDate(b) });
    for (const h of holidays) {
      const { date, until } = clip(h.fromDate, h.toDate);
      items.push({ kind: 'HOLIDAY', date, ...(until > date ? { until } : {}), title: h.name, id: h.id });
    }
    for (const y of years) {
      const { date, until } = clip(y.breakFrom!, y.breakTo!);
      items.push({ kind: 'BREAK', date, ...(until > date ? { until } : {}), title: 'Mid-year break', titleAr: 'إجازة منتصف العام', id: y.id });
    }

    // Clubs the children are in, on the days they meet that school is open.
    if (children.length) {
      const clubs = await this.prisma.activity.findMany({
        where: { schoolId, archivedAt: null, enrolments: { some: { studentId: { in: children.map((c) => c.id) }, status: EnrolmentStatus.ENROLLED } } },
        select: { id: true, name: true, nameAr: true, days: true, startTime: true, endTime: true, enrolments: { where: { studentId: { in: children.map((c) => c.id) }, status: EnrolmentStatus.ENROLLED }, select: { studentId: true } } },
      });
      if (clubs.length) {
        const open = await this.calendar.openDays(school, from, to);
        for (const club of clubs) {
          for (const date of open.filter((d) => club.days.includes(weekday(d)))) {
            for (const e of club.enrolments) items.push({ kind: 'CLUB', date, start: club.startTime, end: club.endTime, title: club.name, titleAr: club.nameAr, studentId: e.studentId, id: club.id });
          }
        }
      }
    }

    return { from, to, items: items.sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')) || a.title.localeCompare(b.title)) };
  }
}

@RequiresModule('activities')
@RequiresFeature('activities', 'events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Roles(...STAFF)
  @Get()
  list(@SchoolId() schoolId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.events.list(schoolId, from, to);
  }

  @Roles(...STAFF)
  @Get(':id')
  get(@SchoolId() schoolId: string, @Param('id') id: string) {
    return this.events.get(schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: EventDto) {
    return this.events.create(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(user, schoolId, id, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.events.remove(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/publish')
  publish(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.events.publish(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  addPhoto(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: CaptionDto, @UploadedFile() file?: Express.Multer.File) {
    return this.events.addPhoto(user, schoolId, id, file, dto.caption);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id/photos/:photoId')
  removePhoto(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('photoId') photoId: string) {
    return this.events.removePhoto(user, schoolId, id, photoId);
  }

  @Roles(...STAFF, Role.PARENT)
  @Get(':id/photos/:photoId')
  async photo(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('photoId') photoId: string, @Res() res: Response) {
    const photo = await this.events.photo(user, schoolId, id, photoId);
    res.setHeader('content-type', photo.mime);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'private, max-age=86400');
    res.send(Buffer.from(photo.data));
  }
}

@RequiresModule('activities')
@RequiresFeature('activities', 'events')
@Roles(Role.PARENT)
@Controller('parent')
export class ParentEventsController {
  constructor(private readonly events: EventsService) {}

  @Get('events/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.events.forParent(user, id);
  }
}

/**
 * The calendar belongs to Activities as a whole, not to its events feature: a school with only clubs
 * (or only holidays and exams) still has a calendar.
 */
@RequiresModule('activities')
@Roles(Role.PARENT)
@Controller('parent')
export class ParentCalendarController {
  constructor(private readonly events: EventsService) {}

  @Get('calendar')
  calendar(@CurrentUser() user: AuthUser, @Query() q: CalendarQuery) {
    return this.events.parentCalendar(user, q);
  }
}
