import { Injectable } from '@nestjs/common';
import type { LabSettings, Prisma } from '../../generated/prisma/client';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export const LAB_SETTINGS_ID = 1;

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(db: Db = this.prisma): Promise<LabSettings | null> {
    return db.labSettings.findUnique({ where: { id: LAB_SETTINGS_ID } });
  }

  async lockForUpdate(db: Db): Promise<void> {
    await db.$queryRaw`SELECT 1 FROM "lab_settings" WHERE "id" = ${LAB_SETTINGS_ID} FOR UPDATE`;
  }

  upsert(data: Omit<Prisma.LabSettingsUncheckedCreateInput, 'id'>, db: Db): Promise<LabSettings> {
    return db.labSettings.upsert({
      where: { id: LAB_SETTINGS_ID },
      create: { id: LAB_SETTINGS_ID, ...data },
      update: data,
    });
  }
}
