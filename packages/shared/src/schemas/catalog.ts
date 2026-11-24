import { z } from 'zod';
import { RANGE_SEXES, RESULT_TYPES, type RangeSex, type ResultType } from '../enums';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';

/** Code catalogue : majuscules, chiffres, « _ », « - », « . » */
const codeSchema = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(new RegExp(`^[A-Z0-9][A-Z0-9_.-]{0,${max - 1}}$`), `Code invalide : lettres, chiffres, « _ », « - » ou « . » (${max} caractères max.).`);

/** Montant positif, 2 décimales max. Accepte « 15000 », « 15000.5 », « 15 000,50 ». Renvoie une chaîne. */
export const moneySchema = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim().replace(/\s/g, '').replace(',', '.'))
  .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), 'Montant invalide (nombre positif, 2 décimales max.).');

/** Nombre facultatif saisi dans un formulaire : « » → null, « 12,5 » → 12.5. */
const optionalNumber = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number({ invalid_type_error: 'Nombre attendu.' }).finite('Nombre attendu.').nullable(),
);

/** Activation / désactivation : motif obligatoire. */
const withStatusChange = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...shape, isActive: z.boolean().optional(), reason: reasonSchema.optional() })
    .strict()
    .refine(
      (d) => Object.entries(d).some(([k, v]) => k !== 'reason' && v !== undefined),
      'Aucune modification fournie.',
    )
    .refine((d) => d.isActive === undefined || !!d.reason, {
      message: 'Un motif est obligatoire pour activer ou désactiver un élément du catalogue.',
      path: ['reason'],
    });

// ---------------------------------------------------------------------------
// Sections (disciplines) et types d'échantillon
// ---------------------------------------------------------------------------

const sectionFields = {
  code: codeSchema(20),
  name: z.string().trim().min(2, 'Le nom est obligatoire.').max(100),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
};

export const createLabSectionSchema = z.object(sectionFields).strict();
export type CreateLabSectionInput = z.infer<typeof createLabSectionSchema>;
export const updateLabSectionSchema = withStatusChange({
  name: sectionFields.name.optional(),
  displayOrder: z.coerce.number().int().min(0).max(9999).optional(),
});
export type UpdateLabSectionInput = z.infer<typeof updateLabSectionSchema>;

const sampleTypeFields = {
  code: codeSchema(20),
  name: z.string().trim().min(2, 'Le nom est obligatoire.').max(100),
  /** Contenant : « Tube violet EDTA », « Flacon stérile »… */
  container: optionalText(100),
  /** Consignes de prélèvement et de conservation */
  instructions: optionalText(500),
};

export const createSampleTypeSchema = z.object(sampleTypeFields).strict();
export type CreateSampleTypeInput = z.infer<typeof createSampleTypeSchema>;
export const updateSampleTypeSchema = withStatusChange({
  name: sampleTypeFields.name.optional(),
  container: sampleTypeFields.container,
  instructions: sampleTypeFields.instructions,
});
export type UpdateSampleTypeInput = z.infer<typeof updateSampleTypeSchema>;

// ---------------------------------------------------------------------------
// Examens
// ---------------------------------------------------------------------------

const examFields = {
  code: codeSchema(20),
  name: z.string().trim().min(2, 'Le nom est obligatoire.').max(150),
  shortName: optionalText(30),
  sectionId: z.string({ required_error: 'La section est obligatoire.' }).uuid('La section est obligatoire.'),
  sampleTypeId: z.string({ required_error: 'Le type d’échantillon est obligatoire.' }).uuid('Le type d’échantillon est obligatoire.'),
  price: moneySchema,
  /** Délai de rendu des résultats, en heures */
  turnaroundHours: z.coerce
    .number({ invalid_type_error: 'Nombre d’heures attendu.' })
    .int('Nombre entier d’heures attendu.')
    .min(1, 'Délai minimal : 1 heure.')
    .max(2160, 'Délai maximal : 90 jours.'),
  /** Préparation du patient : « À jeun depuis 8 h »… */
  patientInstructions: optionalText(500),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
};

export const createExamSchema = z.object(examFields).strict();
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const updateExamSchema = withStatusChange({
  name: examFields.name.optional(),
  shortName: examFields.shortName,
  sectionId: examFields.sectionId.optional(),
  sampleTypeId: examFields.sampleTypeId.optional(),
  price: moneySchema.optional(),
  turnaroundHours: examFields.turnaroundHours.optional(),
  patientInstructions: examFields.patientInstructions,
  displayOrder: z.coerce.number().int().min(0).max(9999).optional(),
});
export type UpdateExamInput = z.infer<typeof updateExamSchema>;

