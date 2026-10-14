import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma, Role } from '@prisma/client';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresFeature, RequiresModule, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { mapPrismaError } from '../common/validation';
import { NotificationsService } from '../notifications/notifications';
import { ChatGateway } from './chat.gateway';
import { checkAttachment, childTeachers, Contact, excerpt, MAX_FILE_BYTES, ownChild, sendAttachment, titled } from './shared';

export const MAX_MESSAGE_CHARS = 2000;
const PAGE = 50;

export class StartThreadDto {
  @IsString() staffId: string;
}

export class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(MAX_MESSAGE_CHARS) body?: string;
}

export class MessagesQuery {
  @IsOptional() @IsISO8601() before?: string;
}

const threadInclude = {
  student: { select: { id: true, firstName: true, lastName: true, gender: true, class: { select: { id: true, name: true } } } },
  parent: { select: { id: true, name: true } },
  staff: { select: { id: true, name: true, honorific: true, role: true } },
} satisfies Prisma.ChatThreadInclude;
type ThreadRow = Prisma.ChatThreadGetPayload<{ include: typeof threadInclude }>;

const messageSelect = { id: true, threadId: true, senderId: true, body: true, fileType: true, fileName: true, createdAt: true, readAt: true } satisfies Prisma.ChatMessageSelect;
type MessageRow = Prisma.ChatMessageGetPayload<{ select: typeof messageSelect }>;
const presentMessage = ({ fileType, ...m }: MessageRow) => ({ ...m, hasFile: !!fileType });

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gateway: ChatGateway,
  ) {}

  // ---- who can talk to whom (decision T3) -----------------------------------

  /** A child's teachers, their class teacher, and Student Affairs. */
  async contacts(schoolId: string, student: { classId: string | null }): Promise<Contact[]> {
    const [teachers, admin] = await Promise.all([
      childTeachers(this.prisma, schoolId, student.classId),
      // Student Affairs is one contact: the first admin by name. Any admin can answer.
      this.prisma.user.findFirst({ where: { schoolId, role: Role.SCHOOL_ADMIN, active: true }, select: { id: true, name: true, honorific: true, role: true }, orderBy: { name: 'asc' } }),
    ]);
    return admin ? [...teachers, { ...admin, subjects: [], homeroom: false }] : teachers;
  }

  async contactsForParent(user: AuthUser, studentId: string) {
    const child = await ownChild(this.prisma, user.id, studentId);
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: child.schoolId }, select: { chatFrom: true, chatTo: true } });
    return { contacts: await this.contacts(child.schoolId, child), chatFrom: school.chatFrom, chatTo: school.chatTo };
  }

  // ---- threads ---------------------------------------------------------------

  async start(user: AuthUser, studentId: string, dto: StartThreadDto) {
    const child = await ownChild(this.prisma, user.id, studentId);
    const contacts = await this.contacts(child.schoolId, child);
    if (!contacts.some((c) => c.id === dto.staffId)) {
      throw new ForbiddenException('You can write to your child’s teachers and Student Affairs only.');
    }
    const key = { studentId_parentId_staffId: { studentId, parentId: user.id, staffId: dto.staffId } };
    let thread = await this.prisma.chatThread.findUnique({ where: key, include: threadInclude });
    if (!thread) {
      try {
        thread = await this.prisma.chatThread.create({ data: { schoolId: child.schoolId, studentId, parentId: user.id, staffId: dto.staffId }, include: threadInclude });
        await this.audit.log({ ...user, schoolId: child.schoolId }, 'chat.thread', 'student', studentId, { threadId: thread.id, staffId: dto.staffId });
      } catch (e) {
        // Two quick taps created it at the same moment: use the one that won.
        thread = await this.prisma.chatThread.findUnique({ where: key, include: threadInclude });
        if (!thread) mapPrismaError(e);
      }
    }
    return this.presentThread(thread!, user.id, 0, null);
  }

  private presentThread(t: ThreadRow, viewerId: string, unread: number, last: { body: string; createdAt: Date; senderId: string; fileType: string | null } | null) {
    return {
      id: t.id, student: t.student, parent: t.parent, staff: t.staff, lastMessageAt: t.lastMessageAt, unread,
      last: last ? { body: excerpt(last.body || (last.fileType ? '📎' : '')), createdAt: last.createdAt, mine: last.senderId === viewerId } : null,
    };
  }

  private async withLastAndUnread(threads: ThreadRow[], viewer: AuthUser) {
    const ids = threads.map((t) => t.id);
    const [lasts, unreadRows] = await Promise.all([
      // The newest message of each thread, one index lookup per thread.
      ids.length
        ? this.prisma.$queryRaw<{ threadId: string; body: string; createdAt: Date; senderId: string; fileType: string | null }[]>(Prisma.sql`
            SELECT m."threadId", m."body", m."createdAt", m."senderId", m."fileType"
            FROM unnest(${ids}::text[]) AS t(id)
            CROSS JOIN LATERAL (SELECT * FROM "ChatMessage" WHERE "threadId" = t.id ORDER BY "createdAt" DESC LIMIT 1) m`)
        : [],
      this.prisma.chatMessage.groupBy({ by: ['threadId', 'senderId'], where: { threadId: { in: ids }, readAt: null }, _count: true }),
    ]);
    const lastOf = new Map(lasts.map((l) => [l.threadId, l]));
    return threads.map((t) => {
      // What is unread for the viewer is what the other side wrote.
      const unread = unreadRows.filter((u) => u.threadId === t.id && (viewer.role === Role.PARENT ? u.senderId !== t.parentId : u.senderId === t.parentId)).reduce((n, u) => n + u._count, 0);
      return this.presentThread(t, viewer.id, unread, lastOf.get(t.id) ?? null);
    });
  }

  async listForParent(user: AuthUser) {
    // A parent restricted for a child no longer sees that child's conversations (decision T4).
    const threads = await this.prisma.chatThread.findMany({
      where: { parentId: user.id, student: { guardians: { some: { userId: user.id, restricted: false } } } },
      include: threadInclude, orderBy: { lastMessageAt: 'desc' }, take: 100,
    });
    return this.withLastAndUnread(threads, user);
  }

  /** The threads a member of staff handles: their own, and for Student Affairs the shared inbox. */
  private mine(user: AuthUser, schoolId: string): Prisma.ChatThreadWhereInput {
    return {
      schoolId,
      OR: [{ staffId: user.id }, ...(user.role === Role.SCHOOL_ADMIN ? [{ staff: { role: Role.SCHOOL_ADMIN } }] : [])],
    };
  }

  async listForStaff(user: AuthUser, schoolId: string, scope: string) {
    if (scope === 'school' && user.role !== Role.SCHOOL_ADMIN) throw new ForbiddenException('Only Student Affairs can see every conversation.');
    const threads = await this.prisma.chatThread.findMany({
      where: scope === 'school' ? { schoolId } : this.mine(user, schoolId),
      include: threadInclude, orderBy: { lastMessageAt: 'desc' }, take: 200,
    });
    return this.withLastAndUnread(threads, user);
  }

  async unreadCount(user: AuthUser, schoolId: string) {
    const count = await this.prisma.chatMessage.count({ where: { readAt: null, sender: { role: Role.PARENT }, thread: this.mine(user, schoolId) } });
    return { count };
  }

  /** The thread, if this person may open it, and whether they may write in it. */
  private async access(user: AuthUser, threadId: string) {
    const thread = user.schoolId ? await this.prisma.chatThread.findFirst({ where: { id: threadId, schoolId: user.schoolId }, include: threadInclude }) : null;
    const missing = new NotFoundException('Conversation not found.');
    if (!thread) throw missing;
    const link = await this.prisma.studentGuardian.findUnique({ where: { studentId_userId: { studentId: thread.studentId, userId: thread.parentId } }, select: { restricted: true } });
    const parentAllowed = !!link && !link.restricted;
    if (user.role === Role.PARENT) {
      if (thread.parentId !== user.id || !parentAllowed) throw missing;
      return { thread, canReply: true };
    }
    const shared = user.role === Role.SCHOOL_ADMIN && thread.staff.role === Role.SCHOOL_ADMIN;
    const own = thread.staffId === user.id || shared;
    // Student Affairs may read any conversation of the school, but only answer their own.
    if (!own && user.role !== Role.SCHOOL_ADMIN) throw missing;
    return { thread, canReply: own && parentAllowed };
  }

  async header(user: AuthUser, threadId: string) {
    const { thread, canReply } = await this.access(user, threadId);
    return { ...this.presentThread(thread, user.id, 0, null), canReply };
  }

  async messages(user: AuthUser, threadId: string, before?: string) {
    await this.access(user, threadId);
    const rows = await this.prisma.chatMessage.findMany({
      where: { threadId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      select: messageSelect, orderBy: { createdAt: 'desc' }, take: PAGE,
    });
    return rows.map(presentMessage);
  }

  /** Who else is in the conversation: the other side, and every admin when it is the shared Student Affairs inbox. */
  private async others(thread: ThreadRow, senderId: string): Promise<string[]> {
    if (senderId !== thread.parentId) return [thread.parentId];
    const ids = [thread.staffId];
    if (thread.staff.role === Role.SCHOOL_ADMIN) {
      const admins = await this.prisma.user.findMany({ where: { schoolId: thread.schoolId, role: Role.SCHOOL_ADMIN, active: true }, select: { id: true } });
      ids.push(...admins.map((a) => a.id));
    }
    return [...new Set(ids)].filter((id) => id !== senderId);
  }

  async send(user: AuthUser, threadId: string, dto: SendMessageDto, file: Express.Multer.File | undefined, now = new Date()) {
    const { thread, canReply } = await this.access(user, threadId);
    if (!canReply) {
      throw new ForbiddenException(user.role === Role.SCHOOL_ADMIN ? 'Only the teacher in this conversation can reply.' : 'This conversation is closed.');
    }
    const body = (dto.body ?? '').trim();
    if (!body && !file) throw new BadRequestException('Write a message first.');
    const mime = file ? checkAttachment(file) : null;
    const message = await this.prisma.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: {
          threadId, senderId: user.id, body, createdAt: now,
          ...(file ? { fileData: new Uint8Array(file.buffer), fileType: mime, fileName: file.originalname?.slice(0, 120) || 'attachment' } : {}),
        },
        select: messageSelect,
      });
      await tx.chatThread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
      return m;
    });

    const view = presentMessage(message);
    const others = await this.others(thread, user.id);
    this.gateway.emit([user.id, ...others], 'message', { threadId, message: view });

    // Someone who isn't connected hears about it as a notification.
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, honorific: true } });
    const sender = user.role === Role.PARENT ? me.name : titled(me);
    const online = await Promise.all(others.map((id) => this.gateway.isOnline(id)));
    const offline = others.filter((_, i) => !online[i]);
    await this.notifications.notify(
      offline.map((userId) => ({
        schoolId: thread.schoolId, userId, type: 'message.new',
        title: `New message from ${sender} about ${thread.student.firstName}`, body: excerpt(body || '📎'),
        data: { threadId, studentId: thread.studentId, from: sender },
      })),
    );
    return view;
  }

  async markRead(user: AuthUser, threadId: string, now = new Date()) {
    const { thread } = await this.access(user, threadId);
    // What the reader hasn't seen is what the other side wrote.
    const { count } = await this.prisma.chatMessage.updateMany({
      where: { threadId, readAt: null, senderId: user.role === Role.PARENT ? { not: thread.parentId } : thread.parentId },
      data: { readAt: now },
    });
    if (count) this.gateway.emit(await this.others(thread, user.id), 'read', { threadId, readerId: user.id, at: now.toISOString() });
    return { read: count };
  }

  async file(user: AuthUser, threadId: string, messageId: string) {
    await this.access(user, threadId);
    const m = await this.prisma.chatMessage.findFirst({ where: { id: messageId, threadId }, select: { fileData: true, fileType: true, fileName: true } });
    if (!m?.fileData || !m.fileType) throw new NotFoundException('No attachment.');
    return { mime: m.fileType, name: m.fileName, data: m.fileData };
  }
}

