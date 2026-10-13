import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { loadActiveUser, schoolHas } from '../auth/access.guard';

const room = (userId: string) => `user:${userId}`;

/**
 * Live delivery for parent–teacher chat. Messages are written only through the
 * REST routes (so every rule lives in one place); the server then pushes them
 * here to whoever is connected. A client that isn't connected is told by a
 * notification instead, and catches up by fetching the thread.
 */
@Injectable()
@WebSocketGateway({ path: '/api/socket.io' })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('Chat');
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string' || !token) throw new Error('no token');
      const claims = await this.jwt.verifyAsync<{ sub: string; iat?: number; sv?: number }>(token);
      const user = await loadActiveUser(this.prisma, claims);
      if (!user?.schoolId || !(await schoolHas(this.prisma, user.schoolId, 'messaging', 'chat'))) throw new Error('not allowed');
      await client.join(room(user.id));
    } catch (e) {
      this.logger.debug(`refused a connection: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }

  /** Is this person connected on any server? */
  async isOnline(userId: string): Promise<boolean> {
    if (!this.server) return false;
    return (await this.server.in(room(userId)).fetchSockets()).length > 0;
  }

  /** Closes this person's open chat connections on every server (they lost access or signed out). */
  disconnectUser(userId: string) {
    this.server?.in(room(userId)).disconnectSockets(true);
  }

  /** Tells these users, wherever they are connected. */
  emit(userIds: string[], event: 'message' | 'read', payload: unknown) {
    if (!userIds.length || !this.server) return;
    this.server.to(userIds.map(room)).emit(event, payload);
  }
}
