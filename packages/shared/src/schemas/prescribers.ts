import { z } from 'zod';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v))
  .refine((v) => v == null || z.string().email().safeParse(v).success, 'Adresse e-mail invalide.');

const phoneSchema = optionalText(30).refine(
  (v) => v == null || /^\+?[0-9 ().-]{6,30}$/.test(v),
  'Numéro de téléphone invalide.',
);

const prescriberFields = {
  /** Titre : Dr, Pr, Inf.… */
  title: optionalText(20),
  lastName: z.string().trim().min(1, 'Le nom est obligatoire.').max(80),
  firstName: optionalText(80),
  specialty: optionalText(100),
  /** Structure / établissement d'exercice */
  facility: optionalText(150),
  phone: phoneSchema,
  email: emailSchema,
  /** N° d'inscription à l'Ordre */
  licenseNumber: optionalText(50),
};

export const createPrescriberSchema = z.object(prescriberFields).strict();
export type CreatePrescriberInput = z.infer<typeof createPrescriberSchema>;

export const updatePrescriberSchema = z
  .object({
    ...prescriberFields,
    lastName: prescriberFields.lastName.optional(),
    isActive: z.boolean().optional(),
    reason: reasonSchema.optional(),
  })
  .strict()
  .refine((d) => Object.entries(d).some(([k, v]) => k !== 'reason' && v !== undefined), 'Aucune modification fournie.')
  .refine((d) => d.isActive === undefined || !!d.reason, {
    message: 'Un motif est obligatoire pour activer ou désactiver un prescripteur.',
    path: ['reason'],
  });

export type UpdatePrescriberInput = z.infer<typeof updatePrescriberSchema>;

export const listPrescribersQuerySchema = paginationQuerySchema.extend({
  q: optionalText(100),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});

export type ListPrescribersQuery = z.infer<typeof listPrescribersQuerySchema>;

export interface PrescriberDto {
  id: string;
  title: string | null;
  lastName: string;
  firstName: string | null;
  /** « Dr KABONGO Jean » */
  displayName: string;
  specialty: string | null;
  facility: string | null;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function formatPrescriberName(p: { title?: string | null; lastName: string; firstName?: string | null }): string {
  return [p.title, p.lastName.toUpperCase(), p.firstName].filter(Boolean).join(' ');
}