@RequiresModule('messaging')
@RequiresFeature('messaging', 'chat')
@Roles(Role.PARENT)
@Controller('parent')
export class ParentChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('children/:id/contacts')
  contacts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.contactsForParent(user, id);
  }

  @Get('threads')
  threads(@CurrentUser() user: AuthUser) {
    return this.chat.listForParent(user);
  }

  @Post('children/:id/threads')
  start(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StartThreadDto) {
    return this.chat.start(user, id, dto);
  }
}

@RequiresModule('messaging')
@RequiresFeature('messaging', 'chat')
@Roles(...STAFF, Role.PARENT)
@Controller('threads')
export class ThreadsController {
  constructor(private readonly chat: ChatService) {}

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query('scope') scope = 'mine') {
    if (!['mine', 'school'].includes(scope)) throw new BadRequestException('Unknown scope.');
    return this.chat.listForStaff(user, schoolId, scope);
  }

  @Roles(...STAFF)
  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string) {
    return this.chat.unreadCount(user, schoolId);
  }

  @Get(':id')
  header(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.header(user, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() q: MessagesQuery) {
    return this.chat.messages(user, id, q.before);
  }

  @Post(':id/messages')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto, @UploadedFile() file?: Express.Multer.File) {
    return this.chat.send(user, id, dto, file);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.markRead(user, id);
  }

  @Get(':id/messages/:messageId/file')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Res() res: Response) {
    sendAttachment(res, await this.chat.file(user, id, messageId));
  }
}
