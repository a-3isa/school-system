import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { allowedOrigins } from '../common/cors';

/** The live-chat socket server, with the same browser origin rule as the REST API. */
export class SocketAdapter extends IoAdapter {
  constructor(app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: { origin: allowedOrigins() } });
  }
}
