import { Injectable } from '@nestjs/common';
import { normalizeText, toCents, type ListCashSessionsQuery, type ListInvoicesQuery } from '@lims/shared';
import type { PaymentMethod, Prisma } from '../../generated/prisma/client';
import { skipTake } from '../../core/common/pagination';
import { parseIsoDate } from '@lims/shared';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export const invoiceListInclude = {
  order: { select: { id: true, number: true } },
  patient: true,
} as const satisfies Prisma.InvoiceInclude;

export const invoiceDetailInclude = {
  ...invoiceListInclude,
  lines: { orderBy: { label: 'asc' } },
  payments: { include: { cashSession: { select: { number: true } } }, orderBy: { receivedAt: 'asc' } },
} as const satisfies Prisma.InvoiceInclude;

export type InvoiceListRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceListInclude }>;
export type InvoiceDetailRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>;

@Injectable()
export class BillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lock(table: 'invoices' | 'payments' | 'cash_sessions', id: string, db: Db): Promise<void> {
    await db.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`, id);
  }

  // --- Factures ----------------------------------------------------------------

  findInvoice(id: string, db: Db = this.prisma): Promise<InvoiceDetailRow | null> {
    return db.invoice.findUnique({ where: { id }, include: invoiceDetailInclude });
  }

  findInvoiceByOrder(orderId: string, db: Db = this.prisma) {
    return db.invoice.findUnique({ where: { orderId } });
  }

  async listInvoices(query: ListInvoicesQuery): Promise<[InvoiceListRow[], number]> {
    const tokens = query.q ? normalizeText(query.q).split(' ').filter(Boolean) : [];
    const where: Prisma.InvoiceWhereInput = {
      status: query.outstanding ? { in: ['UNPAID', 'PARTIALLY_PAID'] } : query.status,
      OR: query.q
        ? [
            { number: { contains: query.q.trim(), mode: 'insensitive' } },
            { order: { number: { contains: query.q.trim(), mode: 'insensitive' } } },
            { patient: { code: { equals: query.q.trim().toUpperCase() } } },
            ...(tokens.length > 0 ? [{ patient: { AND: tokens.map((t) => ({ searchName: { contains: t } })) } }] : []),
          ]
        : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, include: invoiceListInclude, orderBy: { createdAt: 'desc' }, ...skipTake(query) }),
      this.prisma.invoice.count({ where }),
    ]);
  }

  createInvoice(data: Prisma.InvoiceUncheckedCreateInput, db: Db) {
    return db.invoice.create({ data });
  }

  updateInvoice(id: string, data: Prisma.InvoiceUncheckedUpdateInput, db: Db) {
    return db.invoice.update({ where: { id }, data });
  }

  createLines(data: Prisma.InvoiceLineCreateManyInput[], db: Db) {
    return db.invoiceLine.createMany({ data });
  }

  // --- Paiements ---------------------------------------------------------------

  findPayment(id: string, db: Db = this.prisma) {
    return db.payment.findUnique({ where: { id }, include: { cashSession: true } });
  }

  createPayment(data: Prisma.PaymentUncheckedCreateInput, db: Db) {
    return db.payment.create({ data, include: { cashSession: { select: { number: true } } } });
  }

  updatePayment(id: string, data: Prisma.PaymentUncheckedUpdateInput, db: Db) {
    return db.payment.update({ where: { id }, data });
  }

  /** Somme des paiements non annulés d'une facture, en chaîne décimale. */
  async sumActivePayments(invoiceId: string, db: Db): Promise<string> {
    const r = await db.payment.aggregate({ where: { invoiceId, cancelledAt: null }, _sum: { amount: true } });
    return r._sum.amount?.toFixed(2) ?? '0.00';
  }

  // --- Sessions de caisse --------------------------------------------------------

  findOpenSession(cashierId: string, db: Db = this.prisma) {
    return db.cashSession.findFirst({ where: { cashierId, status: 'OPEN' } });
  }

  findSession(id: string, db: Db = this.prisma) {
    return db.cashSession.findUnique({ where: { id } });
  }

  createSession(data: Prisma.CashSessionUncheckedCreateInput, db: Db) {
    return db.cashSession.create({ data });
  }

  updateSession(id: string, data: Prisma.CashSessionUncheckedUpdateInput, db: Db) {
    return db.cashSession.update({ where: { id }, data });
  }

  async listSessions(query: ListCashSessionsQuery, cashierId?: string) {
    const where: Prisma.CashSessionWhereInput = {
      cashierId,
      openedAt:
        query.from || query.to
          ? {
              gte: query.from ? parseIsoDate(query.from) : undefined,
              lt: query.to ? new Date(parseIsoDate(query.to).getTime() + 24 * 3600_000) : undefined,
            }
          : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.cashSession.findMany({ where, orderBy: { openedAt: 'desc' }, ...skipTake(query) }),
      this.prisma.cashSession.count({ where }),
    ]);
  }

  /** Totaux par moyen de paiement et devise remise (paiements non annulés), monnaie rendue et nombre d'annulations. */
  async sessionTotals(
    sessionId: string,
    db: Db = this.prisma,
  ): Promise<{
    byMethod: { method: PaymentMethod; currency: string; count: number; tendered: string; applied: string }[];
    cancelledCount: number;
    changeCents: number;
  }> {
    const [groups, cancelledCount, change] = await Promise.all([
      db.payment.groupBy({
        by: ['method', 'currency'],
        where: { cashSessionId: sessionId, cancelledAt: null },
        _sum: { amount: true, tenderedAmount: true },
        _count: { _all: true },
        orderBy: [{ method: 'asc' }, { currency: 'asc' }],
      }),
      db.payment.count({ where: { cashSessionId: sessionId, cancelledAt: { not: null } } }),
      db.payment.aggregate({ where: { cashSessionId: sessionId, cancelledAt: null }, _sum: { changeAmount: true } }),
    ]);
    return {
      byMethod: groups.map((g) => ({
        method: g.method,
        currency: g.currency,
        count: g._count._all,
        tendered: g._sum.tenderedAmount?.toFixed(2) ?? '0.00',
        applied: g._sum.amount?.toFixed(2) ?? '0.00',
      })),
      cancelledCount,
      changeCents: toCents(change._sum.changeAmount?.toFixed(2) ?? '0'),
    };
  }

  sessionPayments(sessionId: string) {
    return this.prisma.payment.findMany({
      where: { cashSessionId: sessionId },
      include: {
        cashSession: { select: { number: true } },
        invoice: { select: { number: true, order: { select: { number: true } }, patient: true } },
      },
      orderBy: { receivedAt: 'asc' },
    });
  }
}
