import { Injectable } from '@nestjs/common';
import { normalizeText, type WorklistQuery } from '@lims/shared';
import type { Prisma } from '../../generated/prisma/client';
import { skipTake } from '../../core/common/pagination';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export const analysisItemInclude = {
  exam: { select: { turnaroundHours: true, section: { select: { id: true, name: true, displayOrder: true } } } },
  sample: {
    select: {
      number: true,
      collectedAt: true,
      receivedAt: true,
      hasReservation: true,
      sampleType: { select: { name: true } },
      nonConformities: { where: { decision: 'ACCEPTED_WITH_RESERVATION' }, orderBy: { recordedAt: 'asc' } },
    },
  },
  results: { orderBy: [{ displayOrder: 'asc' }, { parameterCode: 'asc' }] },
  alerts: { where: { cancelledAt: null }, include: { result: { select: { parameterName: true } } }, orderBy: { detectedAt: 'asc' } },
  amendments: { orderBy: { amendedAt: 'asc' } },
} as const satisfies Prisma.OrderItemInclude;

export type AnalysisItemRow = Prisma.OrderItemGetPayload<{ include: typeof analysisItemInclude }>;

export const orderForResultsInclude = {
  patient: true,
  prescriber: true,
  items: { include: analysisItemInclude, orderBy: { examCode: 'asc' } },
} as const satisfies Prisma.LabOrderInclude;

export type OrderForResultsRow = Prisma.LabOrderGetPayload<{ include: typeof orderForResultsInclude }>;

export const reportMetaSelect = {
  id: true,
  number: true,
  version: true,
  kind: true,
  sha256: true,
  issuedAt: true,
  issuedById: true,
  examCodes: true,
  orderItemIds: true,
  supersedes: { select: { number: true } },
} as const satisfies Prisma.ReportSelect;

export type ReportMetaRow = Prisma.ReportGetPayload<{ select: typeof reportMetaSelect }>;

/** Exam + paramètres actifs + valeurs de référence, pour initialiser les résultats d'un échantillon reçu. */
export const sampleForInitInclude = {
  order: { include: { patient: true } },
  items: {
    include: {
      exam: {
        include: {
          parameters: { where: { isActive: true }, include: { referenceRanges: true }, orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }] },
        },
      },
      results: { select: { id: true, enteredAt: true } },
    },
  },
} as const satisfies Prisma.SampleInclude;

@Injectable()
export class ResultsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockItem(id: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT 1 FROM "order_items" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }

  findItem(id: string, db: Db = this.prisma): Promise<AnalysisItemRow | null> {
    return db.orderItem.findUnique({ where: { id }, include: analysisItemInclude });
  }

  findItemWithOrder(id: string, db: Db = this.prisma) {
    return db.orderItem.findUnique({ where: { id }, include: { ...analysisItemInclude, order: { include: { patient: true } } } });
  }

  findOrder(id: string, db: Db = this.prisma): Promise<OrderForResultsRow | null> {
    return db.labOrder.findUnique({ where: { id }, include: orderForResultsInclude });
  }

  findSampleForInit(sampleId: string, db: Db) {
    return db.sample.findUnique({ where: { id: sampleId }, include: sampleForInitInclude });
  }

  listReports(orderId: string, db: Db = this.prisma): Promise<ReportMetaRow[]> {
    return db.report.findMany({ where: { orderId }, select: reportMetaSelect, orderBy: { version: 'desc' } });
  }

  latestReport(orderId: string, db: Db) {
    return db.report.findFirst({ where: { orderId }, orderBy: { version: 'desc' }, select: { id: true, number: true, version: true, kind: true, issuedAt: true } });
  }

  findReportPdf(id: string) {
    return this.prisma.report.findUnique({ where: { id }, select: { id: true, number: true, pdf: true, sha256: true, orderId: true } });
  }

  /**
   * Antériorités : dernier résultat validé du même patient pour chacun des paramètres, hors examens exclus.
   */
  async previousResults(patientId: string, parameterIds: string[], excludeItemIds: string[], db: Db = this.prisma) {
    if (parameterIds.length === 0) return new Map<string, { resultType: string; numericValue: Prisma.Decimal | null; qualifier: string | null; textValue: string | null; decimals: number | null; flag: string | null; validatedAt: Date }>();
    const rows = await db.testResult.findMany({
      where: {
        parameterId: { in: parameterIds },
        orderItemId: { notIn: excludeItemIds },
        orderItem: { analysisStatus: 'VALIDATED', order: { patientId } },
      },
      select: {
        parameterId: true,
        resultType: true,
        numericValue: true,
        qualifier: true,
        textValue: true,
        decimals: true,
        flag: true,
        orderItem: { select: { validatedAt: true } },
      },
      orderBy: { orderItem: { validatedAt: 'desc' } },
    });
    const map = new Map<string, { resultType: string; numericValue: Prisma.Decimal | null; qualifier: string | null; textValue: string | null; decimals: number | null; flag: string | null; validatedAt: Date }>();
    for (const r of rows) {
      if (!map.has(r.parameterId) && r.orderItem.validatedAt) {
        map.set(r.parameterId, { ...r, validatedAt: r.orderItem.validatedAt });
      }
    }
    return map;
  }

  /** @param sectionIds services visibles (null : tous) */
  async worklist(query: WorklistQuery, sectionIds: string[] | null) {
    const q = query.q?.trim();
    const tokens = q ? normalizeText(q).split(' ').filter(Boolean) : [];
    const where: Prisma.OrderItemWhereInput = {
      analysisStatus: query.status,
      order: { status: { not: 'CANCELLED' } },
      exam: sectionIds ? { sectionId: { in: sectionIds } } : undefined,
      ...(query.status === 'VALIDATED' ? { validatedAt: { gte: new Date(Date.now() - 72 * 3600_000) } } : {}),
      OR: q
        ? [
            { sample: { number: { contains: q } } },
            { order: { number: { contains: q, mode: 'insensitive' } } },
            { examCode: { contains: q, mode: 'insensitive' } },
            ...(tokens.length > 0 ? [{ order: { patient: { AND: tokens.map((t) => ({ searchName: { contains: t } })) } } }] : []),
          ]
        : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.orderItem.findMany({
        where,
        include: {
          order: { include: { patient: true } },
          exam: { select: { turnaroundHours: true, section: { select: { name: true } } } },
          sample: { select: { number: true, receivedAt: true, hasReservation: true } },
          _count: { select: { alerts: { where: { cancelledAt: null, acknowledgedAt: null } } } },
        },
        orderBy: [{ order: { priority: 'desc' } }, { sample: { receivedAt: 'asc' } }],
        ...skipTake(query),
      }),
      this.prisma.orderItem.count({ where }),
    ]);
  }
}
