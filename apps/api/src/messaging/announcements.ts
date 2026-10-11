import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AnnouncementPriority, Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId } from '../auth/auth.decorators';
import { AudienceDto, AudienceService } from '../common/audience';
import { defined } from '../common/validation';
import { NotificationsService } from '../notifications/notifications';
import { assertMayTarget, checkAttachment, excerpt, MAX_FILE_BYTES, sendAttachment } from './shared';

export class CreateAnnouncementDto {
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsString() @MinLength(1) @MaxLength(4000) body: string;
  @ValidateNested() @Type(() => AudienceDto) audience: AudienceDto;
}

export class UpdateAnnouncementDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) body?: string;
  @IsOptional() @ValidateNested() @Type(() => AudienceDto) audience?: AudienceDto;
}

export class EmergencyDto {
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsString() @MinLength(1) @MaxLength(4000) body: string;
}

export class PreviewDto {
  @ValidateNested() @Type(() => AudienceDto) audience: AudienceDto;
}

const view = {
  id: true, title: true, body: true, audience: true, priority: true, authorId: true, fileType: true, fileName: true,
  createdAt: true, sentAt: true, recipients: true, author: { select: { name: true, honorific: true } },
} satisfies Prisma.AnnouncementSelect;
type Row = Prisma.AnnouncementGetPayload<{ select: typeof view }>;
const present = ({ fileType, ...a }: Row, counts?: { read: number; acknowledged: number }) => ({
  ...a, hasFile: !!fileType, readCount: counts?.read ?? 0, acknowledgedCount: counts?.acknowledged ?? 0,
});

