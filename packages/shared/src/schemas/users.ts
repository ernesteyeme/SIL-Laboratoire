import { z } from 'zod';
import { isSectionScoped, ROLES, type Role } from '../enums';

import { optionalText, paginationQuerySchema, reasonSchema } from './common';
import { passwordPolicySchema, usernameSchema } from './auth';

const rolesSchema = z
  .array(z.enum(ROLES))
  .min(1, 'Au moins un rôle est obligatoire.')
  .max(ROLES.length)
  .refine((r) => new Set(r).size === r.length, 'Un rôle ne peut pas être attribué deux fois.');

/** Services (sections) où la personne est habilitée ; obligatoires pour les techniciens et biologistes. */
const sectionIdsSchema = z
  .array(z.string().uuid('Service invalide.'))
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'Un service ne peut pas être attribué deux fois.');

const SECTION_REQUIRED_MESSAGE = 'Un technicien ou un biologiste doit être habilité sur au moins un service.';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v))
  .refine((v) => v == null || z.string().email().safeParse(v).success, 'Adresse e-mail invalide.');

export const createUserSchema = z
  .object({
    username: usernameSchema,
    fullName: z.string().trim().min(2, 'Le nom complet est obligatoire.').max(120),
    email: emailSchema,
    roles: rolesSchema,
    sectionIds: sectionIdsSchema.default([]),
    temporaryPassword: passwordPolicySchema,
  })
  .strict()
  .superRefine((d, ctx) => {
    if (isSectionScoped(d.roles) && d.sectionIds.length === 0) ctx.addIssue({ code: 'custom', path: ['sectionIds'], message: SECTION_REQUIRED_MESSAGE });
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    email: emailSchema,
    roles: rolesSchema.optional(),
    sectionIds: sectionIdsSchema.optional(),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Aucune modification fournie.');

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z
  .object({
    temporaryPassword: passwordPolicySchema,
    reason: reasonSchema,
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const userStatusChangeSchema = z.object({ reason: reasonSchema }).strict();
export type UserStatusChangeInput = z.infer<typeof userStatusChangeSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: optionalText(100),
  role: z.enum(ROLES).optional(),
  sectionId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface UserSectionDto {
  id: string;
  code: string;
  name: string;
  grantedAt: string;
}

export interface UserDto {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  roles: Role[];
  /** Services où la personne est habilitée (vide pour les rôles non limités à un service). */
  sections: UserSectionDto[];
  isActive: boolean;
  mustChangePassword: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
}

export { SECTION_REQUIRED_MESSAGE };
