import { z } from 'zod';
import {
  INSTRUMENT_MESSAGE_STATUSES,
  INSTRUMENT_PROTOCOLS,
  INSTRUMENT_RESULT_STATUSES,
  type InstrumentMessageSource,
  type InstrumentMessageStatus,
  type InstrumentProtocol,
  type InstrumentResultKind,
  type InstrumentResultStatus,
  type ResultType,
} from '../enums';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';

/** Taille maximale d'un message ou d'un fichier importé (2 Mo de texte). */
export const MAX_INSTRUMENT_MESSAGE_CHARS = 2_000_000;

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;

/** Colonnes du fichier CSV : noms d'en-tête, ou numéros de colonne (1, 2, 3…) si le fichier n'a pas d'en-tête. */
export const csvConfigSchema = z
  .object({
    delimiter: z.enum(CSV_DELIMITERS),
    hasHeader: z.boolean(),
    specimenColumn: z.string().trim().min(1, 'Colonne de l’échantillon obligatoire.').max(60),
    testColumn: z.string().trim().min(1, 'Colonne du code test obligatoire.').max(60),
    valueColumn: z.string().trim().min(1, 'Colonne du résultat obligatoire.').max(60),
    unitColumn: optionalText(60),
    flagsColumn: optionalText(60),
    measuredAtColumn: optionalText(60),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.hasHeader) return;
    for (const key of ['specimenColumn', 'testColumn', 'valueColumn', 'unitColumn', 'flagsColumn', 'measuredAtColumn'] as const) {
      const col = v[key];
      if (col && !/^[1-9]\d?$/.test(col)) ctx.addIssue({ code: 'custom', path: [key], message: 'Sans en-tête, indiquez un numéro de colonne (1, 2, 3…).' });
    }
  });
export type CsvConfig = z.infer<typeof csvConfigSchema>;

export const instrumentSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,30}$/, 'Code de 2 à 30 caractères : lettres, chiffres, - et _.'),
    name: z.string().trim().min(2, 'Nom obligatoire.').max(120),
    manufacturer: optionalText(120),
    model: optionalText(120),
    sectionId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullish()),
    protocol: z.enum(INSTRUMENT_PROTOCOLS),
    csvConfig: csvConfigSchema.nullish(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.protocol === 'CSV' && !v.csvConfig) ctx.addIssue({ code: 'custom', path: ['csvConfig'], message: 'Décrivez les colonnes du fichier CSV.' });
  });
export type InstrumentInput = z.infer<typeof instrumentSchema>;

export const instrumentMappingSchema = z
  .object({
    /** Code du test tel que l'automate l'envoie (ASTM R-3, HL7 OBX-3, colonne CSV). */
    instrumentCode: z.string().trim().min(1, 'Code de l’automate obligatoire.').max(40),
    parameterId: z.string().uuid('Paramètre obligatoire.'),
    /** Facteur multiplicatif appliqué aux valeurs numériques (conversion d'unité). */
    factor: z
      .union([z.number(), z.string()])
      .transform((v) => (typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))))
      .refine((v) => Number.isFinite(v) && v > 0, 'Facteur strictement positif attendu.')
      .default(1),
    /** Table de correspondance des valeurs : « TND » → « <40 », « POS » → « Positif ». */
    valueMap: z
      .record(z.string().trim().min(1).max(60), z.string().trim().min(1).max(60))
      .refine((m) => Object.keys(m).length <= 30, '30 correspondances au maximum.')
      .default({}),
    isActive: z.boolean().optional(),
  })
  .strict();
export type InstrumentMappingInput = z.infer<typeof instrumentMappingSchema>;

export const instrumentQcMaterialSchema = z
  .object({
    /** Identifiant d'échantillon que l'automate envoie pour ce contrôle (ex. « QC1 », « CTRL-N 12345 »). */
    specimenId: z.string().trim().min(1, 'Identifiant obligatoire.').max(60),
    materialId: z.string().uuid('Lot de contrôle obligatoire.'),
  })
  .strict();
export type InstrumentQcMaterialInput = z.infer<typeof instrumentQcMaterialSchema>;

/** Message transmis par le connecteur de poste. */
export const gatewayMessageSchema = z
  .object({
    message: z.string().min(1, 'Message vide.').max(MAX_INSTRUMENT_MESSAGE_CHARS, 'Message trop volumineux (2 Mo maximum).'),
  })
  .strict();
export type GatewayMessageInput = z.infer<typeof gatewayMessageSchema>;

