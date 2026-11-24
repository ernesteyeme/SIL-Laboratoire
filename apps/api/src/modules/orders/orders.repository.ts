import { Injectable } from '@nestjs/common';
import { normalizeText, parseIsoDate, type ListOrdersQuery, type ListSamplesQuery } from '@lims/shared';
import type { Prisma } from '../../generated/prisma/client';
import { skipTake } from '../../core/common/pagination';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export const sampleInclude = {
  sampleType: { select: { id: true, code: true, name: true, container: true, instructions: true } },
  items: { select: { examCode: true }, orderBy: { examCode: 'asc' } },
  nonConformities: { orderBy: { recordedAt: 'asc' } },
  replaces: { select: { number: true } },
  replacedBy: { select: { number: true } },
} as const satisfies Prisma.SampleInclude;

export const orderListInclude = {
  patient: true,
  prescriber: true,
  items: { select: { examCode: true }, orderBy: { examCode: 'asc' } },
  invoice: { select: { status: true } },
} as const satisfies Prisma.LabOrderInclude;

export const orderDetailInclude = {
  patient: true,
  prescriber: true,
  items: {
    include: {
      exam: { select: { turnaroundHours: true, patientInstructions: true } },
      sample: { select: { number: true } },
    },
    orderBy: { examCode: 'asc' },
  },
  samples: { include: sampleInclude, orderBy: { createdAt: 'asc' } },
  invoice: true,
} as const satisfies Prisma.LabOrderInclude;

export const sampleContextInclude = {
  ...sampleInclude,
  order: { include: { patient: true } },
} as const satisfies Prisma.SampleInclude;

export type SampleRow = Prisma.SampleGetPayload<{ include: typeof sampleInclude }>;
export type OrderListRow = Prisma.LabOrderGetPayload<{ include: typeof orderListInclude }>;
export type OrderDetailRow = Prisma.LabOrderGetPayload<{ include: typeof orderDetailInclude }>;
export type SampleContextRow = Prisma.SampleGetPayload<{ include: typeof sampleContextInclude }>;

const DAY_MS = 24 * 3600_000;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lock(table: 'lab_orders' | 'samples', id: string, db: Db): Promise<void> {
    await db.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`, id);
  }

  // --- Demandes ----------------------------------------------------------------

  findOrder(id: string, db: Db = this.prisma): Promise<OrderDetailRow | null> {
    return db.labOrder.findUnique({ where: { id }, include: orderDetailInclude });
  }

  async listOrders(query: ListOrdersQuery): Promise<[OrderListRow[], number]> {
    const tokens = query.q ? normalizeText(query.q).split(' ').filter(Boolean) : [];
    const where: Prisma.LabOrderWhereInput = {
      status: query.status,
      priority: query.priority,
      patientId: query.patientId,
      createdAt:
        query.from || query.to
          ? {
              gte: query.from ? parseIsoDate(query.from) : undefined,
              lt: query.to ? new Date(parseIsoDate(query.to).getTime() + DAY_MS) : undefined,
            }
          : undefined,
      OR: query.q
        ? [
            { number: { contains: query.q.trim(), mode: 'insensitive' } },
            { patient: { code: { equals: query.q.trim().toUpperCase() } } },
            { samples: { some: { number: query.q.trim() } } },
            ...(tokens.length > 0 ? [{ patient: { AND: tokens.map((t) => ({ searchName: { contains: t } })) } }] : []),
          ]
        : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.labOrder.findMany({
        where,
        include: orderListInclude,
        orderBy: [{ createdAt: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.labOrder.count({ where }),
    ]);
  }

  createOrder(data: Prisma.LabOrderUncheckedCreateInput, db: Db) {
    return db.labOrder.create({ data });
  }

  updateOrder(id: string, data: Prisma.LabOrderUncheckedUpdateInput, db: Db) {
    return db.labOrder.update({ where: { id }, data });
  }

  createItem(data: Prisma.OrderItemUncheckedCreateInput, db: Db) {
    return db.orderItem.create({ data });
  }

  /** États des échantillons d'une demande, pour recalculer son statut. */
  sampleStates(orderId: string, db: Db) {
    return db.sample.findMany({ where: { orderId }, select: { status: true, _count: { select: { items: true } } } });
  }

  // --- Échantillons ---------------------------------------------------------------

  createSample(data: Prisma.SampleUncheckedCreateInput, db: Db) {
    return db.sample.create({ data });
  }

  updateSample(id: string, data: Prisma.SampleUncheckedUpdateInput, db: Db) {
    return db.sample.update({ where: { id }, data });
  }

  moveItems(fromSampleId: string, toSampleId: string, db: Db) {
    return db.orderItem.updateMany({ where: { sampleId: fromSampleId }, data: { sampleId: toSampleId } });
  }

  createNonConformity(data: Prisma.NonConformityUncheckedCreateInput, db: Db) {
    return db.nonConformity.create({ data });
  }

  findSampleContext(where: Prisma.SampleWhereUniqueInput, db: Db = this.prisma): Promise<SampleContextRow | null> {
    return db.sample.findUnique({ where, include: sampleContextInclude });
  }

  async listSamples(query: ListSamplesQuery): Promise<[SampleContextRow[], number]> {
    const q = query.q?.trim();
    const tokens = q ? normalizeText(q).split(' ').filter(Boolean) : [];
    const where: Prisma.SampleWhereInput = {
      status: query.status,
      order: { status: { not: 'CANCELLED' } },
      // Un échantillon refusé déjà remplacé n'est plus « à traiter ».
      ...(query.status === 'REJECTED' ? { replacedBy: { is: null } } : {}),
      OR: q
        ? [
            { number: { contains: q } },
            { order: { number: { contains: q, mode: 'insensitive' } } },
            { order: { patient: { code: { equals: q.toUpperCase() } } } },
            ...(tokens.length > 0 ? [{ order: { patient: { AND: tokens.map((t) => ({ searchName: { contains: t } })) } } }] : []),
          ]
        : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.sample.findMany({
        where,
        include: sampleContextInclude,
        // Urgences d'abord, puis les plus anciens.
        orderBy: [{ order: { priority: 'desc' } }, { createdAt: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.sample.count({ where }),
    ]);
  }
}
