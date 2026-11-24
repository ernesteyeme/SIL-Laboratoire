import { z } from 'zod';
import { passwordPolicySchema, usernameSchema } from './auth';
import { optionalText } from './common';

/**
 * Assistant d'installation (premier démarrage) : disponible tant qu'aucun utilisateur n'existe,
 * et protégé par le code d'installation affiché par l'installateur (`lims setup-token`).
 */
export const SETUP_TIMEZONES = [
  'Africa/Kinshasa',
  'Africa/Lubumbashi',
  'Africa/Brazzaville',
  'Africa/Bujumbura',
  'Africa/Kigali',
  'Africa/Douala',
  'Africa/Libreville',
  'Africa/Bangui',
  'Africa/Ndjamena',
  'Africa/Abidjan',
  'Africa/Dakar',
  'Africa/Bamako',
  'Africa/Ouagadougou',
  'Africa/Niamey',
  'Africa/Lome',
  'Africa/Porto-Novo',
  'Africa/Conakry',
  'Indian/Antananarivo',
  'Africa/Kampala',
  'Africa/Nairobi',
  'Africa/Dar_es_Salaam',
  'Africa/Lusaka',
  'Africa/Luanda',
  'Europe/Paris',
  'UTC',
] as const;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v === undefined || v === null || v === '' ? null : v))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'Adresse e-mail invalide.');

export const setupLabSchema = z
  .object({
    name: z.string().trim().min(2, 'Le nom du laboratoire est obligatoire.').max(200),
    shortName: optionalText(50),
    city: optionalText(100),
    country: optionalText(100),
    phone: optionalText(50),
    email: emailSchema,
    timezone: z.enum(SETUP_TIMEZONES, { errorMap: () => ({ message: 'Fuseau horaire non pris en charge.' }) }),
    currency: z.enum(['CDF', 'USD']),
    secondaryCurrencyEnabled: z.boolean().default(false),
  })
  .strict();
export type SetupLabInput = z.infer<typeof setupLabSchema>;

export const setupAdminSchema = z
  .object({
    username: usernameSchema,
    fullName: z.string().trim().min(3, 'Nom complet obligatoire.').max(120),
    email: emailSchema,
    password: passwordPolicySchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, { message: 'Les deux mots de passe diffèrent.', path: ['confirmPassword'] });
export type SetupAdminInput = z.infer<typeof setupAdminSchema>;

export const setupCompleteSchema = z
  .object({
    token: z.string().trim().min(16, 'Code d’installation incomplet.').max(200),
    lab: setupLabSchema,
    admin: setupAdminSchema,
    loadStarterCatalog: z.boolean().default(true),
  })
  .strict();
export type SetupCompleteInput = z.infer<typeof setupCompleteSchema>;

export const setupTokenCheckSchema = z.object({ token: z.string().trim().min(16, 'Code d’installation incomplet.').max(200) }).strict();
export type SetupTokenCheckInput = z.infer<typeof setupTokenCheckSchema>;

export type SetupCheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface SetupStatusDto {
  /** Vrai tant qu'aucun compte utilisateur n'a été créé. */
  needsSetup: boolean;
  version: string;
  commit: string | null;
  /** Le serveur a reçu un code d'installation (variable SETUP_TOKEN). */
  tokenConfigured: boolean;
  checks: { label: string; status: SetupCheckStatus; detail: string }[];
}

export interface SetupResultDto {
  labName: string;
  adminUsername: string;
  catalogItemsCreated: number;
}

export interface VersionDto {
  version: string;
  commit: string | null;
  builtAt: string | null;
}
