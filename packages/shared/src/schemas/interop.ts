import { z } from 'zod';
import {
  DHIS2_MEASURES,
  INTEROP_AUTH_MODES,
  INTEROP_RUN_KINDS,
  INTEROP_RUN_STATUSES,
  INTEROP_TRANSPORTS,
  RANGE_SEXES,
  VLSM_TEST_TYPES,
  type Dhis2Measure,
  type InteropAuthMode,
  type InteropRunKind,
  type InteropRunStatus,
  type InteropSystem,
  type InteropTransport,
  type RangeSex,
  type VlsmSubmissionStatus,
  type VlsmTestType,
} from '../enums';
import { DHIS2_MONTH_PERIOD_REGEX, DHIS2_UID_REGEX } from '../interop';
import { optionalText, paginationQuerySchema } from './common';

const uid = (label: string) => z.string().trim().regex(DHIS2_UID_REGEX, `${label} : UID DHIS2 de 11 caractères (lettre puis lettres/chiffres).`);
const optionalUid = (label: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || DHIS2_UID_REGEX.test(v), `${label} : UID DHIS2 de 11 caractères (lettre puis lettres/chiffres).`);

export const dhis2SettingsSchema = z
  .object({
    orgUnit: uid('Unité d’organisation'),
    dataSet: optionalUid('Ensemble de données'),
    attributeOptionCombo: optionalUid('Combinaison d’options d’attribut'),
    /** Envoyer aussi les valeurs nulles (0) : elles distinguent « aucun cas » de « non rapporté ». */
    sendZeros: z.boolean().default(true),
  })
  .strict();
export type Dhis2Settings = z.infer<typeof dhis2SettingsSchema>;

const positiveId = (label: string) => z.coerce.number({ invalid_type_error: `${label} : nombre entier.` }).int().min(1, `${label} : identifiant VLSM (entier ≥ 1).`);

export const vlsmSettingsSchema = z
  .object({
    /** Identifiant du laboratoire dans VLSM (labId). */
    labId: positiveId('Laboratoire VLSM'),
    /** Structure de santé (facilityId) utilisée par défaut pour les demandes. */
    facilityId: positiveId('Structure VLSM par défaut'),
    provinceId: z.coerce.number().int().min(1).nullish().transform((v) => v ?? null),
    /** Motif de la demande (reasonForVLTesting, obligatoire pour VLSM) appliqué par défaut. */
    reasonForVLTesting: z.string().trim().min(1, 'Motif de demande VLSM obligatoire.').max(50),
    /** Type d'échantillon VLSM par défaut, puis correspondances par type d'échantillon du laboratoire. */
    defaultSpecimenType: positiveId('Type d’échantillon VLSM par défaut'),
    specimenTypes: z
      .array(z.object({ sampleTypeId: z.string().uuid(), vlsmSpecimenType: positiveId('Type d’échantillon VLSM') }).strict())
      .max(50)
      .default([])
      .refine((a) => new Set(a.map((x) => x.sampleTypeId)).size === a.length, 'Un type d’échantillon n’a qu’une correspondance.'),
  })
  .strict();
export type VlsmSettings = z.infer<typeof vlsmSettingsSchema>;

const endpointBase = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,30}$/, 'Code de 2 à 30 caractères : lettres, chiffres, - et _.'),
  name: z.string().trim().min(2, 'Nom obligatoire.').max(120),
  transport: z.enum(INTEROP_TRANSPORTS),
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .url('Adresse invalide (ex. https://dhis2.exemple.cd).')
    .refine((v) => /^https?:\/\//i.test(v), 'Adresse http:// ou https:// uniquement.')
    .transform((v) => v.replace(/\/+$/, '')),
  authMode: z.enum(INTEROP_AUTH_MODES),
  username: optionalText(120),
  /** Nouveau secret (mot de passe, jeton ou mot de passe du client OpenHIM). Absent : inchangé. */
  secret: z.string().max(500).optional().transform((v) => (v === undefined || v === '' ? undefined : v)),
  clearSecret: z.boolean().optional(),
  timeoutSeconds: z.coerce.number().int().min(5).max(300).default(30),
  isActive: z.boolean().optional(),
});

