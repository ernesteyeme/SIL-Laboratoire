import { z } from 'zod';
import {
  NON_CONFORMITY_DECISIONS,
  NON_CONFORMITY_TYPES,
  ORDER_PRIORITIES,
  ORDER_STATUSES,
  SAMPLE_STATUSES,
  type NonConformityDecision,
  type NonConformityType,
  type OrderPriority,
  type OrderStatus,
  type SampleStatus,
  type Sex,
  type InvoiceStatus,
} from '../enums';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';
import { isoDateSchema } from './patients';

// ---------------------------------------------------------------------------
// Demandes
// ---------------------------------------------------------------------------

export const createOrderSchema = z
  .object({
    patientId: z.string({ required_error: 'Le patient est obligatoire.' }).uuid('Le patient est obligatoire.'),
    prescriberId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullish()),
    priority: z.enum(ORDER_PRIORITIES).default('ROUTINE'),
    /** Renseignements cliniques utiles à l'interprétation */
    clinicalInfo: optionalText(1000),
    examIds: z
      .array(z.string().uuid())
      .min(1, 'Sélectionnez au moins un examen.')
      .max(60)
      .refine((ids) => new Set(ids).size === ids.length, 'Un examen ne peut être demandé qu’une fois.'),
    /** Organisme payeur (assurance, employeur, programme) */
    payerName: optionalText(150),
    /** Part prise en charge par le payeur, en % */
    coveragePercent: z.coerce.number().int().min(0).max(100).default(0),
  })
  .strict()
  .refine((d) => d.coveragePercent === 0 || !!d.payerName, {
    message: 'Indiquez l’organisme payeur pour une prise en charge.',
    path: ['payerName'],
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  q: optionalText(100),
  status: z.enum(ORDER_STATUSES).optional(),
  priority: z.enum(ORDER_PRIORITIES).optional(),
  patientId: z.string().uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const cancelOrderSchema = z.object({ reason: reasonSchema }).strict();
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// ---------------------------------------------------------------------------
// Échantillons
// ---------------------------------------------------------------------------

export const collectSampleSchema = z
  .object({
    /** Heure réelle du prélèvement (défaut : maintenant). ISO 8601. */
    collectedAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((d) => !d.collectedAt || d.collectedAt.getTime() <= Date.now() + 60_000, {
    message: 'L’heure de prélèvement ne peut pas être dans le futur.',
    path: ['collectedAt'],
  })
  .refine((d) => !d.collectedAt || d.collectedAt.getTime() >= Date.now() - 7 * 24 * 3600_000, {
    message: 'L’heure de prélèvement remonte à plus de 7 jours.',
    path: ['collectedAt'],
  });
export type CollectSampleInput = z.infer<typeof collectSampleSchema>;

export const nonConformitySchema = z
  .object({
    type: z.enum(NON_CONFORMITY_TYPES, { errorMap: () => ({ message: 'Choisissez le type de non-conformité.' }) }),
    decision: z.enum(NON_CONFORMITY_DECISIONS, { errorMap: () => ({ message: 'Choisissez une décision.' }) }),
    comment: optionalText(500),
  })
  .strict()
  .refine((d) => d.type !== 'OTHER' || !!d.comment, { message: 'Précisez la non-conformité.', path: ['comment'] })
  .refine((d) => d.decision !== 'ACCEPTED_WITH_RESERVATION' || !!d.comment, {
    message: 'Une dérogation doit être justifiée (réserve à mentionner sur le compte rendu).',
    path: ['comment'],
  });
export type NonConformityInput = z.infer<typeof nonConformitySchema>;

export const recollectSchema = z.object({ reason: reasonSchema }).strict();
export type RecollectInput = z.infer<typeof recollectSchema>;

export const listSamplesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(SAMPLE_STATUSES).optional(),
  q: optionalText(50),
});
export type ListSamplesQuery = z.infer<typeof listSamplesQuerySchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface PatientSummaryDto {
  id: string;
  code: string;
  fullName: string;
  sex: Sex;
  birthDate: string | null;
  birthDateEstimated: boolean;
  phone: string | null;
}

export interface NonConformityDto {
  id: string;
  type: NonConformityType;
  decision: NonConformityDecision;
  comment: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

export interface SampleDto {
  id: string;
  number: string;
  status: SampleStatus;
  sampleType: { id: string; code: string; name: string; container: string | null; instructions: string | null };
  examCodes: string[];
  collectedAt: string | null;
  collectedBy: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  hasReservation: boolean;
  replacesNumber: string | null;
  replacedByNumber: string | null;
  nonConformities: NonConformityDto[];
}

export interface OrderItemDto {
  id: string;
  examId: string;
  examCode: string;
  examName: string;
  unitPrice: string;
  sampleNumber: string;
  turnaroundHours: number;
  patientInstructions: string | null;
}

export interface OrderInvoiceSummaryDto {
  id: string;
  number: string;
  status: InvoiceStatus;
  patientAmount: string;
  paidAmount: string;
  balance: string;
}

export interface OrderListItemDto {
  id: string;
  number: string;
  status: OrderStatus;
  priority: OrderPriority;
  patient: PatientSummaryDto;
  prescriberName: string | null;
  examCodes: string[];
  createdAt: string;
  invoiceStatus: InvoiceStatus | null;
}

export interface OrderDetailDto extends OrderListItemDto {
  clinicalInfo: string | null;
  createdBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: OrderItemDto[];
  samples: SampleDto[];
  invoice: OrderInvoiceSummaryDto | null;
  /** Le prélèvement exige-t-il un paiement préalable ? (paramètre du laboratoire) */
  paymentRequiredBeforeCollection: boolean;
}

/** Échantillon avec son contexte (poste de réception, scan du code-barres). */
export interface SampleContextDto extends SampleDto {
  order: { id: string; number: string; priority: OrderPriority; status: OrderStatus; createdAt: string; clinicalInfo: string | null };
  patient: PatientSummaryDto;
}