export const listExamsQuerySchema = paginationQuerySchema.extend({
  q: optionalText(100),
  sectionId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type ListExamsQuery = z.infer<typeof listExamsQuerySchema>;

// ---------------------------------------------------------------------------
// Paramètres d'examen
// ---------------------------------------------------------------------------

const choicesSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(30)
  .refine((c) => new Set(c.map((x) => x.toLowerCase())).size === c.length, 'Les choix doivent être distincts.');

const parameterFields = {
  code: codeSchema(30),
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(150),
  resultType: z.enum(RESULT_TYPES),
  /** Unité (notation UCUM conseillée) : g/dL, 10^3/µL, mmol/L, copies/mL… */
  unit: optionalText(30),
  /** Nombre de décimales affichées (numérique uniquement) */
  decimals: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(0).max(6).nullable()),
  /** Valeurs possibles (liste de choix uniquement) */
  choices: choicesSchema.default([]),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
};

function checkParameterTypeRules(
  d: { resultType?: ResultType; choices?: string[]; decimals?: number | null; unit?: string | null },
  ctx: z.RefinementCtx,
) {
  if (d.resultType === 'CHOICE' && (d.choices?.length ?? 0) < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['choices'], message: 'Une liste de choix doit comporter au moins 2 valeurs.' });
  }
  if (d.resultType && d.resultType !== 'CHOICE' && (d.choices?.length ?? 0) > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['choices'], message: 'Les choix ne s’appliquent qu’au type « Liste de choix ».' });
  }
  if (d.resultType && d.resultType !== 'NUMERIC' && d.decimals != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decimals'], message: 'Les décimales ne s’appliquent qu’au type numérique.' });
  }
}

export const createParameterSchema = z.object(parameterFields).strict().superRefine(checkParameterTypeRules);
export type CreateParameterInput = z.infer<typeof createParameterSchema>;

export const updateParameterSchema = z
  .object({
    name: parameterFields.name.optional(),
    resultType: parameterFields.resultType.optional(),
    unit: parameterFields.unit,
    decimals: parameterFields.decimals.optional(),
    choices: choicesSchema.optional(),
    displayOrder: z.coerce.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
    reason: reasonSchema.optional(),
  })
  .strict()
  .superRefine(checkParameterTypeRules)
  .refine((d) => d.isActive === undefined || !!d.reason, {
    message: 'Un motif est obligatoire pour activer ou désactiver un paramètre.',
    path: ['reason'],
  });
export type UpdateParameterInput = z.infer<typeof updateParameterSchema>;

// ---------------------------------------------------------------------------
// Valeurs de référence
// ---------------------------------------------------------------------------

export const referenceRangeSchema = z
  .object({
    sex: z.enum(RANGE_SEXES).default('ANY'),
    /** Borne inférieure incluse, en jours */
    ageMinDays: z.coerce.number().int().min(0).max(54_000).default(0),
    /** Borne supérieure exclue, en jours (null = sans limite) */
    ageMaxDays: z.preprocess(
      (v) => (v === '' || v === undefined ? null : v),
      z.coerce.number().int().min(1).max(54_000).nullable(),
    ),
    low: optionalNumber,
    high: optionalNumber,
    criticalLow: optionalNumber,
    criticalHigh: optionalNumber,
    /** Valeur normale attendue (texte / liste de choix) : « Négatif »… */
    normalText: optionalText(100),
    comment: optionalText(300),
    /** Motif de la modification (obligatoire en modification, consigné dans l'audit) */
    reason: reasonSchema.optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (d.ageMaxDays !== null && d.ageMaxDays <= d.ageMinDays) issue('ageMaxDays', 'L’âge maximal doit être supérieur à l’âge minimal.');
    if (d.low !== null && d.high !== null && d.low > d.high) issue('high', 'La borne haute doit être supérieure ou égale à la borne basse.');
    if (d.criticalLow !== null && d.low !== null && d.criticalLow > d.low) issue('criticalLow', 'Le seuil critique bas doit être inférieur ou égal à la borne basse.');
    if (d.criticalHigh !== null && d.high !== null && d.criticalHigh < d.high) issue('criticalHigh', 'Le seuil critique haut doit être supérieur ou égal à la borne haute.');
    if (d.criticalLow !== null && d.criticalHigh !== null && d.criticalLow >= d.criticalHigh) issue('criticalHigh', 'Le seuil critique haut doit être supérieur au seuil critique bas.');
    if (d.low === null && d.high === null && d.criticalLow === null && d.criticalHigh === null && !d.normalText) {
      issue('low', 'Renseignez au moins une borne ou une valeur normale attendue.');
    }
  });

export type ReferenceRangeInput = z.infer<typeof referenceRangeSchema>;

export const deleteWithReasonSchema = z.object({ reason: reasonSchema }).strict();
export type DeleteWithReasonInput = z.infer<typeof deleteWithReasonSchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface LabSectionDto {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  activeExamCount: number;
}

export interface SampleTypeDto {
  id: string;
  code: string;
  name: string;
  container: string | null;
  instructions: string | null;
  isActive: boolean;
  activeExamCount: number;
}

export interface ReferenceRangeDto {
  id: string;
  sex: RangeSex;
  ageMinDays: number;
  ageMaxDays: number | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  normalText: string | null;
  comment: string | null;
  updatedAt: string;
}

export interface ExamParameterDto {
  id: string;
  code: string;
  name: string;
  resultType: ResultType;
  unit: string | null;
  decimals: number | null;
  choices: string[];
  displayOrder: number;
  isActive: boolean;
  referenceRanges: ReferenceRangeDto[];
}

export interface ExamListItemDto {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  section: { id: string; code: string; name: string };
  sampleType: { id: string; code: string; name: string; container: string | null };
  /** Montant en chaîne décimale (« 15000.00 ») pour éviter les erreurs d'arrondi */
  price: string;
  turnaroundHours: number;
  isActive: boolean;
  activeParameterCount: number;
}

export interface ExamDetailDto extends ExamListItemDto {
  patientInstructions: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  parameters: ExamParameterDto[];
}