const authRefine = (v: z.infer<typeof endpointBase>, ctx: z.RefinementCtx) => {
  if (v.transport === 'OPENHIM' && v.authMode !== 'BASIC') {
    ctx.addIssue({ code: 'custom', path: ['authMode'], message: 'Via OpenHIM, l’authentification se fait par le client OpenHIM (identifiant et mot de passe).' });
  }
  if (v.authMode === 'BASIC' && !v.username) {
    ctx.addIssue({ code: 'custom', path: ['username'], message: v.transport === 'OPENHIM' ? 'Identifiant du client OpenHIM obligatoire.' : 'Identifiant obligatoire.' });
  }
  if (v.secret !== undefined && v.clearSecret) {
    ctx.addIssue({ code: 'custom', path: ['clearSecret'], message: 'Choisissez entre remplacer et effacer le secret.' });
  }
};

export const interopEndpointSchema = z.discriminatedUnion('system', [
  endpointBase.extend({ system: z.literal('DHIS2'), settings: dhis2SettingsSchema }).strict(),
  endpointBase.extend({ system: z.literal('VLSM'), settings: vlsmSettingsSchema }).strict(),
]).superRefine(authRefine);
export type InteropEndpointInput = z.infer<typeof interopEndpointSchema>;

export const dhis2MappingSchema = z
  .object({
    label: z.string().trim().min(2, 'Libellé obligatoire.').max(150),
    parameterId: z.string().uuid('Paramètre obligatoire.'),
    measure: z.enum(DHIS2_MEASURES),
    threshold: z.coerce.number().positive('Seuil strictement positif.').max(1e12).nullish().transform((v) => v ?? null),
    textMatch: optionalText(100),
    sex: z.enum(RANGE_SEXES).default('ANY'),
    ageMinYears: z.coerce.number().int().min(0).max(130).nullish().transform((v) => v ?? null),
    ageMaxYears: z.coerce.number().int().min(1).max(150).nullish().transform((v) => v ?? null),
    dataElement: uid('Élément de données'),
    categoryOptionCombo: optionalUid('Combinaison de catégories'),
    displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.measure === 'NUMERIC_BELOW' || v.measure === 'NUMERIC_AT_OR_ABOVE') && v.threshold === null) {
      ctx.addIssue({ code: 'custom', path: ['threshold'], message: 'Seuil obligatoire pour cette mesure (ex. 1000 copies/ml).' });
    }
    if (v.measure === 'TEXT_EQUALS' && !v.textMatch) ctx.addIssue({ code: 'custom', path: ['textMatch'], message: 'Texte attendu obligatoire.' });
    if (v.ageMinYears !== null && v.ageMaxYears !== null && v.ageMaxYears <= v.ageMinYears) {
      ctx.addIssue({ code: 'custom', path: ['ageMaxYears'], message: 'L’âge maximal (exclu) doit dépasser l’âge minimal.' });
    }
  });
export type Dhis2MappingInput = z.infer<typeof dhis2MappingSchema>;

export const vlsmMappingSchema = z
  .object({
    parameterId: z.string().uuid('Paramètre obligatoire.'),
    testType: z.enum(VLSM_TEST_TYPES),
    /** EID : valeurs du paramètre (choix) correspondant à positive / negative / indeterminate. */
    eidPositive: optionalText(100),
    eidNegative: optionalText(100),
    eidIndeterminate: optionalText(100),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.testType === 'EID' && (!v.eidPositive || !v.eidNegative)) {
      ctx.addIssue({ code: 'custom', path: [v.eidPositive ? 'eidNegative' : 'eidPositive'], message: 'EID : indiquez les valeurs « positif » et « négatif » du paramètre.' });
    }
  });
export type VlsmMappingInput = z.infer<typeof vlsmMappingSchema>;

export const dhis2PeriodQuerySchema = z.object({
  period: z.string().trim().regex(DHIS2_MONTH_PERIOD_REGEX, 'Période mensuelle AAAAMM (ex. 202611).'),
});
export type Dhis2PeriodQuery = z.infer<typeof dhis2PeriodQuerySchema>;

export const dhis2SendSchema = dhis2PeriodQuerySchema.extend({ dryRun: z.boolean().default(true) }).strict();
export type Dhis2SendInput = z.infer<typeof dhis2SendSchema>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ.');
export const vlsmPendingQuerySchema = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
});
export type VlsmPendingQuery = z.infer<typeof vlsmPendingQuerySchema>;

