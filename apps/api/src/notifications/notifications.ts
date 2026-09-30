import { Controller, Get, Global, Injectable, Logger, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';

export interface NewNotification {
  schoolId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}

/**
 * Parents receive everything as app push notifications. Rows are written here
 * first (they are also the in-app list); a push provider sends unsent rows.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(private readonly prisma: PrismaService) {}

  async notify(items: NewNotification[]) {
    if (!items.length) return 0;
    const { count } = await this.prisma.notification.createMany({ data: items });
    return count;
  }

  /**
   * Hands unsent notifications to the push provider. Until Firebase Cloud
   * Messaging is configured this only marks them sent and logs them.
   */
  async flush(limit = 500) {
    const pending = await this.prisma.notification.findMany({ where: { sentAt: null }, take: limit, orderBy: { createdAt: 'asc' } });
    for (const n of pending) this.logger.debug(`push → ${n.userId}: ${n.title} — ${n.body}`);
    if (pending.length) {
      await this.prisma.notification.updateMany({ where: { id: { in: pending.map((n) => n.id) } }, data: { sentAt: new Date() } });
    }
    return pending.length;
  }

  list(userId: string) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async markRead(userId: string, id: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
    if (!count) throw new NotFoundException('Notification not found.');
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
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
