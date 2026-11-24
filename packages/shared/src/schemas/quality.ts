import { z } from 'zod';
import {
  QC_STATUSES,
  QC_TARGET_SOURCES,
  QUALITY_ISSUE_CATEGORIES,
  QUALITY_ISSUE_SEVERITIES,
  QUALITY_ISSUE_STATUSES,
  type NonConformityType,
  type QcStatus,
  type QcTargetSource,
  type QualityIssueCategory,
  type QualityIssueSeverity,
  type QualityIssueStatus,
  type WestgardRule,
} from '../enums';
import { isValidIsoDate, parseIsoDate } from '../clinical';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';
import { isoDateSchema } from './patients';

/** Nombre décimal saisi au format français ou international (« 5,25 », « 5.25 »). */
const decimalInput = (label: string) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v : Number(v.trim().replace(/\s/g, '').replace(',', '.'))))
    .refine((v) => Number.isFinite(v), `${label} : nombre attendu.`)
    .refine((v) => Math.abs(v) < 1e10, `${label} : valeur hors limites.`);

const boolQuery = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());

// ---------------------------------------------------------------------------
// Matériaux et cibles de contrôle
// ---------------------------------------------------------------------------

export const qcMaterialSchema = z
  .object({
    name: z.string().trim().min(2, 'Nom du contrôle obligatoire.').max(150),
    manufacturer: optionalText(150),
    lotNumber: z.string().trim().min(1, 'N° de lot obligatoire.').max(60),
    /** Niveau du contrôle : « Niveau 1 (bas) », « Normal », « Pathologique »… */
    level: z.string().trim().min(1, 'Niveau obligatoire.').max(40),
    expiresOn: isoDateSchema,
    sectionId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullish()),
    isActive: z.boolean().optional(),
  })
  .strict();
export type QcMaterialInput = z.infer<typeof qcMaterialSchema>;

export const qcTargetSchema = z
  .object({
    parameterId: z.string().uuid('Paramètre obligatoire.'),
    mean: decimalInput('Moyenne cible'),
    sd: decimalInput('Écart-type cible').refine((v) => v > 0, 'L’écart-type cible doit être strictement positif.'),
    source: z.enum(QC_TARGET_SOURCES),
    isActive: z.boolean().optional(),
    /** Motif obligatoire lorsqu'une cible existante est modifiée (traçabilité). */
    reason: optionalText(500),
  })
  .strict();
export type QcTargetInput = z.infer<typeof qcTargetSchema>;

// ---------------------------------------------------------------------------
// Séries de contrôle
// ---------------------------------------------------------------------------

export const qcRunSchema = z
  .object({
    parameterId: z.string().uuid(),
    /** Heure de passage ; par défaut maintenant. */
    performedAt: z
      .string()
      .datetime({ offset: true, message: 'Date et heure invalides.' })
      .optional()
      .refine((v) => !v || new Date(v).getTime() <= Date.now() + 5 * 60_000, 'L’heure de passage ne peut pas être dans le futur.'),
    results: z
      .array(z.object({ targetId: z.string().uuid(), value: decimalInput('Valeur du contrôle') }).strict())
      .min(1, 'Saisissez au moins un niveau de contrôle.')
      .max(6)
      .refine((r) => new Set(r.map((x) => x.targetId)).size === r.length, 'Un même niveau ne peut être saisi qu’une fois par série.'),
    comment: optionalText(500),
  })
  .strict();
export type QcRunInput = z.infer<typeof qcRunSchema>;

export const qcCorrectiveActionSchema = z
  .object({ correctiveAction: z.string().trim().min(10, 'Décrivez l’action corrective (10 caractères minimum).').max(1000) })
  .strict();
export type QcCorrectiveActionInput = z.infer<typeof qcCorrectiveActionSchema>;

export const qcExcludeSchema = z.object({ reason: reasonSchema }).strict();
export type QcExcludeInput = z.infer<typeof qcExcludeSchema>;

const periodRefine = <T extends { from?: string; to?: string }>(v: T) => !v.from || !v.to || v.from <= v.to;

