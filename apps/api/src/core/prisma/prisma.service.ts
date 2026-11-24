import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../generated/prisma/client';
import { AppConfig } from '../config/app-config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connexion à PostgreSQL établie.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** Client utilisable par les repositories : client principal ou client de transaction. */
export type Db = PrismaService | Prisma.TransactionClient;
