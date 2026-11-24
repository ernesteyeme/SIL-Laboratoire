import { Injectable } from '@nestjs/common';
import { nameSearchKey, normalizeText, phoneKey, type ListPatientsQuery } from '@lims/shared';
import type { Patient, Prisma } from '../../generated/prisma/client';
import { skipTake, statusFilter } from '../../core/common/pagination';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export interface DuplicateRow {
  id: string;
  name_score: number;
  phone_match: boolean;
  external_match: boolean;
}

@Injectable()
export class PatientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, db: Db = this.prisma): Promise<Patient | null> {
    return db.patient.findUnique({ where: { id } });
  }

  findByIds(ids: string[]): Promise<Patient[]> {
    return this.prisma.patient.findMany({ where: { id: { in: ids } } });
  }

  async lockForUpdate(id: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT 1 FROM "patients" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }

  create(data: Prisma.PatientUncheckedCreateInput, db: Db): Promise<Patient> {
    return db.patient.create({ data });
  }

  update(id: string, data: Prisma.PatientUncheckedUpdateInput, db: Db): Promise<Patient> {
    return db.patient.update({ where: { id }, data });
  }

  /**
   * Recherche multi-critères : code patient exact, jetons du nom (ordre indifférent, sans accents),
   * téléphone (n'importe quel format) ou identifiant externe.
   */
  async findMany(query: ListPatientsQuery): Promise<[Patient[], number]> {
    const or: Prisma.PatientWhereInput[] = [];
    if (query.q) {
      const tokens = normalizeText(query.q).split(' ').filter(Boolean);
      if (tokens.length > 0) or.push({ AND: tokens.map((t) => ({ searchName: { contains: t } })) });
      or.push({ code: { equals: query.q.trim().toUpperCase() } });
      or.push({ externalId: { equals: query.q.trim(), mode: 'insensitive' } });
      const digits = query.q.replace(/\D/g, '');
      if (digits.length >= 4) {
        const key = phoneKey(digits) ?? digits;
        or.push({ phoneKey: { contains: key.slice(-Math.min(9, key.length)) } });
      }
    }
    const where: Prisma.PatientWhereInput = {
      isActive: statusFilter(query.status),
      sex: query.sex,
      OR: or.length > 0 ? or : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.patient.findMany({ where, orderBy: [{ createdAt: 'desc' }], ...skipTake(query) }),
      this.prisma.patient.count({ where }),
    ]);
  }

  /** Candidats doublons : nom proche (trigrammes, index GIN), même téléphone ou même identifiant externe. */
  findDuplicateRows(params: {
    lastName: string;
    middleName?: string | null;
    firstName?: string | null;
    phone?: string | null;
    externalId?: string | null;
    excludeId?: string;
  }): Promise<DuplicateRow[]> {
    const key = nameSearchKey(params.lastName, params.middleName, params.firstName);
    const phone = phoneKey(params.phone);
    const external = params.externalId?.trim() || null;
    const exclude = params.excludeId ?? '00000000-0000-0000-0000-000000000000';

    return this.prisma.$queryRaw<DuplicateRow[]>`
      SELECT "id",
             similarity("search_name", ${key})::float8                               AS name_score,
             (${phone}::text IS NOT NULL AND "phone_key" = ${phone}::text)              AS phone_match,
             (${external}::text IS NOT NULL AND lower("external_id") = lower(${external}::text)) AS external_match
      FROM "patients"
      WHERE "is_active" = true
        AND "id" <> ${exclude}::uuid
        AND (
              "search_name" % ${key}
           OR (${phone}::text IS NOT NULL AND "phone_key" = ${phone}::text)
           OR (${external}::text IS NOT NULL AND lower("external_id") = lower(${external}::text))
        )
      ORDER BY name_score DESC
      LIMIT 20
    `;
  }
}
