import { Injectable } from '@nestjs/common';
import type { QcRunsQuery } from '@lims/shared';
import type { Prisma } from '../../generated/prisma/client';
import { skipTake } from '../../core/common/pagination';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export const parameterRefSelect = {
  id: true,
  code: true,
  name: true,
  unit: true,
  decimals: true,
  resultType: true,
  isActive: true,
  exam: { select: { code: true, name: true, section: { select: { id: true, name: true } } } },
} satisfies Prisma.ExamParameterSelect;

export const targetInclude = {
  parameter: { select: parameterRefSelect },
  material: { select: { id: true, name: true, lotNumber: true, level: true, expiresOn: true, isActive: true } },
} satisfies Prisma.QcTargetInclude;

export const materialInclude = {
  section: { select: { id: true, name: true } },
  targets: { include: { parameter: { select: parameterRefSelect } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.QcMaterialInclude;

export const runInclude = {
  parameter: { select: parameterRefSelect },
  results: {
    include: { target: { select: { material: { select: { name: true, lotNumber: true, level: true } } } } },
    orderBy: { target: { material: { level: 'asc' } } },
  },
  qualityIssue: { select: { id: true, number: true, status: true } },
} satisfies Prisma.QcRunInclude;

export type ParameterRefRow = Prisma.ExamParameterGetPayload<{ select: typeof parameterRefSelect }>;
export type MaterialRow = Prisma.QcMaterialGetPayload<{ include: typeof materialInclude }>;
export type TargetRow = Prisma.QcTargetGetPayload<{ include: typeof targetInclude }>;
export type RunRow = Prisma.QcRunGetPayload<{ include: typeof runInclude }>;

@Injectable()
export class QcRepository {
  constructor(private readonly prisma: PrismaService) {}

  listMaterials(includeInactive: boolean): Promise<MaterialRow[]> {
    return this.prisma.qcMaterial.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: materialInclude,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { level: 'asc' }],
    });
  }

  findMaterial(id: string, db: Db = this.prisma): Promise<MaterialRow | null> {
    return db.qcMaterial.findUnique({ where: { id }, include: materialInclude });
  }

  findTarget(id: string, db: Db = this.prisma): Promise<TargetRow | null> {
    return db.qcTarget.findUnique({ where: { id }, include: targetInclude });
  }

  findParameter(id: string, db: Db = this.prisma): Promise<ParameterRefRow | null> {
    return db.examParameter.findUnique({ where: { id }, select: parameterRefSelect });
  }

  /** Verrou applicatif par paramètre : deux séries simultanées ne doivent pas s'évaluer sur le même historique. */
  async lockParameter(parameterId: string, db: Db): Promise<void> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'qc:' + parameterId}))`;
  }

  activeTargetsOf(parameterId: string, db: Db = this.prisma): Promise<TargetRow[]> {
    return db.qcTarget.findMany({ where: { parameterId, isActive: true, material: { isActive: true } }, include: targetInclude });
  }

  /** Dernière série retenue (non exclue) d'un paramètre. */
  lastRun(parameterId: string, db: Db = this.prisma) {
    return db.qcRun.findFirst({ where: { parameterId, excludedAt: null }, orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }] });
  }

  unresolvedRejected(parameterId: string, db: Db = this.prisma) {
    return db.qcRun.findFirst({ where: { parameterId, status: 'REJECTED', resolvedAt: null, excludedAt: null }, orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }] });
  }

  /** Scores z antérieurs retenus pour l'évaluation (ni exclus, ni rejetés), du plus récent au plus ancien. */
  async history(targetIds: string[], db: Db, take = 9): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    for (const targetId of targetIds) {
      const rows = await db.qcResult.findMany({
        where: { targetId, run: { excludedAt: null, status: { not: 'REJECTED' } } },
        // À heure égale (horodatage à la seconde des automates), l'ordre d'enregistrement départage.
        orderBy: [{ run: { performedAt: 'desc' } }, { run: { createdAt: 'desc' } }],
        take,
        select: { zScore: true },
      });
      map.set(targetId, rows.map((r) => r.zScore.toNumber()));
    }
    return map;
  }

  findRun(id: string, db: Db = this.prisma): Promise<RunRow | null> {
    return db.qcRun.findUnique({ where: { id }, include: runInclude });
  }

  listRuns(query: QcRunsQuery, period: { start?: Date; end?: Date }): Promise<[RunRow[], number]> {
    const where: Prisma.QcRunWhereInput = {
      parameterId: query.parameterId,
      status: query.status,
      ...(query.sectionId ? { parameter: { exam: { sectionId: query.sectionId } } } : {}),
      ...(query.unresolved ? { status: 'REJECTED', resolvedAt: null, excludedAt: null } : {}),
      ...(period.start || period.end ? { performedAt: { gte: period.start, lt: period.end } } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.qcRun.findMany({ where, include: runInclude, orderBy: { performedAt: 'desc' }, ...skipTake(query) }),
      this.prisma.qcRun.count({ where }),
    ]);
  }

  /** Paramètres disposant d'au moins une cible active (programme de CIQ). */
  parametersWithTargets(sectionId?: string) {
    return this.prisma.examParameter.findMany({
      where: {
        qcTargets: { some: { isActive: true, material: { isActive: true } } },
        ...(sectionId ? { exam: { sectionId } } : {}),
      },
      select: {
        ...parameterRefSelect,
        qcTargets: {
          where: { isActive: true, material: { isActive: true } },
          select: { id: true, mean: true, sd: true, material: { select: { name: true, lotNumber: true, level: true, expiresOn: true } } },
          orderBy: { material: { level: 'asc' } },
        },
      },
      orderBy: [{ exam: { section: { displayOrder: 'asc' } } }, { exam: { code: 'asc' } }, { displayOrder: 'asc' }],
    });
  }

  /** Dernière série non exclue de chaque paramètre. */
  latestRunsByParameter(parameterIds: string[], db: Db = this.prisma) {
    if (parameterIds.length === 0) return Promise.resolve([]);
    return db.qcRun.findMany({
      where: { parameterId: { in: parameterIds }, excludedAt: null },
      orderBy: [{ parameterId: 'asc' }, { performedAt: 'desc' }, { createdAt: 'desc' }],
      distinct: ['parameterId'],
      select: { id: true, parameterId: true, performedAt: true, status: true, resolvedAt: true },
    });
  }

  /** Paramètres ayant une série (non exclue) depuis l'instant donné. */
  async parametersRunSince(parameterIds: string[], since: Date): Promise<Set<string>> {
    if (parameterIds.length === 0) return new Set();
    const rows = await this.prisma.qcRun.findMany({
      where: { parameterId: { in: parameterIds }, excludedAt: null, performedAt: { gte: since } },
      distinct: ['parameterId'],
      select: { parameterId: true },
    });
    return new Set(rows.map((r) => r.parameterId));
  }

  targetPoints(targetId: string, period: { start: Date; end: Date }) {
    return this.prisma.qcResult.findMany({
      where: { targetId, run: { performedAt: { gte: period.start, lt: period.end } } },
      orderBy: [{ run: { performedAt: 'asc' } }, { run: { createdAt: 'asc' } }],
      take: 500,
      select: {
        value: true,
        zScore: true,
        status: true,
        violatedRules: true,
        run: { select: { id: true, performedAt: true, excludedAt: true, status: true } },
      },
    });
  }

  /** Dernière série acceptable (non rejetée, non exclue) antérieure à l'instant donné. */
  lastAcceptableBefore(parameterId: string, before: Date) {
    return this.prisma.qcRun.findFirst({
      where: { parameterId, excludedAt: null, status: { not: 'REJECTED' }, performedAt: { lt: before } },
      orderBy: { performedAt: 'desc' },
      select: { performedAt: true },
    });
  }

  firstAcceptableAfter(parameterId: string, after: Date) {
    return this.prisma.qcRun.findFirst({
      where: { parameterId, excludedAt: null, status: { not: 'REJECTED' }, performedAt: { gt: after } },
      orderBy: { performedAt: 'asc' },
      select: { performedAt: true },
    });
  }

  /** Résultats patients du paramètre saisis dans l'intervalle (à réévaluer après un CIQ rejeté). */
  patientResultsBetween(parameterId: string, from: Date, to: Date) {
    return this.prisma.testResult.findMany({
      where: { parameterId, enteredAt: { gt: from, lte: to } },
      orderBy: { enteredAt: 'asc' },
      take: 200,
      select: {
        numericValue: true,
        qualifier: true,
        textValue: true,
        decimals: true,
        resultType: true,
        enteredAt: true,
        orderItem: {
          select: {
            examCode: true,
            analysisStatus: true,
            order: { select: { id: true, number: true, patient: { select: { lastName: true, middleName: true, firstName: true } } } },
          },
        },
      },
    });
  }
}
