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
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) {
  void bootstrap();
}
