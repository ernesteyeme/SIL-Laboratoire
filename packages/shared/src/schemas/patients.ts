import { z } from 'zod';
import { SEXES, type Sex } from '../enums';
import { isValidIsoDate, parseIsoDate, todayIso } from '../clinical';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';

export const isoDateSchema = z
  .string()
  .trim()
  .refine(isValidIsoDate, 'Date invalide (format attendu : AAAA-MM-JJ).');

const birthDateSchema = isoDateSchema
  .refine((v) => v <= todayIso(), 'La date de naissance ne peut pas être dans le futur.')
  .refine((v) => parseIsoDate(v).getUTCFullYear() >= new Date().getFullYear() - 130, 'Date de naissance improbable (plus de 130 ans).');

const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v))
  .refine((v) => v == null || /^\+?[0-9 ().-]{6,30}$/.test(v), 'Numéro de téléphone invalide.');

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v))
  .refine((v) => v == null || z.string().email().safeParse(v).success, 'Adresse e-mail invalide.');

const patientFields = {
  /** Nom de famille */
  lastName: z.string().trim().min(1, 'Le nom est obligatoire.').max(80),
  /** Postnom */
  middleName: optionalText(80),
  /** Prénom */
  firstName: optionalText(80),
  sex: z.enum(SEXES, { errorMap: () => ({ message: 'Le sexe est obligatoire.' }) }),
  birthDate: z.preprocess((v) => (v === '' ? null : v), birthDateSchema.nullish()),
  /** true si seule l'année (ou l'âge) est connue */
  birthDateEstimated: z.boolean(),
  phone: phoneSchema,
  email: emailSchema,
  address: optionalText(300),
  city: optionalText(100),
  /** Identifiant externe (n° de dossier hospitalier, code TARV…) */
  externalId: optionalText(50),
  notes: optionalText(1000),
};

export const createPatientSchema = z
  .object({
    ...patientFields,
    birthDateEstimated: patientFields.birthDateEstimated.default(false),
    /** À cocher par l'opérateur après examen des doublons potentiels signalés. */
    confirmNotDuplicate: z.boolean().default(false),
  })
  .strict()
  .refine((d) => !d.birthDateEstimated || !!d.birthDate, {
    message: 'Une date de naissance (même estimée) est requise si « estimée » est coché.',
    path: ['birthDate'],
  });

export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = z
  .object({
    lastName: patientFields.lastName.optional(),
    middleName: patientFields.middleName,
    firstName: patientFields.firstName,
    sex: patientFields.sex.optional(),
    birthDate: patientFields.birthDate,
    birthDateEstimated: patientFields.birthDateEstimated.optional(),
    phone: patientFields.phone,
    email: patientFields.email,
    address: patientFields.address,
    city: patientFields.city,
    externalId: patientFields.externalId,
    notes: patientFields.notes,
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Aucune modification fournie.');

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const duplicateCheckSchema = z
  .object({
    lastName: z.string().trim().min(1).max(80),
    middleName: optionalText(80),
    firstName: optionalText(80),
    sex: z.enum(SEXES).optional(),
    birthDate: z.preprocess((v) => (v === '' ? null : v), isoDateSchema.nullish()),
    phone: phoneSchema,
    externalId: optionalText(50),
    excludeId: z.string().uuid().optional(),
  })
  .strict();

export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

export const listPatientsQuerySchema = paginationQuerySchema.extend({
  q: optionalText(100),
  sex: z.enum(SEXES).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});

export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;

export const patientStatusChangeSchema = z.object({ reason: reasonSchema }).strict();
export type PatientStatusChangeInput = z.infer<typeof patientStatusChangeSchema>;

export interface PatientDto {
  id: string;
  code: string;
  lastName: string;
  middleName: string | null;
  firstName: string | null;
  /** « NOM POSTNOM Prénom » */
  fullName: string;
  sex: Sex;
  birthDate: string | null;
  birthDateEstimated: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  externalId: string | null;
  notes: string | null;
  isActive: boolean;
  deactivationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateCandidate {
  patient: PatientDto;
  /** Score entre 0 et 1 */
  score: number;
  reasons: string[];
}

/** Format du nom à l'affichage : NOM POSTNOM Prénom */
export function formatPatientName(p: { lastName: string; middleName?: string | null; firstName?: string | null }): string {
  return [p.lastName.toUpperCase(), p.middleName?.toUpperCase(), p.firstName].filter(Boolean).join(' ');
}
