import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { BehaviourKind, IncidentSeverity, Prisma, Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { schoolHas } from '../auth/access.guard';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId } from '../auth/auth.decorators';
import { DATE_RE, dbDate } from '../common/dates';
import { localParts, zonedTime } from '../common/time';
import { defined } from '../common/validation';
import { excerpt, ownChild, teacherClassIds } from '../messaging/shared';
import { NotificationsService } from '../notifications/notifications';
import { CATEGORIES, POINT_RANGE } from './categories';

/** The writer of a note can still change it for this long; after that only Student Affairs can. */
export const EDIT_WINDOW_HOURS = 24;
/** A note can be dated at most this many days back. */
export const MAX_DAYS_BACK = 30;

const DAY_MS = 86400_000;

export class CreateNoteDto {
  @IsString() studentId: string;
  @IsEnum(BehaviourKind) kind: BehaviourKind;
  @IsString() category: string;
  @IsString() @MinLength(3) @MaxLength(1000) text: string;
  @IsOptional() @IsInt() points?: number;
  @IsOptional() @IsBoolean() visibleToParents?: boolean;
  @IsOptional() @IsEnum(IncidentSeverity) severity?: IncidentSeverity;
  @IsOptional() @IsString() @MaxLength(1000) actionTaken?: string;
  @IsOptional() @IsString() @MaxLength(200) place?: string;
  @IsOptional() @IsISO8601() occurredAt?: string;
}

export class UpdateNoteDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(1000) text?: string;
  @IsOptional() @ValidateIf((d) => d.points !== null) @IsInt() points?: number | null;
  @IsOptional() @IsBoolean() visibleToParents?: boolean;
  @IsOptional() @IsEnum(IncidentSeverity) severity?: IncidentSeverity;
  @IsOptional() @IsString() @MaxLength(1000) actionTaken?: string;
  @IsOptional() @IsString() @MaxLength(200) place?: string;
}

export class NotesQuery {
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsEnum(BehaviourKind) kind?: BehaviourKind;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

const noteSelect = {
  id: true, studentId: true, kind: true, category: true, text: true, points: true, visibleToParents: true, severity: true,
  actionTaken: true, place: true, occurredAt: true, createdAt: true, authorId: true,
  author: { select: { id: true, name: true, honorific: true } },
  student: { select: { id: true, firstName: true, lastName: true, gender: true, classId: true, class: { select: { name: true } } } },
  reads: { select: { userId: true } },
} satisfies Prisma.BehaviourNoteSelect;
type NoteRow = Prisma.BehaviourNoteGetPayload<{ select: typeof noteSelect }>;

const present = ({ reads, ...n }: NoteRow) => ({ ...n, readByParent: reads.length > 0 });

@Injectable()
export class BehaviourService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- who may do what -------------------------------------------------------

  /** Student Affairs and the social worker see and write everything; a teacher only about students they teach or lead. */
  private async studentScope(user: AuthUser, schoolId: string): Promise<Set<string> | null> {
    return user.role === Role.TEACHER ? teacherClassIds(this.prisma, schoolId, user.id) : null;
  }

  private async mayWriteAbout(user: AuthUser, schoolId: string, student: { classId: string | null }) {
    const scope = await this.studentScope(user, schoolId);
    if (scope && (!student.classId || !scope.has(student.classId))) throw new ForbiddenException('You can write notes only for students you teach.');
  }

  private async merits(schoolId: string) {
    return schoolHas(this.prisma, schoolId, 'behavior', 'merits');
  }

  private checkPoints(kind: BehaviourKind, points: number | null | undefined, merits: boolean) {
    if (points == null) return;
    if (!merits) throw new BadRequestException('Merit points are switched off for this school.');
    const [min, max] = POINT_RANGE[kind];
    if (points < min || points > max) throw new BadRequestException(`Points for ${kind.toLowerCase()} notes must be between ${min} and ${max}.`);
  }

  private checkCategory(kind: BehaviourKind, category: string) {
    if (!CATEGORIES[kind].includes(category)) throw new BadRequestException('Choose a category that fits this kind of note.');
  }

  // ---- staff -----------------------------------------------------------------

  categories() {
    return CATEGORIES;
  }

