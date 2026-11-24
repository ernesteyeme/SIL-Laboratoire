import { z } from 'zod';
import type { AnalysisStatus, OrderPriority, OrderStatus, ReportKind, ResultFlag, ResultSource, ResultType } from '../enums';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';
import type { PatientSummaryDto } from './orders';

export const saveResultsSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            resultId: z.string().uuid(),
            /** Saisie brute : « 12,5 », « <40 », « Positif »… Chaîne vide = effacer. */
            value: z.string().max(500),
            comment: optionalText(500),
          })
          .strict(),
      )
      .min(1, 'Aucun résultat à enregistrer.')
      .max(200),
  })
  .strict();
export type SaveResultsInput = z.infer<typeof saveResultsSchema>;

export const biologicalValidationSchema = z
  .object({
    /** Commentaire d'interprétation du biologiste (imprimé sur le compte rendu) */
    comment: optionalText(1000),
  })
  .strict();
export type BiologicalValidationInput = z.infer<typeof biologicalValidationSchema>;

export const resultReasonSchema = z.object({ reason: reasonSchema }).strict();
export type ResultReasonInput = z.infer<typeof resultReasonSchema>;

export const acknowledgeAlertSchema = z
  .object({
    /** Personne prévenue et moyen : « Dr Kabongo (prescripteur), par téléphone » */
    notifiedTo: z.string().trim().min(3, 'Indiquez la personne prévenue et le moyen utilisé.').max(200),
    note: optionalText(500),
  })
  .strict();
export type AcknowledgeAlertInput = z.infer<typeof acknowledgeAlertSchema>;

export const WORKLIST_STATUSES = ['TO_ENTER', 'ENTERED', 'TECHNICAL_VALIDATED', 'VALIDATED'] as const;

export const worklistQuerySchema = paginationQuerySchema.extend({
  sectionId: z.string().uuid().optional(),
  status: z.enum(WORKLIST_STATUSES).default('TO_ENTER'),
  q: optionalText(100),
});
export type WorklistQuery = z.infer<typeof worklistQuerySchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface ResultDto {
  id: string;
  parameterId: string;
  parameterCode: string;
  parameterName: string;
  unit: string | null;
  resultType: ResultType;
  decimals: number | null;
  choices: string[];
  numericValue: number | null;
  qualifier: '<' | '>' | null;
  textValue: string | null;
  /** Valeur telle qu'affichée (« 12,5 », « <40 », « Positif ») */
  displayValue: string;
  flag: ResultFlag | null;
  reference: {
    low: number | null;
    high: number | null;
    criticalLow: number | null;
    criticalHigh: number | null;
    normalText: string | null;
    comment: string | null;
    /** Population de la plage : « Femmes, ≥ 18 ans » */
    label: string | null;
  } | null;
  comment: string | null;
  enteredBy: string | null;
  enteredAt: string | null;
  /** Dernier résultat validé du patient pour ce paramètre (antériorité) */
  /** Saisie manuelle ou valeur transmise par un automate (« enteredBy » porte alors le nom de l'automate) */
  source: ResultSource;
  previous: { displayValue: string; flag: ResultFlag | null; validatedAt: string } | null;
}

export interface CriticalAlertDto {
  id: string;
  resultId: string;
  parameterName: string;
  valueText: string;
  flag: ResultFlag;
  detectedAt: string;
  detectedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  notifiedTo: string | null;
  note: string | null;
}

export interface AnalysisItemDto {
  id: string;
  examCode: string;
  examName: string;
  section: { id: string; name: string };
  sampleNumber: string;
  sampleReceivedAt: string | null;
  /** Échéance de rendu : réception + délai de l'examen */
  dueAt: string | null;
  status: AnalysisStatus;
  version: number;
  hasReservation: boolean;
  reservations: string[];
  results: ResultDto[];
  alerts: CriticalAlertDto[];
  biologistComment: string | null;
  technicalValidatedBy: string | null;
  technicalValidatedAt: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  amendments: { fromVersion: number; reason: string; amendedBy: string | null; amendedAt: string }[];
}

export interface ReportDto {
  id: string;
  number: string;
  version: number;
  kind: ReportKind;
  sha256: string;
  issuedAt: string;
  issuedBy: string | null;
  examCodes: string[];
  supersedesNumber: string | null;
}

export interface OrderResultsDto {
  order: {
    id: string;
    number: string;
    status: OrderStatus;
    priority: OrderPriority;
    createdAt: string;
    clinicalInfo: string | null;
    prescriberName: string | null;
  };
  patient: PatientSummaryDto;
  items: AnalysisItemDto[];
  reports: ReportDto[];
}

export interface WorklistItemDto {
  orderItemId: string;
  orderId: string;
  orderNumber: string;
  priority: OrderPriority;
  patient: PatientSummaryDto;
  examCode: string;
  examName: string;
  sectionName: string;
  sampleNumber: string;
  receivedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  status: AnalysisStatus;
  hasCritical: boolean;
  hasReservation: boolean;
}