/** Import manuel d'un fichier exporté par l'automate. */
export const instrumentUploadSchema = z
  .object({
    content: z.string().min(1, 'Fichier vide.').max(MAX_INSTRUMENT_MESSAGE_CHARS, 'Fichier trop volumineux (2 Mo maximum).'),
    filename: optionalText(200),
  })
  .strict();
export type InstrumentUploadInput = z.infer<typeof instrumentUploadSchema>;

export const dismissInstrumentResultSchema = z.object({ reason: reasonSchema }).strict();
export type DismissInstrumentResultInput = z.infer<typeof dismissInstrumentResultSchema>;

export const instrumentMessagesQuerySchema = paginationQuerySchema.extend({
  instrumentId: z.string().uuid().optional(),
  status: z.enum(INSTRUMENT_MESSAGE_STATUSES).optional(),
});
export type InstrumentMessagesQuery = z.infer<typeof instrumentMessagesQuerySchema>;

export const instrumentResultsQuerySchema = paginationQuerySchema.extend({
  instrumentId: z.string().uuid().optional(),
  /** TO_REVIEW = conflits, non appariés et examens déjà validés. */
  status: z.enum([...INSTRUMENT_RESULT_STATUSES, 'TO_REVIEW']).default('TO_REVIEW'),
  q: optionalText(60),
});
export type InstrumentResultsQuery = z.infer<typeof instrumentResultsQuerySchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface InstrumentMappingDto {
  id: string;
  instrumentCode: string;
  parameter: { id: string; code: string; name: string; unit: string | null; resultType: ResultType; choices: string[]; examCode: string; examName: string };
  factor: number;
  valueMap: Record<string, string>;
  isActive: boolean;
}

export interface InstrumentDto {
  id: string;
  code: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  section: { id: string; name: string } | null;
  protocol: InstrumentProtocol;
  csvConfig: CsvConfig | null;
  isActive: boolean;
  /** Début de la clé, pour l'identifier (la clé complète n'est montrée qu'une fois). */
  apiKeyPrefix: string | null;
  apiKeyRotatedAt: string | null;
  lastMessageAt: string | null;
  /** Résultats reçus en attente d'une décision */
  pendingCount: number;
  mappings: InstrumentMappingDto[];
  qcMaterials: { id: string; specimenId: string; material: { id: string; name: string; level: string; lotNumber: string; isActive: boolean } }[];
}

export interface InstrumentApiKeyDto {
  /** Clé complète, affichée une seule fois. */
  apiKey: string;
  prefix: string;
}

export interface InstrumentResultDto {
  id: string;
  messageId: string;
  instrument: { id: string; code: string; name: string };
  kind: InstrumentResultKind;
  specimenId: string;
  testCode: string;
  rawValue: string;
  unit: string | null;
  flags: string | null;
  measuredAt: string | null;
  status: InstrumentResultStatus;
  reason: string | null;
  parameter: { id: string; code: string; name: string } | null;
  order: { id: string; number: string } | null;
  qcRunId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface InstrumentMessageDto {
  id: string;
  instrument: { id: string; code: string; name: string };
  protocol: InstrumentProtocol;
  source: InstrumentMessageSource;
  filename: string | null;
  receivedAt: string;
  receivedBy: string | null;
  status: InstrumentMessageStatus;
  error: string | null;
  resultCount: number;
  appliedCount: number;
  sha256: string;
}

export interface InstrumentMessageDetailDto extends InstrumentMessageDto {
  raw: string;
  warnings: string[];
  results: InstrumentResultDto[];
}

export interface IngestResultDto {
  messageId: string;
  /** Message déjà reçu (retransmission) : rien n'est réappliqué. */
  duplicate: boolean;
  status: InstrumentMessageStatus;
  counts: Partial<Record<InstrumentResultStatus, number>>;
  warnings: string[];
  /** Accusé de réception HL7 (ACK) à renvoyer à l'automate, pour le protocole HL7. */
  ack: string | null;
}

/** Liste de travail (requête hôte) pour le connecteur : examens en attente sur cet automate. */
export interface InstrumentWorklistDto {
  generatedAt: string;
  orders: {
    sampleNumber: string;
    priority: 'ROUTINE' | 'URGENT';
    patient: { code: string; lastName: string; firstName: string | null; sex: 'MALE' | 'FEMALE' | 'UNKNOWN'; birthDate: string | null };
    collectedAt: string | null;
    tests: string[];
  }[];
  /** Même contenu au format ASTM E1394, prêt à transmettre à l'automate. */
  astm: string;
}