export const VLSM_MAX_BATCH = 100;
export const vlsmSendSchema = z
  .object({
    orderItemIds: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins un résultat.').max(VLSM_MAX_BATCH, `${VLSM_MAX_BATCH} résultats au plus par envoi.`),
  })
  .strict();
export type VlsmSendInput = z.infer<typeof vlsmSendSchema>;

export const interopRunsQuerySchema = paginationQuerySchema.extend({
  endpointId: z.string().uuid().optional(),
  kind: z.enum(INTEROP_RUN_KINDS).optional(),
  status: z.enum(INTEROP_RUN_STATUSES).optional(),
});
export type InteropRunsQuery = z.infer<typeof interopRunsQuerySchema>;

// --- DTO -------------------------------------------------------------------

export interface InteropEndpointDto {
  id: string;
  code: string;
  name: string;
  system: InteropSystem;
  transport: InteropTransport;
  baseUrl: string;
  authMode: InteropAuthMode;
  username: string | null;
  /** Le secret n'est jamais renvoyé : seulement sa présence. */
  hasSecret: boolean;
  timeoutSeconds: number;
  isActive: boolean;
  settings: Dhis2Settings | VlsmSettings;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  mappingCount: number;
  updatedAt: string;
}

export interface MappingParameterDto {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  resultType: string;
  choices: string[];
  examCode: string;
  examName: string;
}

export interface Dhis2MappingDto {
  id: string;
  endpointId: string;
  label: string;
  parameter: MappingParameterDto;
  measure: Dhis2Measure;
  threshold: number | null;
  textMatch: string | null;
  sex: RangeSex;
  ageMinYears: number | null;
  ageMaxYears: number | null;
  dataElement: string;
  categoryOptionCombo: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface VlsmMappingDto {
  id: string;
  endpointId: string;
  parameter: MappingParameterDto;
  testType: VlsmTestType;
  eidPositive: string | null;
  eidNegative: string | null;
  eidIndeterminate: string | null;
  isActive: boolean;
}

export interface Dhis2PreviewLineDto {
  mappingId: string;
  label: string;
  dataElement: string;
  categoryOptionCombo: string | null;
  value: number;
  excludedNoAge: number;
  excludedAmbiguous: number;
  sent: boolean;
}

export interface Dhis2PreviewDto {
  endpointId: string;
  period: string;
  periodFrom: string;
  periodTo: string;
  resultCount: number;
  lines: Dhis2PreviewLineDto[];
  warnings: string[];
  payloadSha256: string;
  lastSentAt: string | null;
  lastSentSha256: string | null;
}

export interface Dhis2ConflictDto {
  object: string | null;
  value: string;
  errorCode: string | null;
}

export interface InteropRunDto {
  id: string;
  endpoint: { id: string; code: string; name: string; system: InteropSystem; transport: InteropTransport };
  kind: InteropRunKind;
  status: InteropRunStatus;
  period: string | null;
  itemCount: number;
  payloadSha256: string | null;
  httpStatus: number | null;
  openhimTransactionId: string | null;
  imported: number | null;
  updated: number | null;
  ignored: number | null;
  deleted: number | null;
  conflicts: Dhis2ConflictDto[];
  message: string | null;
  durationMs: number;
  triggeredBy: string | null;
  createdAt: string;
}

export interface InteropRunDetailDto extends InteropRunDto {
  payload: unknown;
  submissions: VlsmSubmissionDto[];
}

export interface VlsmSubmissionDto {
  id: string;
  orderItemId: string;
  sampleNumber: string;
  itemVersion: number;
  status: VlsmSubmissionStatus;
  remoteSampleCode: string | null;
  message: string | null;
  createdAt: string;
}

export interface VlsmPendingItemDto {
  orderItemId: string;
  orderId: string;
  orderNumber: string;
  sampleNumber: string;
  patientCode: string;
  patientName: string;
  patientArtNo: string | null;
  examName: string;
  testType: VlsmTestType;
  value: string | null;
  validatedAt: string;
  itemVersion: number;
  /** Raison bloquante (donnée obligatoire manquante pour VLSM) ; null si l'envoi est possible. */
  blocker: string | null;
  lastAttempt: { status: VlsmSubmissionStatus; message: string | null; at: string; itemVersion: number } | null;
}

export interface InteropOverviewDto {
  encryptionReady: boolean;
}