  /** The students a person can write notes about: a teacher's own classes, or everyone for Student Affairs. */
  async students(user: AuthUser, schoolId: string) {
    const scope = await this.studentScope(user, schoolId);
    return this.prisma.student.findMany({
      where: { schoolId, active: true, ...(scope ? { classId: { in: [...scope] } } : {}) },
      select: { id: true, firstName: true, lastName: true, gender: true, class: { select: { id: true, name: true } } },
      orderBy: [{ class: { name: 'asc' } }, { firstName: 'asc' }, { lastName: 'asc' }],
      take: 1000,
    });
  }

  async list(user: AuthUser, schoolId: string, q: NotesQuery) {
    const scope = await this.studentScope(user, schoolId);
    const where: Prisma.BehaviourNoteWhereInput = {
      schoolId,
      withdrawnAt: null,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.from || q.to ? { occurredAt: { ...(q.from ? { gte: dbDate(q.from) } : {}), ...(q.to ? { lt: new Date(dbDate(q.to).getTime() + DAY_MS) } : {}) } } : {}),
      student: { ...(q.classId ? { classId: q.classId } : {}), ...(scope ? { classId: { in: [...scope].filter((c) => !q.classId || c === q.classId) } } : {}) },
    };
    const rows = await this.prisma.behaviourNote.findMany({ where, select: noteSelect, orderBy: { occurredAt: 'desc' }, take: 200 });
    return rows.map(present);
  }

  async create(user: AuthUser, schoolId: string, dto: CreateNoteDto, now = new Date()) {
    const student = await this.prisma.student.findFirst({ where: { id: dto.studentId, schoolId, active: true }, select: { id: true, firstName: true, lastName: true, classId: true } });
    if (!student) throw new NotFoundException('Student not found.');
    if (dto.kind === BehaviourKind.INCIDENT && user.role === Role.TEACHER) throw new ForbiddenException('Incidents are recorded by Student Affairs.');
    await this.mayWriteAbout(user, schoolId, student);
    this.checkCategory(dto.kind, dto.category);
    this.checkPoints(dto.kind, dto.points, await this.merits(schoolId));
    if (dto.kind === BehaviourKind.INCIDENT && !dto.severity) throw new BadRequestException('Choose how serious the incident is.');
    if (dto.kind !== BehaviourKind.INCIDENT && (dto.severity || dto.actionTaken || dto.place)) throw new BadRequestException('Only incidents have a severity, an action taken and a place.');

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : now;
    if (occurredAt.getTime() > now.getTime() + 60_000) throw new BadRequestException('A note can’t be dated in the future.');
    if (occurredAt.getTime() < now.getTime() - MAX_DAYS_BACK * DAY_MS) throw new BadRequestException(`A note can be dated up to ${MAX_DAYS_BACK} days back.`);

    const visibleToParents = dto.visibleToParents ?? dto.kind !== BehaviourKind.INCIDENT;
    const note = await this.prisma.behaviourNote.create({
      data: {
        schoolId, studentId: student.id, authorId: user.id, kind: dto.kind, category: dto.category, text: dto.text.trim(), points: dto.points ?? null,
        visibleToParents, severity: dto.severity, actionTaken: dto.actionTaken?.trim() || null, place: dto.place?.trim() || null, occurredAt,
      },
      select: noteSelect,
    });
    await this.audit.log(user, 'behaviour.note', 'student', student.id, { noteId: note.id, kind: note.kind, category: note.category, shared: visibleToParents });
    if (visibleToParents) await this.tellParents(schoolId, note);
    return present(note);
  }

  private async mayChange(user: AuthUser, note: { authorId: string | null; createdAt: Date }, now: Date) {
    if (user.role === Role.SCHOOL_ADMIN || user.role === Role.SOCIAL_WORKER) return;
    if (note.authorId !== user.id) throw new ForbiddenException('Only the author or Student Affairs can change this note.');
    if (now.getTime() - note.createdAt.getTime() > EDIT_WINDOW_HOURS * 3600_000) {
      throw new ForbiddenException(`You can change your own notes for ${EDIT_WINDOW_HOURS} hours. After that, please ask Student Affairs.`);
    }
  }

  private async find(user: AuthUser, schoolId: string, id: string) {
    const note = await this.prisma.behaviourNote.findFirst({ where: { id, schoolId, withdrawnAt: null }, select: noteSelect });
    if (!note) throw new NotFoundException('Note not found.');
    const scope = await this.studentScope(user, schoolId);
    if (scope && (!note.student.classId || !scope.has(note.student.classId))) throw new NotFoundException('Note not found.');
    return note;
  }

  async update(user: AuthUser, schoolId: string, id: string, dto: UpdateNoteDto, now = new Date()) {
    const note = await this.find(user, schoolId, id);
    await this.mayChange(user, note, now);
    if (dto.category) this.checkCategory(note.kind, dto.category);
    if (dto.points !== undefined) this.checkPoints(note.kind, dto.points, await this.merits(schoolId));
    if (note.kind !== BehaviourKind.INCIDENT && (dto.severity || dto.actionTaken || dto.place)) throw new BadRequestException('Only incidents have a severity, an action taken and a place.');
    const data = defined({
      category: dto.category, text: dto.text?.trim(), points: dto.points, visibleToParents: dto.visibleToParents,
      severity: dto.severity, actionTaken: dto.actionTaken?.trim(), place: dto.place?.trim(),
    });
    await this.prisma.behaviourNote.updateMany({ where: { id, schoolId, withdrawnAt: null }, data });
    await this.audit.log(user, 'behaviour.edit', 'student', note.studentId, { noteId: id, ...dto });
    const updated = await this.find(user, schoolId, id);
    // Sharing a note that was kept back tells the parents, once.
    if (dto.visibleToParents === true && !note.visibleToParents) await this.tellParents(schoolId, updated);
    return present(updated);
  }

  async withdraw(user: AuthUser, schoolId: string, id: string, now = new Date()) {
    const note = await this.find(user, schoolId, id);
    await this.mayChange(user, note, now);
    await this.prisma.behaviourNote.updateMany({ where: { id, schoolId, withdrawnAt: null }, data: { withdrawnAt: now } });
    await this.audit.log(user, 'behaviour.withdraw', 'student', note.studentId, { noteId: id });
    return { ok: true };
  }

  /** The school year as a range of days, or the last 12 months for a school that hasn't set one. */
  private async yearRange(schoolId: string, timezone: string, now: Date) {
    const today = localParts(now, timezone).date;
    const year = await this.prisma.academicYear.findFirst({ where: { schoolId, startsOn: { lte: dbDate(today) }, endsOn: { gte: dbDate(today) } } });
    const from = year ? year.startsOn.toISOString().slice(0, 10) : localParts(new Date(now.getTime() - 365 * DAY_MS), timezone).date;
    return { gte: zonedTime(from, '00:00', timezone), lte: now };
  }

  /** Per student: how many notes of each kind and the merit points, this school year. */
  async summary(user: AuthUser, schoolId: string, classId?: string, now = new Date()) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const scope = await this.studentScope(user, schoolId);
    if (classId && scope && !scope.has(classId)) throw new ForbiddenException('You can see only the classes you teach.');
    const classIds = classId ? [classId] : scope ? [...scope] : undefined;
    const students = await this.prisma.student.findMany({
      where: { schoolId, active: true, ...(classIds ? { classId: { in: classIds } } : {}) },
      select: { id: true, firstName: true, lastName: true, class: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const notes = await this.prisma.behaviourNote.groupBy({
      by: ['studentId', 'kind'],
      where: { schoolId, withdrawnAt: null, studentId: { in: students.map((s) => s.id) }, occurredAt: await this.yearRange(schoolId, school.timezone, now) },
      _count: true,
      _sum: { points: true },
    });
    return students.map((s) => {
      const mine = notes.filter((n) => n.studentId === s.id);
      const count = (k: BehaviourKind) => mine.find((n) => n.kind === k)?._count ?? 0;
      return { studentId: s.id, name: `${s.firstName} ${s.lastName}`, class: s.class?.name ?? null, praise: count('PRAISE'), concern: count('CONCERN'), incident: count('INCIDENT'), points: mine.reduce((n, g) => n + (g._sum.points ?? 0), 0) };
    });
  }

  private async tellParents(schoolId: string, note: NoteRow) {
    const guardians = await this.prisma.studentGuardian.findMany({ where: { studentId: note.studentId, restricted: false, user: { active: true } }, select: { userId: true } });
    await this.notifications.notify(
      guardians.map((g) => ({
        schoolId, userId: g.userId, type: 'behaviour.note',
        title: `A note from school about ${note.student.firstName}`, body: excerpt(note.text),
        data: { studentId: note.studentId, noteId: note.id, kind: note.kind, category: note.category },
      })),
    );
  }

  // ---- parent ----------------------------------------------------------------

  async forParent(user: AuthUser, studentId: string, now = new Date()) {
    const child = await ownChild(this.prisma, user.id, studentId);
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: child.schoolId } });
    const merits = await this.merits(child.schoolId);
    const visible: Prisma.BehaviourNoteWhereInput = { studentId, visibleToParents: true, withdrawnAt: null };
    const [notes, year, reads] = await Promise.all([
      this.prisma.behaviourNote.findMany({
        where: visible, orderBy: { occurredAt: 'desc' }, take: 100,
        select: { id: true, kind: true, category: true, text: true, points: true, severity: true, actionTaken: true, occurredAt: true, author: { select: { name: true, honorific: true } } },
      }),
      this.yearRange(child.schoolId, school.timezone, now),
      this.prisma.behaviourNoteRead.findMany({ where: { userId: user.id, note: { studentId } }, select: { noteId: true } }),
    ]);
    const readIds = new Set(reads.map((r) => r.noteId));
    const totals = await this.prisma.behaviourNote.groupBy({ by: ['kind'], where: { ...visible, occurredAt: year }, _count: true, _sum: { points: true } });
    const count = (k: BehaviourKind) => totals.find((t) => t.kind === k)?._count ?? 0;
    return {
      notes: notes.map((n) => ({
        ...n,
        points: merits ? n.points : null,
        // Incidents are told in full; praise and concerns carry no action or severity.
        ...(n.kind === BehaviourKind.INCIDENT ? {} : { severity: null, actionTaken: null }),
        read: readIds.has(n.id),
      })),
      totals: { praise: count('PRAISE'), concern: count('CONCERN') + count('INCIDENT'), ...(merits ? { points: totals.reduce((n, t) => n + (t._sum.points ?? 0), 0) } : {}) },
    };
  }

  async markRead(user: AuthUser, studentId: string, noteId: string) {
    await ownChild(this.prisma, user.id, studentId);
    const note = await this.prisma.behaviourNote.findFirst({ where: { id: noteId, studentId, visibleToParents: true, withdrawnAt: null }, select: { id: true } });
    if (!note) throw new NotFoundException('Note not found.');
    await this.prisma.behaviourNoteRead.upsert({ where: { noteId_userId: { noteId, userId: user.id } }, create: { noteId, userId: user.id }, update: {} });
    return { ok: true };
  }
}

