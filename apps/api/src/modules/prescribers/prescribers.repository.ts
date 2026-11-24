import { Injectable } from '@nestjs/common';
import { normalizeText, type ListPrescribersQuery } from '@lims/shared';
import type { Prescriber, Prisma } from '../../generated/prisma/client';
import { skipTake, statusFilter } from '../../core/common/pagination';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

@Injectable()
export class PrescribersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, db: Db = this.prisma): Promise<Prescriber | null> {
    return db.prescriber.findUnique({ where: { id } });
  }

  findByLicense(licenseNumber: string, db: Db = this.prisma): Promise<Prescriber | null> {
    return db.prescriber.findUnique({ where: { licenseNumber } });
  }

  async lockForUpdate(id: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT 1 FROM "prescribers" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }

  create(data: Prisma.PrescriberUncheckedCreateInput, db: Db): Promise<Prescriber> {
    return db.prescriber.create({ data });
  }

  update(id: string, data: Prisma.PrescriberUncheckedUpdateInput, db: Db): Promise<Prescriber> {
    return db.prescriber.update({ where: { id }, data });
  }

  async findMany(query: ListPrescribersQuery): Promise<[Prescriber[], number]> {
    const tokens = query.q ? normalizeText(query.q).split(' ').filter(Boolean) : [];
    const where: Prisma.PrescriberWhereInput = {
      isActive: statusFilter(query.status),
      OR: query.q
        ? [
            ...(tokens.length > 0 ? [{ AND: tokens.map((t) => ({ searchName: { contains: t } })) }] : []),
            { facility: { contains: query.q, mode: 'insensitive' as const } },
            { licenseNumber: { equals: query.q.trim(), mode: 'insensitive' as const } },
          ]
        : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.prescriber.findMany({ where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], ...skipTake(query) }),
      this.prisma.prescriber.count({ where }),
    ]);
  }
}
