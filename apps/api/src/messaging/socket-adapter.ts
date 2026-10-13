import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/postgres-adapter';
import { MessageType } from 'socket.io-adapter';
import { Pool } from 'pg';
import type { ServerOptions } from 'socket.io';
import { allowedOrigins } from '../common/cors';

/**
 * The live-chat socket server, with the same browser origin rule as the REST API.
 *
 * With CHAT_ADAPTER=postgres, servers share their sockets through the database
 * (LISTEN/NOTIFY), so a message sent through one server reaches a phone connected
 * to another. The helper table is created here, outside Prisma, so the schema stays clean.
 */
export class SocketAdapter extends IoAdapter {
  private pool?: Pool;
  private announcing: NodeJS.Timeout[] = [];
  private readonly chatLog = new Logger('Chat');

  constructor(app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, { ...options, cors: { origin: allowedOrigins() } });
    if (process.env.CHAT_ADAPTER === 'postgres') {
      // Prisma's ?schema=… is not a Postgres setting.
      const url = new URL(process.env.DATABASE_URL ?? '');
      url.searchParams.delete('schema');
      this.pool = new Pool({ connectionString: url.toString() });
      this.pool.on('error', (e) => this.chatLog.warn(`chat database connection: ${e.message}`));
      void this.pool
        .query('CREATE TABLE IF NOT EXISTS socket_io_attachments (id bigserial UNIQUE, created_at timestamptz DEFAULT NOW(), payload bytea)')
        .catch((e: Error) => this.chatLog.error(`could not prepare the chat table: ${e.message}`));
      server.adapter(createAdapter(this.pool, { errorHandler: (e: Error) => this.chatLog.warn(`chat adapter: ${e.message}`) }));
      this.announceAgain(server.of('/').adapter);
    }
    return server;
  }

  /**
   * A new server announces itself when it is built, and the running ones answer. But its database listener is
   * not ready by then, so it can miss the answers and would only hear of the others at their next heartbeat,
   * up to five seconds later. Announcing again while the listener comes up makes it learn within a moment.
   */
  private announceAgain(adapter: unknown) {
    const announce = () => (adapter as { publish(message: { type: MessageType }): unknown }).publish({ type: MessageType.INITIAL_HEARTBEAT });
    for (const ms of [200, 600, 1500, 3000]) {
      const timer = setTimeout(announce, ms);
      timer.unref();
      this.announcing.push(timer);
    }
  }

  async dispose() {
    this.announcing.forEach(clearTimeout);
    await super.dispose();
    await this.pool?.end();
  }
}