@RequiresModule('behavior')
@Roles(Role.TEACHER, Role.SCHOOL_ADMIN, Role.SOCIAL_WORKER)
@Controller('behaviour')
export class BehaviourController {
  constructor(private readonly behaviour: BehaviourService) {}

  @Get('categories')
  categories() {
    return this.behaviour.categories();
  }

  @Get('students')
  students(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string) {
    return this.behaviour.students(user, schoolId);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query('classId') classId?: string) {
    return this.behaviour.summary(user, schoolId, classId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query() q: NotesQuery) {
    for (const d of [q.from, q.to]) if (d && !DATE_RE.test(d)) throw new BadRequestException('Dates must look like 2026-09-30.');
    return this.behaviour.list(user, schoolId, q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: CreateNoteDto) {
    return this.behaviour.create(user, schoolId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateNoteDto) {
    return this.behaviour.update(user, schoolId, id, dto);
  }

  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.behaviour.withdraw(user, schoolId, id);
  }
}

@RequiresModule('behavior')
@Roles(Role.PARENT)
@Controller('parent/children')
export class ParentBehaviourController {
  constructor(private readonly behaviour: BehaviourService) {}

  @Get(':id/behaviour')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.behaviour.forParent(user, id);
  }

  @Post(':id/behaviour/:noteId/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('noteId') noteId: string) {
    return this.behaviour.markRead(user, id, noteId);
  }
}

@Module({ controllers: [BehaviourController, ParentBehaviourController], providers: [BehaviourService] })
export class BehaviourModule {}