export const qcRunsQuerySchema = paginationQuerySchema
  .extend({
    parameterId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    status: z.enum(QC_STATUSES).optional(),
    unresolved: boolQuery,
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine(periodRefine, { message: 'La date de début doit précéder la date de fin.', path: ['to'] });
export type QcRunsQuery = z.infer<typeof qcRunsQuerySchema>;

export const leveyJenningsQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine(periodRefine, { message: 'La date de début doit précéder la date de fin.', path: ['to'] });
export type LeveyJenningsQuery = z.infer<typeof leveyJenningsQuerySchema>;

// ---------------------------------------------------------------------------
// Fiches de non-conformité
// ---------------------------------------------------------------------------

export const createQualityIssueSchema = z
  .object({
    title: z.string().trim().min(5, 'Intitulé trop court (5 caractères minimum).').max(200),
    category: z.enum(QUALITY_ISSUE_CATEGORIES),
    severity: z.enum(QUALITY_ISSUE_SEVERITIES),
    description: z.string().trim().min(10, 'Décrivez les faits (10 caractères minimum).').max(4000),
    detectedAt: z
      .string()
      .datetime({ offset: true, message: 'Date et heure invalides.' })
      .refine((v) => new Date(v).getTime() <= Date.now() + 5 * 60_000, 'La date de constat ne peut pas être dans le futur.'),
    /** Action curative immédiate (traitement de la non-conformité elle-même). */
    immediateAction: optionalText(2000),
    /** Rattachement facultatif à une demande ou un échantillon, par leur numéro. */
    orderNumber: optionalText(30),
    sampleNumber: optionalText(20),
  })
  .strict();
export type CreateQualityIssueInput = z.infer<typeof createQualityIssueSchema>;

export const planQualityIssueSchema = z
  .object({
    rootCause: z.string().trim().min(5, 'Analyse des causes obligatoire.').max(2000),
    correctiveAction: z.string().trim().min(5, 'Action corrective obligatoire.').max(2000),
    actionOwner: z.string().trim().min(2, 'Responsable de l’action obligatoire.').max(150),
    actionDueDate: isoDateSchema,
  })
  .strict();
export type PlanQualityIssueInput = z.infer<typeof planQualityIssueSchema>;

export const closeQualityIssueSchema = z
  .object({ effectivenessCheck: z.string().trim().min(10, 'Décrivez la vérification d’efficacité (10 caractères minimum).').max(2000) })
  .strict();
export type CloseQualityIssueInput = z.infer<typeof closeQualityIssueSchema>;

export const cancelQualityIssueSchema = z.object({ reason: reasonSchema }).strict();
export type CancelQualityIssueInput = z.infer<typeof cancelQualityIssueSchema>;

export const qualityIssuesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(QUALITY_ISSUE_STATUSES).optional(),
  category: z.enum(QUALITY_ISSUE_CATEGORIES).optional(),
  severity: z.enum(QUALITY_ISSUE_SEVERITIES).optional(),
  overdue: boolQuery,
  q: optionalText(100),
});
export type QualityIssuesQuery = z.infer<typeof qualityIssuesQuerySchema>;

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

export const MAX_INDICATOR_PERIOD_DAYS = 366;

export const indicatorsQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    sectionId: z.string().uuid().optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'La date de début doit précéder la date de fin.', path: ['to'] })
  .refine(
    (v) => !isValidIsoDate(v.from) || !isValidIsoDate(v.to) || (parseIsoDate(v.to).getTime() - parseIsoDate(v.from).getTime()) / 86_400_000 < MAX_INDICATOR_PERIOD_DAYS,
    { message: `Période limitée à ${MAX_INDICATOR_PERIOD_DAYS} jours.`, path: ['to'] },
  );
export type IndicatorsQuery = z.infer<typeof indicatorsQuerySchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface QcParameterRef {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  decimals: number | null;
  examCode: string;
  examName: string;
  sectionId: string;
  sectionName: string;
}

export interface QcTargetDto {
  id: string;
  materialId: string;
  parameter: QcParameterRef;
  mean: number;
  sd: number;
  /** Coefficient de variation cible (%) */
  cvPercent: number | null;
  source: QcTargetSource;
  isActive: boolean;
  updatedAt: string;
}

export interface QcMaterialDto {
  id: string;
  name: string;
  manufacturer: string | null;
  lotNumber: string;
  level: string;
  expiresOn: string;
  expired: boolean;
  section: { id: string; name: string } | null;
  isActive: boolean;
  targets: QcTargetDto[];
}

