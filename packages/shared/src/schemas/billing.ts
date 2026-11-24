import { z } from 'zod';
import {
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_METHODS_WITH_REFERENCE,
  type CashSessionStatus,
  type InvoiceStatus,
  type PaymentMethod,
} from '../enums';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';
import { moneySchema } from './catalog';
import { isoDateSchema } from './patients';
import type { PatientSummaryDto } from './orders';

export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  q: optionalText(100),
  status: z.enum(INVOICE_STATUSES).optional(),
  /** Raccourci : factures restant à encaisser (non payées ou partiellement) */
  outstanding: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const discountSchema = z
  .object({
    discountAmount: moneySchema,
    reason: reasonSchema,
  })
  .strict();
export type DiscountInput = z.infer<typeof discountSchema>;

const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Code devise invalide.');

export const paymentSchema = z
  .object({
    /** Montant remis par le patient, dans la devise `currency` (la monnaie éventuelle est rendue en devise de base). */
    amount: moneySchema.refine((v) => Number(v) > 0, 'Le montant doit être supérieur à zéro.'),
    /** Devise du montant remis (défaut : devise de base du laboratoire) */
    currency: currencyCode.optional(),
    method: z.enum(PAYMENT_METHODS),
    /** N° de transaction mobile money, ticket TPE, référence de virement */
    reference: optionalText(100),
  })
  .strict()
  .refine((d) => !PAYMENT_METHODS_WITH_REFERENCE.includes(d.method) || !!d.reference, {
    message: 'La référence de la transaction est obligatoire pour ce moyen de paiement.',
    path: ['reference'],
  });
export type PaymentInput = z.infer<typeof paymentSchema>;

export const cancelPaymentSchema = z.object({ reason: reasonSchema }).strict();
export type CancelPaymentInput = z.infer<typeof cancelPaymentSchema>;

export const openCashSessionSchema = z
  .object({
    openingFloat: moneySchema,
    /** Fond de caisse dans la devise secondaire (caisse bi-devise) */
    openingFloatSecondary: moneySchema.optional(),
  })
  .strict();
export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;

export const closeCashSessionSchema = z
  .object({
    countedCash: moneySchema,
    /** Espèces comptées dans la devise secondaire (obligatoire si la session est bi-devise) */
    countedCashSecondary: moneySchema.optional(),
    note: optionalText(500),
  })
  .strict();
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;

export const listCashSessionsQuerySchema = paginationQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type ListCashSessionsQuery = z.infer<typeof listCashSessionsQuerySchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export const exchangeRateSchema = z
  .object({
    /** Nombre de francs congolais pour 1 dollar américain */
    cdfPerUsd: z
      .union([z.number(), z.string()])
      .transform((v) => String(v).trim().replace(/\s/g, '').replace(',', '.'))
      .refine((v) => /^\d{1,7}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Taux invalide (nombre positif, 4 décimales max.).'),
    note: optionalText(300),
  })
  .strict();
export type ExchangeRateInput = z.infer<typeof exchangeRateSchema>;

export interface ExchangeRateDto {
  id: string;
  /** Date locale d'application (AAAA-MM-JJ) */
  effectiveDate: string;
  cdfPerUsd: string;
  note: string | null;
  setBy: string | null;
  updatedAt: string;
}

export interface PaymentDto {
  id: string;
  number: string;
  /** Montant imputé sur la facture, en devise de base */
  amount: string;
  /** Devise et montant effectivement remis par le patient */
  currency: string;
  tenderedAmount: string;
  /** Taux appliqué (CDF pour 1 USD) si la devise remise n'est pas la devise de base */
  exchangeRate: string | null;
  /** Monnaie rendue, en devise de base */
  changeAmount: string;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: string;
  receivedBy: string | null;
  cashSessionNumber: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export interface InvoiceLineDto {
  id: string;
  label: string;
  amount: string;
}

export interface InvoiceListItemDto {
  id: string;
  number: string;
  status: InvoiceStatus;
  orderId: string;
  orderNumber: string;
  patient: PatientSummaryDto;
  patientAmount: string;
  paidAmount: string;
  balance: string;
  createdAt: string;
}

export interface InvoiceDetailDto extends InvoiceListItemDto {
  lines: InvoiceLineDto[];
  totalAmount: string;
  discountAmount: string;
  discountReason: string | null;
  netAmount: string;
  payerName: string | null;
  coveragePercent: number;
  thirdPartyAmount: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  payments: PaymentDto[];
}

export interface MethodTotalDto {
  method: PaymentMethod;
  /** Devise remise */
  currency: string;
  count: number;
  /** Total remis dans cette devise */
  tendered: string;
  /** Total imputé sur les factures, en devise de base */
  applied: string;
}

export interface CashSessionDto {
  id: string;
  number: string;
  status: CashSessionStatus;
  cashier: { id: string; fullName: string };
  baseCurrency: string;
  secondaryCurrency: string | null;
  openedAt: string;
  openingFloat: string;
  openingFloatSecondary: string;
  closedAt: string | null;
  /** Fond de caisse + espèces encaissées (paiements non annulés) */
  expectedCash: string;
  countedCash: string | null;
  difference: string | null;
  /** Fond secondaire + espèces remises en devise secondaire */
  expectedCashSecondary: string | null;
  countedCashSecondary: string | null;
  differenceSecondary: string | null;
  /** Monnaie rendue (devise de base) */
  totalChange: string;
  closingNote: string | null;
  totals: MethodTotalDto[];
  totalCollected: string;
  paymentCount: number;
  cancelledCount: number;
}

export interface CashSessionReportDto extends CashSessionDto {
  payments: (PaymentDto & { invoiceNumber: string; orderNumber: string; patientName: string })[];
}

/** Reçu de paiement (impression). */
export interface ReceiptDto {
  payment: PaymentDto;
  invoice: InvoiceDetailDto;
  lab: {
    name: string;
    address: string | null;
    city: string | null;
    phone: string | null;
    currency: string;
    secondaryCurrency: string | null;
    reportFooter: string | null;
  };
}
