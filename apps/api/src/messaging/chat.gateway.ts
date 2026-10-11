import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
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
@WebSocketGateway({ path: '/api/socket.io', cors: { origin: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('Chat');
  /** How many sockets each signed-in user has open. */
  private readonly online = new Map<string, number>();
  private readonly who = new WeakMap<Socket, string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string' || !token) throw new Error('no token');
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(token);
      const user = await loadActiveUser(this.prisma, sub);
      if (!user?.schoolId || !(await schoolHas(this.prisma, user.schoolId, 'messaging', 'chat'))) throw new Error('not allowed');
      this.who.set(client, user.id);
      this.online.set(user.id, (this.online.get(user.id) ?? 0) + 1);
      await client.join(room(user.id));
    } catch (e) {
      this.logger.debug(`refused a connection: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const id = this.who.get(client);
    if (!id) return;
    const left = (this.online.get(id) ?? 1) - 1;
    if (left > 0) this.online.set(id, left);
    else this.online.delete(id);
  }

  isOnline(userId: string): boolean {
    return (this.online.get(userId) ?? 0) > 0;
  }

  /** Tells these users, wherever they are connected. */
  emit(userIds: string[], event: 'message' | 'read', payload: unknown) {
    if (!userIds.length || !this.server) return;
    this.server.to(userIds.map(room)).emit(event, payload);
  }
}
