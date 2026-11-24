import { HttpStatus, Injectable } from '@nestjs/common';
import {
  computeInvoiceTotals,
  ERROR_CODES,
  fromCents,
  MAX_CASHIER_DISCOUNT_PERCENT,
  toCents,
  type DiscountInput,
  type InvoiceDetailDto,
  type InvoiceListItemDto,
  type ListInvoicesQuery,
  type Paginated,
} from '@lims/shared';
import type { Invoice } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, DomainException, NotFoundError } from '../../core/errors/domain.exception';
import { NumberingService } from '../../core/numbering/numbering.service';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { BillingRepository, type InvoiceDetailRow } from './billing.repository';
import { toInvoiceDetail, toInvoiceListItem } from './billing.mapper';

export interface InvoiceLineSource {
  orderItemId: string;
  label: string;
  amount: string;
}

const money = (d: { toFixed(dp: number): string }) => d.toFixed(2);

export function invoiceAuditView(i: Invoice) {
  return {
    number: i.number,
    status: i.status,
    totalAmount: money(i.totalAmount),
    discountAmount: money(i.discountAmount),
    discountReason: i.discountReason,
    payerName: i.payerName,
    coveragePercent: i.coveragePercent,
    thirdPartyAmount: money(i.thirdPartyAmount),
    patientAmount: money(i.patientAmount),
    paidAmount: money(i.paidAmount),
  };
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: BillingRepository,
    private readonly numbering: NumberingService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListInvoicesQuery): Promise<Paginated<InvoiceListItemDto>> {
    const [rows, total] = await this.repo.listInvoices(query);
    return toPage(rows.map(toInvoiceListItem), total, query);
  }

  async get(id: string): Promise<InvoiceDetailDto> {
    return this.toDetail(await this.getOrThrow(id));
  }

  /** Appelé par la création d'une demande, dans la même transaction. */
  async createForOrder(
    tx: Db,
    params: { orderId: string; patientId: string; lines: InvoiceLineSource[]; payerName: string | null; coveragePercent: number; timeZone: string },
  ): Promise<Invoice> {
    const totals = computeInvoiceTotals({
      lineCents: params.lines.map((l) => toCents(l.amount)),
      discountCents: 0,
      coveragePercent: params.coveragePercent,
      paidCents: 0,
    });
    const invoice = await this.repo.createInvoice(
      {
        number: await this.numbering.invoiceNumber(tx, params.timeZone),
        orderId: params.orderId,
        patientId: params.patientId,
        totalAmount: fromCents(totals.totalCents),
        payerName: params.payerName,
        coveragePercent: params.coveragePercent,
        thirdPartyAmount: fromCents(totals.thirdPartyCents),
        patientAmount: fromCents(totals.patientCents),
        status: totals.status,
      },
      tx,
    );
    await this.repo.createLines(
      params.lines.map((l) => ({ invoiceId: invoice.id, orderItemId: l.orderItemId, label: l.label, amount: l.amount })),
      tx,
    );
    await this.audit.record(tx, { action: 'CREATE', entity: 'Invoice', entityId: invoice.id, after: invoiceAuditView(invoice) });
    return invoice;
  }

  /** Recalcule part patient / part tiers / statut à partir des lignes, de la remise et des paiements. */
  async recompute(tx: Db, invoiceId: string, changes: { discountCents?: number; discountReason?: string | null } = {}): Promise<Invoice> {
    const current = await this.repo.findInvoice(invoiceId, tx);
    if (!current) throw new NotFoundError('Facture', invoiceId);
    const paid = await this.repo.sumActivePayments(invoiceId, tx);
    const totals = computeInvoiceTotals({
      lineCents: current.lines.map((l) => toCents(money(l.amount))),
      discountCents: changes.discountCents ?? toCents(money(current.discountAmount)),
      coveragePercent: current.coveragePercent,
      paidCents: toCents(paid),
      cancelled: current.status === 'CANCELLED',
    });
    return this.repo.updateInvoice(
      invoiceId,
      {
        totalAmount: fromCents(totals.totalCents),
        discountAmount: fromCents(totals.discountCents),
        discountReason: changes.discountReason === undefined ? undefined : changes.discountReason,
        thirdPartyAmount: fromCents(totals.thirdPartyCents),
        patientAmount: fromCents(totals.patientCents),
        paidAmount: paid,
        status: totals.status,
      },
      tx,
    );
  }

  async applyDiscount(id: string, input: DiscountInput, actor: RequestUser): Promise<InvoiceDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.repo.lock('invoices', id, tx);
      const current = await this.getOrThrow(id, tx);
      if (current.status === 'CANCELLED') throw new BusinessRuleError('INVOICE_CANCELLED', 'Cette facture est annulée.');

      const totalCents = toCents(money(current.totalAmount));
      const discountCents = toCents(input.discountAmount);
      if (discountCents > totalCents) {
        throw new BusinessRuleError('DISCOUNT_EXCEEDS_TOTAL', 'La remise ne peut pas dépasser le montant total.');
      }
      const percent = totalCents === 0 ? 0 : (discountCents / totalCents) * 100;
      if (percent > MAX_CASHIER_DISCOUNT_PERCENT && !actor.roles.includes('ADMIN')) {
        throw new DomainException(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.ACCESS_DENIED,
          `Une remise supérieure à ${MAX_CASHIER_DISCOUNT_PERCENT} % doit être accordée par un administrateur.`,
          { rule: 'DISCOUNT_ADMIN_ONLY' },
        );
      }
      const projected = computeInvoiceTotals({
        lineCents: current.lines.map((l) => toCents(money(l.amount))),
        discountCents,
        coveragePercent: current.coveragePercent,
        paidCents: toCents(money(current.paidAmount)),
      });
      if (projected.balanceCents < 0) {
        throw new BusinessRuleError(
          'DISCOUNT_BELOW_PAID',
          'Avec cette remise, la part patient deviendrait inférieure au montant déjà encaissé. Annulez d’abord un paiement.',
        );
      }

      const next = await this.recompute(tx, id, { discountCents, discountReason: discountCents === 0 ? null : input.reason });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Invoice',
        entityId: id,
        before: invoiceAuditView(current),
        after: invoiceAuditView(next),
        reason: `Remise : ${input.reason}`,
      });
    });
    return this.get(id);
  }

  /** Annulation de la facture lors de l'annulation de la demande (même transaction). */
  async cancelForOrder(tx: Db, orderId: string, reason: string): Promise<void> {
    const invoice = await this.repo.findInvoiceByOrder(orderId, tx);
    if (!invoice) return;
    await this.repo.lock('invoices', invoice.id, tx);
    const paid = await this.repo.sumActivePayments(invoice.id, tx);
    if (toCents(paid) > 0) {
      throw new BusinessRuleError(
        'ORDER_HAS_PAYMENTS',
        'Des paiements ont été encaissés sur cette demande : faites-les annuler par un administrateur avant d’annuler la demande.',
      );
    }
    const next = await this.repo.updateInvoice(invoice.id, { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason }, tx);
    await this.audit.record(tx, {
      action: 'DELETE',
      entity: 'Invoice',
      entityId: invoice.id,
      before: invoiceAuditView(invoice),
      after: invoiceAuditView(next),
      reason,
    });
  }

  async getOrThrow(id: string, db: Db = this.prisma): Promise<InvoiceDetailRow> {
    const invoice = await this.repo.findInvoice(id, db);
    if (!invoice) throw new NotFoundError('Facture', id);
    return invoice;
  }

  async toDetail(invoice: InvoiceDetailRow): Promise<InvoiceDetailDto> {
    const names = await this.lab.userNames(invoice.payments.map((p) => p.receivedById));
    return toInvoiceDetail(invoice, names);
  }
}
