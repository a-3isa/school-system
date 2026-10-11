import { Body, Controller, Delete, Get, Global, Injectable, Logger, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { FcmSender, PushMessage, PushSender } from './push';
import { Lang, pushBody } from './push-text';

export interface NewNotification {
  schoolId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}

export class RegisterDeviceDto {
  @IsString() @MinLength(20) @MaxLength(4096) token: string;
  @IsIn(['android', 'ios']) platform: 'android' | 'ios';
  @IsOptional() @IsIn(['en', 'ar']) lang?: Lang;
}

/** A phone keeps at most this many registrations per parent; the least recently seen go first. */
export const MAX_DEVICES = 10;
/** A notification that still can't be delivered after this long is let go. */
const GIVE_UP_AFTER_MS = 24 * 3600_000;

/**
 * Parents receive everything as app push notifications. Rows are written here
 * first (they are also the in-app list); the push sender delivers unsent rows.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushSender,
  ) {}

  async notify(items: NewNotification[]) {
    if (!items.length) return 0;
    const { count } = await this.prisma.notification.createMany({ data: items });
    return count;
  }

  /**
   * Delivers unsent notifications to the parents' phones through Firebase, in
   * the language each app is in. Without Firebase configured it only marks them
   * sent and logs them. A notification that couldn't be delivered because the
   * network failed stays unsent and is tried again; one for a phone that no
   * longer has the app is dropped along with that phone's registration.
   */
  async flush(limit = 500, now = new Date()) {
    await this.prisma.notification.updateMany({ where: { sentAt: null, createdAt: { lt: new Date(now.getTime() - GIVE_UP_AFTER_MS) } }, data: { sentAt: now } });
    const pending = await this.prisma.notification.findMany({
      where: { sentAt: null },
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { role: true, deviceTokens: true, school: { select: { name: true, nameAr: true } } } } },
    });
    if (!pending.length) return 0;

    if (!this.push.enabled) {
      for (const n of pending) this.logger.debug(`push → ${n.userId}: ${n.title} — ${n.body}`);
      await this.prisma.notification.updateMany({ where: { id: { in: pending.map((n) => n.id) } }, data: { sentAt: now } });
      return pending.length;
    }

    // The child each one is about, for the name and for Arabic that agrees with their gender.
    const studentIds = [...new Set(pending.map((n) => (n.data as { studentId?: string } | null)?.studentId).filter((id): id is string => !!id))];
    const students = new Map((await this.prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstName: true, gender: true } })).map((s) => [s.id, s]));

    const messages: (PushMessage & { notificationId: string })[] = [];
    const settled = new Set<string>(); // nothing to send for these
    for (const n of pending) {
      const tokens = n.user.role === Role.PARENT ? n.user.deviceTokens : [];
      if (!tokens.length) {
        settled.add(n.id);
        continue;
      }
      const data = (n.data ?? {}) as Record<string, unknown>;
      const child = students.get(String(data.studentId ?? ''));
      for (const t of tokens) {
        const lang: Lang = t.lang === 'ar' ? 'ar' : 'en';
        const text = pushBody(n.type, { lang, name: child?.firstName, gender: child?.gender, data });
        const school = n.user.school;
        messages.push({
          notificationId: n.id,
          token: t.token,
          title: (lang === 'ar' ? school?.nameAr : null) || school?.name || 'School',
          body: text ?? n.title,
          data: { type: n.type, notificationId: n.id, ...Object.fromEntries(Object.entries(data).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, String(v)])) },
        });
      }
    }

    let outcomes: Awaited<ReturnType<PushSender['send']>> = [];
    try {
      outcomes = await this.push.send(messages);
    } catch (e) {
      // Firebase couldn't be reached: leave them unsent and try again on the next round.
      this.logger.error(`push failed, will retry: ${(e as Error).message}`);
      outcomes = [];
      messages.length = 0;
    }

    const byToken = new Map(outcomes.map((o) => [o.token, o]));
    const delivered = new Set(settled);
    for (const n of pending) {
      const mine = messages.filter((m) => m.notificationId === n.id).map((m) => byToken.get(m.token));
      if (!mine.length) continue;
      // Done when it reached a phone, or every phone that failed is gone for good.
      if (mine.some((o) => o?.ok) || mine.every((o) => o?.invalid)) delivered.add(n.id);
    }
    const gone = outcomes.filter((o) => o.invalid).map((o) => o.token);
    if (gone.length) await this.prisma.deviceToken.deleteMany({ where: { token: { in: gone } } });
    if (delivered.size) await this.prisma.notification.updateMany({ where: { id: { in: [...delivered] } }, data: { sentAt: now } });
    return delivered.size;
  }

  list(userId: string) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async markRead(userId: string, id: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
    if (!count) throw new NotFoundException('Notification not found.');
    return { ok: true };
  }

  // ---- phones ----------------------------------------------------------------

  /** Remembers a phone for this parent (the app calls it at every start, and when the language or token changes). */
  async registerDevice(userId: string, dto: RegisterDeviceDto, now = new Date()) {
    // A phone that changes hands moves with its token, so it never rings for the previous parent.
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform, lang: dto.lang ?? 'en', lastSeenAt: now },
      update: { userId, platform: dto.platform, ...(dto.lang ? { lang: dto.lang } : {}), lastSeenAt: now },
    });
    const extra = await this.prisma.deviceToken.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' }, skip: MAX_DEVICES, select: { id: true } });
    if (extra.length) await this.prisma.deviceToken.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
    return { ok: true };
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { ok: true };
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  /** The parent's app tells the server which phone to push to. */
  @Roles(Role.PARENT)
  @Post('devices')
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(user.id, dto);
  }

  @Roles(Role.PARENT)
  @Delete('devices/:token')
  remove(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.notifications.removeDevice(user.id, token);
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, { provide: PushSender, useClass: FcmSender }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
