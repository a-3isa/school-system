import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors();
  return app;
}

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error('Set JWT_SECRET to a random value of at least 32 characters before running in production.');
  }
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) {
  void bootstrap();
}
