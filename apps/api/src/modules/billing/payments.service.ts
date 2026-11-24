import { Injectable } from '@nestjs/common';
import {
  computeInvoiceTotals,
  fromCents,
  PAYMENT_METHOD_LABELS,
  secondaryCurrencyFor,
  toCents,
  type CancelPaymentInput,
  type InvoiceDetailDto,
  type PaymentInput,
  type ReceiptDto,
} from '@lims/shared';
import type { Payment } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, NotFoundError } from '../../core/errors/domain.exception';
import { NumberingService } from '../../core/numbering/numbering.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BillingRepository } from './billing.repository';
import { toPaymentDto } from './billing.mapper';
import { ExchangeRatesService } from './exchange-rates.service';
import { invoiceAuditView, InvoicesService } from './invoices.service';
import { settleTender } from './tender';

const money = (d: { toFixed(dp: number): string }) => d.toFixed(2);

function paymentAuditView(p: Payment) {
  return {
    number: p.number,
    invoiceId: p.invoiceId,
    cashSessionId: p.cashSessionId,
    amount: money(p.amount),
    currency: p.currency,
    tenderedAmount: money(p.tenderedAmount),
    exchangeRate: p.exchangeRate ? p.exchangeRate.toFixed(4) : null,
    changeAmount: money(p.changeAmount),
    method: p.method,
    reference: p.reference,
    receivedById: p.receivedById,
    cancelledAt: p.cancelledAt,
    cancellationReason: p.cancellationReason,
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: BillingRepository,
    private readonly invoices: InvoicesService,
    private readonly numbering: NumberingService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
    private readonly rates: ExchangeRatesService,
  ) {}

  /**
   * Encaissement sur la session de caisse ouverte de l'utilisateur.
   * Montant remis dans la devise de base ou la devise secondaire (taux du jour figé) ;
   * en espèces, l'excédent est rendu en devise de base.
   */
  async pay(invoiceId: string, input: PaymentInput, actor: RequestUser): Promise<{ invoice: InvoiceDetailDto; paymentId: string }> {
    const paymentId = await this.prisma.$transaction(async (tx) => {
      const session = await this.repo.findOpenSession(actor.id, tx);
      if (!session) {
        throw new BusinessRuleError('NO_OPEN_CASH_SESSION', 'Ouvrez votre session de caisse avant d’encaisser.');
      }
      await this.repo.lock('cash_sessions', session.id, tx);
      await this.repo.lock('invoices', invoiceId, tx);
      const invoice = await this.invoices.getOrThrow(invoiceId, tx);
      if (invoice.status === 'CANCELLED') throw new BusinessRuleError('INVOICE_CANCELLED', 'Cette facture est annulée.');

      const currency = input.currency ?? session.baseCurrency;
      if (currency !== session.baseCurrency && currency !== session.secondaryCurrency) {
        throw new BusinessRuleError(
          'CURRENCY_NOT_ACCEPTED',
          `Devise ${currency} non acceptée sur cette session (acceptées : ${[session.baseCurrency, session.secondaryCurrency].filter(Boolean).join(', ')}).`,
        );
      }
      const rate = currency === session.baseCurrency ? null : await this.rates.today(tx);

      const paidCents = toCents(await this.repo.sumActivePayments(invoiceId, tx));
      const totals = computeInvoiceTotals({
        lineCents: invoice.lines.map((l) => toCents(money(l.amount))),
        discountCents: toCents(money(invoice.discountAmount)),
        coveragePercent: invoice.coveragePercent,
        paidCents,
      });
      const settled = settleTender({
        tenderedCents: toCents(input.amount),
        currency,
        baseCurrency: session.baseCurrency,
        cdfPerUsd: rate ? rate.cdfPerUsd.toFixed(4) : null,
        balanceCents: totals.balanceCents,
        method: input.method,
      });
      if (!settled.ok) {
        switch (settled.rule) {
          case 'ALREADY_PAID':
            throw new BusinessRuleError('ALREADY_PAID', 'Cette facture est déjà entièrement payée.');
          case 'RATE_REQUIRED':
            throw new BusinessRuleError(
              'RATE_NOT_SET',
              'Le taux de change du jour n’a pas été saisi : un administrateur ou le comptable doit le renseigner avant tout paiement en devise.',
            );
          case 'AMOUNT_EXCEEDS_BALANCE':
            throw new BusinessRuleError(
              'AMOUNT_EXCEEDS_BALANCE',
              `Le montant (${fromCents(settled.convertedCents ?? 0)} ${session.baseCurrency}) dépasse le reste à payer (${fromCents(totals.balanceCents)} ${session.baseCurrency}). Aucune monnaie ne peut être rendue pour ce moyen de paiement.`,
            );
        }
      }

      const settings = await this.lab.settings(tx);
      const payment = await this.repo.createPayment(
        {
          number: await this.numbering.receiptNumber(tx, settings.timezone),
          invoiceId,
          cashSessionId: session.id,
          amount: fromCents(settled.appliedCents),
          currency,
          tenderedAmount: fromCents(toCents(input.amount)),
          exchangeRate: rate ? rate.cdfPerUsd : null,
          changeAmount: fromCents(settled.changeCents),
          method: input.method,
          reference: input.reference ?? null,
          receivedById: actor.id,
        },
        tx,
      );
      const next = await this.invoices.recompute(tx, invoiceId);
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'Payment',
        entityId: payment.id,
        after: paymentAuditView(payment),
        reason: `Encaissement ${PAYMENT_METHOD_LABELS[input.method]} ${fromCents(toCents(input.amount))} ${currency} sur ${invoice.number} (session ${session.number})${
          rate ? `, taux ${rate.cdfPerUsd.toFixed(4)} CDF/USD` : ''
        }${settled.changeCents > 0 ? `, monnaie rendue ${fromCents(settled.changeCents)} ${session.baseCurrency}` : ''}`,
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Invoice',
        entityId: invoiceId,
        before: invoiceAuditView(invoice),
        after: invoiceAuditView(next),
        reason: `Paiement ${payment.number}`,
      });
      return payment.id;
    });
    return { invoice: await this.invoices.get(invoiceId), paymentId };
  }

  /** Annulation d'un paiement (erreur de saisie) : administrateur uniquement, et seulement tant que la session est ouverte. */
  async cancel(paymentId: string, input: CancelPaymentInput, actor: RequestUser): Promise<InvoiceDetailDto> {
    const invoiceId = await this.prisma.$transaction(async (tx) => {
      const payment = await this.repo.findPayment(paymentId, tx);
      if (!payment) throw new NotFoundError('Paiement', paymentId);
      await this.repo.lock('cash_sessions', payment.cashSessionId, tx);
      await this.repo.lock('invoices', payment.invoiceId, tx);
      await this.repo.lock('payments', paymentId, tx);
      const fresh = await this.repo.findPayment(paymentId, tx);
      if (!fresh || fresh.cancelledAt) throw new BusinessRuleError('PAYMENT_ALREADY_CANCELLED', 'Ce paiement est déjà annulé.');
      if (fresh.cashSession.status !== 'OPEN') {
        throw new BusinessRuleError(
          'CASH_SESSION_CLOSED',
          'La session de caisse de ce paiement est clôturée : il ne peut plus être annulé (un remboursement sera nécessaire).',
        );
      }
      const invoiceBefore = await this.invoices.getOrThrow(payment.invoiceId, tx);
      const updated = await this.repo.updatePayment(
        paymentId,
        { cancelledAt: new Date(), cancelledById: actor.id, cancellationReason: input.reason },
        tx,
      );
      const invoiceAfter = await this.invoices.recompute(tx, payment.invoiceId);
      await this.audit.record(tx, {
        action: 'DELETE',
        entity: 'Payment',
        entityId: paymentId,
        before: paymentAuditView(fresh),
        after: paymentAuditView(updated),
        reason: input.reason,
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Invoice',
        entityId: payment.invoiceId,
        before: invoiceAuditView(invoiceBefore),
        after: invoiceAuditView(invoiceAfter),
        reason: `Annulation du paiement ${payment.number}`,
      });
      return payment.invoiceId;
    });
    return this.invoices.get(invoiceId);
  }

  async receipt(paymentId: string): Promise<ReceiptDto> {
    const payment = await this.repo.findPayment(paymentId);
    if (!payment) throw new NotFoundError('Paiement', paymentId);
    const [invoice, settings, names] = await Promise.all([
      this.invoices.get(payment.invoiceId),
      this.lab.settings(),
      this.lab.userNames([payment.receivedById]),
    ]);
    return {
      payment: toPaymentDto(payment, names),
      invoice,
      lab: {
        name: settings.name,
        address: settings.address,
        city: settings.city,
        phone: settings.phone,
        currency: settings.currency,
        secondaryCurrency: secondaryCurrencyFor(settings.currency, settings.secondaryCurrencyEnabled),
        reportFooter: settings.reportFooter,
      },
    };
  }
}