const audienceOf = (a: { audience: Prisma.JsonValue }) => a.audience as unknown as AudienceDto;
const asJson = (a: AudienceDto) => ({ kind: a.kind, ids: a.ids ?? [] }) as Prisma.InputJsonValue;

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly audiences: AudienceService,
  ) {}

  private async find(schoolId: string, id: string) {
    const a = await this.prisma.announcement.findFirst({ where: { id, schoolId }, select: view });
    if (!a) throw new NotFoundException('Announcement not found.');
    return a;
  }

  private mustWrite(user: AuthUser, a: { authorId: string | null }) {
    if (user.role !== Role.SCHOOL_ADMIN && a.authorId !== user.id) {
      throw new ForbiddenException('Only the author or Student Affairs can change this announcement.');
    }
  }

  /** A teacher sees their own announcements and the ones sent to the whole school. */
  private canSee(user: AuthUser, a: { authorId: string | null; sentAt: Date | null; audience: Prisma.JsonValue }) {
    if (user.role !== Role.TEACHER) return true;
    return a.authorId === user.id || (!!a.sentAt && audienceOf(a).kind === 'SCHOOL');
  }

  private async counts(ids: string[]) {
    const [read, ack] = await Promise.all([
      this.prisma.announcementRead.groupBy({ by: ['announcementId'], where: { announcementId: { in: ids }, readAt: { not: null } }, _count: true }),
      this.prisma.announcementRead.groupBy({ by: ['announcementId'], where: { announcementId: { in: ids }, acknowledgedAt: { not: null } }, _count: true }),
    ]);
    const r = new Map(read.map((g) => [g.announcementId, g._count]));
    const k = new Map(ack.map((g) => [g.announcementId, g._count]));
    return (id: string) => ({ read: r.get(id) ?? 0, acknowledged: k.get(id) ?? 0 });
  }

  // ---- staff ---------------------------------------------------------------

  async list(user: AuthUser, schoolId: string, status?: string, priority?: string) {
    const where: Prisma.AnnouncementWhereInput = {
      schoolId,
      ...(status === 'SENT' ? { sentAt: { not: null } } : status === 'DRAFT' ? { sentAt: null } : {}),
      ...(priority ? { priority: priority as AnnouncementPriority } : {}),
      ...(user.role === Role.TEACHER
        ? { OR: [{ authorId: user.id }, { sentAt: { not: null }, audience: { path: ['kind'], equals: 'SCHOOL' } }] }
        : {}),
    };
    const rows = await this.prisma.announcement.findMany({ where, select: view, orderBy: { createdAt: 'desc' }, take: 200 });
    const count = await this.counts(rows.map((r) => r.id));
    return rows.map((r) => present(r, count(r.id)));
  }

  async create(user: AuthUser, schoolId: string, dto: CreateAnnouncementDto) {
    await assertMayTarget(this.prisma, user, schoolId, dto.audience);
    await this.audiences.validate(schoolId, dto.audience);
    const a = await this.prisma.announcement.create({
      data: { schoolId, title: dto.title.trim(), body: dto.body.trim(), audience: asJson(dto.audience), authorId: user.id },
      select: view,
    });
    await this.audit.log(user, 'announcement.create', 'announcement', a.id, { audience: dto.audience.kind });
    return present(a);
  }

  async update(user: AuthUser, schoolId: string, id: string, dto: UpdateAnnouncementDto) {
    const a = await this.find(schoolId, id);
    this.mustWrite(user, a);
    if (a.sentAt) throw new BadRequestException('This announcement has already been sent.');
    if (dto.audience) {
      await assertMayTarget(this.prisma, user, schoolId, dto.audience);
      await this.audiences.validate(schoolId, dto.audience);
    }
    const { count } = await this.prisma.announcement.updateMany({
      where: { id, schoolId, sentAt: null },
      data: defined({ title: dto.title?.trim(), body: dto.body?.trim(), audience: dto.audience ? asJson(dto.audience) : undefined }),
    });
    if (!count) throw new BadRequestException('This announcement has already been sent.');
    await this.audit.log(user, 'announcement.edit', 'announcement', id);
    return present(await this.find(schoolId, id));
  }

  async setFile(user: AuthUser, schoolId: string, id: string, file: Express.Multer.File | undefined) {
    const a = await this.find(schoolId, id);
    this.mustWrite(user, a);
    if (a.sentAt) throw new BadRequestException('This announcement has already been sent.');
    if (!file) throw new BadRequestException('Attach the file as “file”.');
    const mime = checkAttachment(file);
    await this.prisma.announcement.updateMany({
      where: { id, schoolId, sentAt: null },
      data: { fileData: new Uint8Array(file.buffer), fileType: mime, fileName: file.originalname?.slice(0, 120) || 'attachment' },
    });
    return present(await this.find(schoolId, id));
  }

  async remove(user: AuthUser, schoolId: string, id: string) {
    const a = await this.find(schoolId, id);
    this.mustWrite(user, a);
    const { count } = await this.prisma.announcement.deleteMany({ where: { id, schoolId, sentAt: null } });
    if (!count) throw new BadRequestException('Only drafts can be deleted.');
    await this.audit.log(user, 'announcement.delete', 'announcement', id);
    return { ok: true };
  }

  /** How many parents an audience reaches, before sending. */
  async preview(user: AuthUser, schoolId: string, audience: AudienceDto) {
    await assertMayTarget(this.prisma, user, schoolId, audience);
    await this.audiences.validate(schoolId, audience);
    const reach = await this.audiences.reach(schoolId, audience);
    return { parents: reach.parentIds.length, students: reach.students.length };
  }

  async send(user: AuthUser, schoolId: string, id: string, now = new Date()) {
    const a = await this.find(schoolId, id);
    this.mustWrite(user, a);
    if (a.sentAt) throw new BadRequestException('This announcement has already been sent.');
    await this.dispatch(user, schoolId, a, now);
    return present(await this.find(schoolId, id));
  }

  /** Student Affairs only: written and sent in one go, to every parent. */
  async emergency(user: AuthUser, schoolId: string, dto: EmergencyDto, now = new Date()) {
    const a = await this.prisma.announcement.create({
      data: { schoolId, title: dto.title.trim(), body: dto.body.trim(), audience: asJson({ kind: 'SCHOOL', ids: [] }), priority: AnnouncementPriority.EMERGENCY, authorId: user.id },
      select: view,
    });
    try {
      await this.dispatch(user, schoolId, a, now);
    } catch (e) {
      await this.prisma.announcement.deleteMany({ where: { id: a.id, sentAt: null } });
      throw e;
    }
    return present(await this.find(schoolId, a.id));
  }

  /** Sends a draft: marks who it reached and tells each of them, once. */
  private async dispatch(user: AuthUser, schoolId: string, a: Row, now: Date) {
    const reach = await this.audiences.reach(schoolId, audienceOf(a));
    if (!reach.parentIds.length) throw new BadRequestException('There are no parents to send this to yet.');
    await this.prisma.$transaction(async (tx) => {
      // Claimed first, so two quick presses of "Send" can't send it twice.
      const { count } = await tx.announcement.updateMany({ where: { id: a.id, schoolId, sentAt: null }, data: { sentAt: now, recipients: reach.parentIds.length } });
      if (!count) throw new BadRequestException('This announcement has already been sent.');
      await tx.announcementRead.createMany({ data: reach.parentIds.map((userId) => ({ announcementId: a.id, userId })), skipDuplicates: true });
    });

    const emergency = a.priority === AnnouncementPriority.EMERGENCY;
    const kids = new Map<string, string[]>();
    for (const p of reach.pairs) kids.set(p.parentId, [...(kids.get(p.parentId) ?? []), p.studentId]);
    await this.notifications.notify(
      reach.parentIds.map((userId) => {
        const mine = kids.get(userId) ?? [];
        return {
          schoolId, userId,
          type: emergency ? 'announcement.emergency' : 'announcement.new',
          title: emergency ? `Urgent from the school: ${a.title}` : `New from the school: ${a.title}`,
          body: excerpt(a.body),
          // One child in the audience: say which, so the app can speak of them by name.
          data: { announcementId: a.id, title: a.title, ...(audienceOf(a).kind !== 'SCHOOL' && mine.length === 1 ? { studentId: mine[0] } : {}) },
        };
      }),
    );
    await this.audit.log(user, emergency ? 'announcement.emergency' : 'announcement.send', 'announcement', a.id, { recipients: reach.parentIds.length, audience: audienceOf(a).kind });
  }

  async detail(user: AuthUser, schoolId: string, id: string) {
    const a = await this.find(schoolId, id);
    if (!this.canSee(user, a)) throw new NotFoundException('Announcement not found.');
    const counts = (await this.counts([id]))(id);
    const reads = user.role === Role.SCHOOL_ADMIN
      ? (await this.prisma.announcementRead.findMany({
          where: { announcementId: id }, include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: 'asc' } },
        })).map((r) => ({ parent: r.user, readAt: r.readAt, acknowledgedAt: r.acknowledgedAt }))
      : undefined;
    return { ...present(a, counts), reads };
  }

  async file(user: AuthUser, schoolId: string, id: string) {
    const a = await this.prisma.announcement.findFirst({ where: { id, schoolId }, select: { ...view, fileData: true } });
    if (!a || !a.fileData || !a.fileType || !this.canSee(user, a)) throw new NotFoundException('No attachment.');
    return { mime: a.fileType, name: a.fileName, data: a.fileData };
  }

  // ---- parent --------------------------------------------------------------

  async listForParent(parentId: string) {
    const rows = await this.prisma.announcementRead.findMany({
      where: { userId: parentId, announcement: { sentAt: { not: null } } },
      include: { announcement: { select: view } },
      orderBy: { announcement: { sentAt: 'desc' } },
      take: 100,
    });
    return rows.map((r) => {
      const { audience: _audience, authorId: _author, recipients: _recipients, ...a } = present(r.announcement);
      return { ...a, readAt: r.readAt, acknowledgedAt: r.acknowledgedAt };
    });
  }

  /** Urgent messages the parent hasn't confirmed yet: they stay at the top of the app. */
  async pendingEmergencies(parentId: string) {
    return (await this.listForParent(parentId)).filter((a) => a.priority === AnnouncementPriority.EMERGENCY && !a.acknowledgedAt);
  }

  private async readRow(parentId: string, id: string) {
    const row = await this.prisma.announcementRead.findUnique({
      where: { announcementId_userId: { announcementId: id, userId: parentId } },
      include: { announcement: { select: { priority: true, sentAt: true } } },
    });
    if (!row || !row.announcement.sentAt) throw new NotFoundException('Announcement not found.');
    return row;
  }

  async markRead(parentId: string, id: string, now = new Date()) {
    await this.readRow(parentId, id);
    await this.prisma.announcementRead.updateMany({ where: { announcementId: id, userId: parentId, readAt: null }, data: { readAt: now } });
    return { ok: true };
  }

  async acknowledge(parentId: string, id: string, now = new Date()) {
    const row = await this.readRow(parentId, id);
    if (row.announcement.priority !== AnnouncementPriority.EMERGENCY) throw new BadRequestException('Only urgent messages need confirming.');
    await this.prisma.announcementRead.updateMany({ where: { announcementId: id, userId: parentId, acknowledgedAt: null }, data: { acknowledgedAt: now, readAt: row.readAt ?? now } });
    return { ok: true };
  }

  async fileForParent(parentId: string, id: string) {
    await this.readRow(parentId, id);
    const a = await this.prisma.announcement.findUnique({ where: { id }, select: { fileData: true, fileType: true, fileName: true } });
    if (!a?.fileData || !a.fileType) throw new NotFoundException('No attachment.');
    return { mime: a.fileType, name: a.fileName, data: a.fileData };
  }
}