export interface QcResultDto {
  id: string;
  targetId: string;
  materialName: string;
  lotNumber: string;
  level: string;
  value: number;
  mean: number;
  sd: number;
  z: number;
  status: QcStatus;
  rules: WestgardRule[];
}

export interface QcRunDto {
  id: string;
  parameter: QcParameterRef;
  performedAt: string;
  performedBy: string | null;
  status: QcStatus;
  rules: WestgardRule[];
  comment: string | null;
  results: QcResultDto[];
  correctiveAction: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  excludedAt: string | null;
  excludedBy: string | null;
  excludedReason: string | null;
  qualityIssue: { id: string; number: string; status: QualityIssueStatus } | null;
}

/** Résultats patients du même paramètre saisis depuis le dernier CIQ accepté (à réévaluer après un rejet). */
export interface QcImpactedResultDto {
  orderId: string;
  orderNumber: string;
  patientName: string;
  examCode: string;
  value: string;
  analysisStatus: string;
  enteredAt: string | null;
}

export interface QcRunDetailDto extends QcRunDto {
  lastAcceptedAt: string | null;
  impactedResults: QcImpactedResultDto[];
}

export interface QcParameterStatusDto {
  parameter: QcParameterRef;
  targets: { id: string; materialName: string; lotNumber: string; level: string; mean: number; sd: number; expired: boolean }[];
  lastRun: { id: string; performedAt: string; status: QcStatus; resolved: boolean } | null;
  ranToday: boolean;
  /** Dernière série rejetée : la validation technique des résultats patients de ce paramètre est bloquée. */
  blocking: boolean;
}

export interface LeveyJenningsDto {
  target: QcTargetDto & { materialName: string; lotNumber: string; level: string };
  points: { runId: string; performedAt: string; value: number; z: number; status: QcStatus; rules: WestgardRule[]; excluded: boolean }[];
  /** Statistiques observées (séries retenues uniquement : ni exclues ni rejetées) */
  observed: { n: number; mean: number | null; sd: number | null; cv: number | null };
}

export interface QualityIssueDto {
  id: string;
  number: string;
  title: string;
  category: QualityIssueCategory;
  severity: QualityIssueSeverity;
  status: QualityIssueStatus;
  description: string;
  detectedAt: string;
  declaredAt: string;
  declaredBy: string | null;
  immediateAction: string | null;
  order: { id: string; number: string } | null;
  sample: { id: string; number: string } | null;
  qcRunId: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  actionOwner: string | null;
  actionDueDate: string | null;
  analyzedBy: string | null;
  analyzedAt: string | null;
  effectivenessCheck: string | null;
  closedBy: string | null;
  closedAt: string | null;
  cancelledReason: string | null;
  overdue: boolean;
}

export interface TatRowDto {
  examCode: string;
  examName: string;
  sectionName: string;
  targetHours: number;
  count: number;
  medianHours: number | null;
  p90Hours: number | null;
  withinTargetPercent: number | null;
}

export interface IndicatorsDto {
  period: { from: string; to: string };
  tat: {
    overall: Omit<TatRowDto, 'examCode' | 'examName' | 'sectionName' | 'targetHours'>;
    byExam: TatRowDto[];
    /** Examens en cours dont l'échéance de rendu est dépassée (à l'instant présent) */
    overdueNow: number;
    /** Délai prélèvement → réception (médiane, heures) */
    preAnalyticalMedianHours: number | null;
  };
  samples: {
    received: number;
    rejected: number;
    rejectionRatePercent: number | null;
    derogations: number;
    byType: { type: NonConformityType; count: number }[];
  };
  critical: { count: number; acknowledged: number; medianMinutes: number | null; withinTargetPercent: number | null; targetMinutes: number };
  reports: { final: number; amended: number; amendedRatePercent: number | null };
  qc: {
    runs: number;
    accepted: number;
    warning: number;
    rejected: number;
    rejectionRatePercent: number | null;
    byParameter: { parameterCode: string; parameterName: string; runs: number; warning: number; rejected: number }[];
  };
  issues: {
    declared: number;
    byCategory: { category: QualityIssueCategory; count: number }[];
    bySeverity: { severity: QualityIssueSeverity; count: number }[];
    openNow: number;
    overdueNow: number;
    medianClosureDays: number | null;
  };
}
