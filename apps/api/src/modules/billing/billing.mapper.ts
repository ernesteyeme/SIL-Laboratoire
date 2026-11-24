import {
  formatPatientName,
  fromCents,
  toCents,
  type CashSessionDto,
  type InvoiceDetailDto,
  type InvoiceListItemDto,
  type MethodTotalDto,
  type PatientSummaryDto,
  type PaymentDto,
} from '@lims/shared';
import type { CashSession, Patient, Payment } from '../../generated/prisma/client';
import { dateToIso } from '../../core/common/values';
import type { InvoiceDetailRow, InvoiceListRow } from './billing.repository';

export function toPatientSummary(p: Patient): PatientSummaryDto {
  return {
    id: p.id,
    code: p.code,
    fullName: formatPatientName(p),
    sex: p.sex,
    birthDate: dateToIso(p.birthDate),
    birthDateEstimated: p.birthDateEstimated,
    phone: p.phone,
  };
}

const money = (d: { toFixed(dp: number): string }) => d.toFixed(2);

export function toPaymentDto(p: Payment & { cashSession: { number: string } }, names: Map<string, string>): PaymentDto {
  return {
    id: p.id,
    number: p.number,
    amount: money(p.amount),
    currency: p.currency,
    tenderedAmount: money(p.tenderedAmount),
    exchangeRate: p.exchangeRate ? p.exchangeRate.toFixed(4) : null,
    changeAmount: money(p.changeAmount),
    method: p.method,
    reference: p.reference,
    receivedAt: p.receivedAt.toISOString(),
    receivedBy: names.get(p.receivedById) ?? null,
    cashSessionNumber: p.cashSession.number,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    cancellationReason: p.cancellationReason,
  };
}

export function toInvoiceListItem(i: InvoiceListRow): InvoiceListItemDto {
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    orderId: i.order.id,
    orderNumber: i.order.number,
    patient: toPatientSummary(i.patient),
    patientAmount: money(i.patientAmount),
    paidAmount: money(i.paidAmount),
    balance: fromCents(i.status === 'CANCELLED' ? 0 : toCents(money(i.patientAmount)) - toCents(money(i.paidAmount))),
    createdAt: i.createdAt.toISOString(),
  };
}

export function toInvoiceDetail(i: InvoiceDetailRow, names: Map<string, string>): InvoiceDetailDto {
  return {
    ...toInvoiceListItem(i),
    lines: i.lines.map((l) => ({ id: l.id, label: l.label, amount: money(l.amount) })),
    totalAmount: money(i.totalAmount),
    discountAmount: money(i.discountAmount),
    discountReason: i.discountReason,
    netAmount: fromCents(toCents(money(i.totalAmount)) - toCents(money(i.discountAmount))),
    payerName: i.payerName,
    coveragePercent: i.coveragePercent,
    thirdPartyAmount: money(i.thirdPartyAmount),
    cancelledAt: i.cancelledAt?.toISOString() ?? null,
    cancellationReason: i.cancellationReason,
    payments: i.payments.map((p) => toPaymentDto(p, names)),
  };
}

export interface SessionTotals {
  byMethod: MethodTotalDto[];
  cancelledCount: number;
  changeCents: number;
}

/**
 * Espèces attendues par devise :
 *  - devise de base = fond + espèces remises en devise de base − monnaie rendue (toujours en devise de base) ;
 *  - devise secondaire = fond secondaire + espèces remises en devise secondaire.
 */
export function expectedCash(s: CashSession, totals: SessionTotals): { baseCents: number; secondaryCents: number | null } {
  const cashIn = (currency: string) =>
    totals.byMethod.filter((t) => t.method === 'CASH' && t.currency === currency).reduce((sum, t) => sum + toCents(t.tendered), 0);
  return {
    baseCents: toCents(money(s.openingFloat)) + cashIn(s.baseCurrency) - totals.changeCents,
    secondaryCents: s.secondaryCurrency ? toCents(money(s.openingFloatSecondary)) + cashIn(s.secondaryCurrency) : null,
  };
}

export function toCashSessionDto(s: CashSession, cashierName: string, totals: SessionTotals): CashSessionDto {
  const expected = expectedCash(s, totals);
  const applied = totals.byMethod.reduce((sum, t) => sum + toCents(t.applied), 0);
  return {
    id: s.id,
    number: s.number,
    status: s.status,
    cashier: { id: s.cashierId, fullName: cashierName },
    baseCurrency: s.baseCurrency,
    secondaryCurrency: s.secondaryCurrency,
    openedAt: s.openedAt.toISOString(),
    openingFloat: money(s.openingFloat),
    openingFloatSecondary: money(s.openingFloatSecondary),
    closedAt: s.closedAt?.toISOString() ?? null,
    expectedCash: s.expectedCash ? money(s.expectedCash) : fromCents(expected.baseCents),
    countedCash: s.countedCash ? money(s.countedCash) : null,
    difference: s.difference ? money(s.difference) : null,
    expectedCashSecondary: s.expectedCashSecondary
      ? money(s.expectedCashSecondary)
      : expected.secondaryCents === null
        ? null
        : fromCents(expected.secondaryCents),
    countedCashSecondary: s.countedCashSecondary ? money(s.countedCashSecondary) : null,
    differenceSecondary: s.differenceSecondary ? money(s.differenceSecondary) : null,
    totalChange: fromCents(totals.changeCents),
    closingNote: s.closingNote,
    totals: totals.byMethod,
    totalCollected: fromCents(applied),
    paymentCount: totals.byMethod.reduce((n, t) => n + t.count, 0),
    cancelledCount: totals.cancelledCount,
  };
}
