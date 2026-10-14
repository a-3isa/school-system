import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { allowedOrigins } from './common/cors';
import { SocketAdapter } from './messaging/socket-adapter';

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // Crests and photos are fetched by the dashboard from another origin, so they stay readable cross-origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // Lists are JSON and shrink about twentyfold; photos and PDFs are left as they are.
  app.use(compression());
  app.enableCors({ origin: allowedOrigins() });
  // Live chat: the socket server shares the HTTP server and the origin rule.
  app.useWebSocketAdapter(new SocketAdapter(app));
  return app;
}

async function bootstrap() {
  // Settings from apps/api/.env (WhatsApp, JWT secret, MQTT…); real environment variables win.
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env file: use the environment as it is */
  }
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error('Set JWT_SECRET to a random value of at least 32 characters before running in production.');
  }
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) {
  void bootstrap();
}
