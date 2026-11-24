import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from './core/audit/audit.module';
import { CommonModule } from './core/common/common.module';
import { AppConfig } from './core/config/app-config';
import { AllExceptionsFilter } from './core/errors/all-exceptions.filter';
import { PrismaModule } from './core/prisma/prisma.module';
import { JwtAuthGuard } from './core/security/jwt-auth.guard';
import { RolesGuard } from './core/security/roles.guard';
import { SecurityModule } from './core/security/security.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrdersModule } from './modules/orders/orders.module';
import { HealthController } from './modules/health/health.controller';
import { PatientsModule } from './modules/patients/patients.module';
import { PrescribersModule } from './modules/prescribers/prescribers.module';
import { QualityModule } from './modules/quality/quality.module';
import { InstrumentsModule } from './modules/instruments/instruments.module';
import { InteropModule } from './modules/interop/interop.module';
import { SetupModule } from './modules/setup/setup.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

@Global()
@Module({
  providers: [AppConfig],
  exports: [AppConfig],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => {
          const incoming = req.headers['x-request-id'];
          return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
        },
        setup: (cls, req: Request, res: Response) => {
          cls.set('ip', req.ip);
          cls.set('userAgent', req.headers['user-agent']);
          res.setHeader('X-Request-Id', cls.getId());
        },
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CommonModule,
    SecurityModule,
    AuditModule,
    UsersModule,
    AuthModule,
    SettingsModule,
    PatientsModule,
    PrescribersModule,
    CatalogModule,
    BillingModule,
    OrdersModule,
    QualityModule,
    InstrumentsModule,
    InteropModule,
    SetupModule,
  ],
  controllers: [HealthController],
  providers: [
    // L'ordre d'enregistrement des guards globaux est leur ordre d'exécution.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
