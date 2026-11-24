import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './core/config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(AppConfig);

  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
  Logger.log(`API LIMS démarrée sur http://localhost:${config.port}/api (${config.nodeEnv})`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Erreur au démarrage (configuration invalide, base inaccessible…)
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