@RequiresModule('messaging')
@Roles(Role.SCHOOL_ADMIN, Role.SOCIAL_WORKER, Role.TEACHER)
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query('status') status?: string, @Query('priority') priority?: string) {
    if (status && !['SENT', 'DRAFT'].includes(status)) throw new BadRequestException('Unknown status.');
    if (priority && !(priority in AnnouncementPriority)) throw new BadRequestException('Unknown priority.');
    return this.announcements.list(user, schoolId, status, priority);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post()
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.create(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post('preview')
  preview(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: PreviewDto) {
    return this.announcements.preview(user, schoolId, dto.audience);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post('emergency')
  emergency(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: EmergencyDto) {
    return this.announcements.emergency(user, schoolId, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.announcements.detail(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcements.update(user, schoolId, id, dto);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Put(':id/file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  setFile(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.announcements.setFile(user, schoolId, id, file);
  }

  @Get(':id/file')
  async file(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Res() res: Response) {
    sendAttachment(res, await this.announcements.file(user, schoolId, id));
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.announcements.remove(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post(':id/send')
  send(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.announcements.send(user, schoolId, id);
  }
}

@RequiresModule('messaging')
@Roles(Role.PARENT)
@Controller('parent/announcements')
export class ParentAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.announcements.listForParent(user.id);
  }

  @Get('emergency')
  emergencies(@CurrentUser() user: AuthUser) {
    return this.announcements.pendingEmergencies(user.id);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.announcements.markRead(user.id, id);
  }

  @Post(':id/acknowledge')
  acknowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.announcements.acknowledge(user.id, id);
  }

  @Get(':id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    sendAttachment(res, await this.announcements.fileForParent(user.id, id));
  }
}
