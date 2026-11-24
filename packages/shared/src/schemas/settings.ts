import { z } from 'zod';
import { optionalText } from './common';

export const labSettingsSchema = z
  .object({
    name: z.string().trim().min(2, 'Le nom du laboratoire est obligatoire.').max(200),
    shortName: optionalText(50),
    address: optionalText(300),
    city: optionalText(100),
    country: optionalText(100),
    phone: optionalText(50),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .nullish()
      .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v))
      .refine((v) => v == null || z.string().email().safeParse(v).success, 'Adresse e-mail invalide.'),
    accreditationNumber: optionalText(100),
    accreditationBody: optionalText(200),
    directorName: optionalText(200),
    reportFooter: optionalText(2000),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Code devise ISO 4217 attendu (ex. CDF, USD).'),
    timezone: z.string().trim().min(3).max(64),
    /** Si vrai, un échantillon ne peut être prélevé qu'après paiement complet (sauf demande urgente). */
    requirePaymentBeforeCollection: z.boolean().default(false),
    /** Caisse bi-devise CDF/USD : la devise de base (tarifs, comptabilité) est `currency`, l'autre est acceptée au taux du jour. */
    secondaryCurrencyEnabled: z.boolean().default(false),
  })
  .strict()
  .refine((d) => !d.secondaryCurrencyEnabled || d.currency === 'CDF' || d.currency === 'USD', {
    message: 'La caisse bi-devise exige une devise de base CDF ou USD.',
    path: ['secondaryCurrencyEnabled'],
  });

export type LabSettingsInput = z.infer<typeof labSettingsSchema>;
export type LabSettingsFormValues = z.input<typeof labSettingsSchema>;

export interface LabSettingsDto {
  name: string;
  shortName: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  accreditationNumber: string | null;
  accreditationBody: string | null;
  directorName: string | null;
  reportFooter: string | null;
  currency: string;
  timezone: string;
  requirePaymentBeforeCollection: boolean;
  secondaryCurrencyEnabled: boolean;
  /** Devise secondaire effective (CDF ou USD), null si caisse mono-devise */
  secondaryCurrency: string | null;
  updatedAt: string;
}
