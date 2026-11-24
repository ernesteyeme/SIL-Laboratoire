import { z } from 'zod';
import { ROLES, type Role } from '../enums';
import { optionalText, paginationQuerySchema, reasonSchema } from './common';
import { passwordPolicySchema, usernameSchema } from './auth';

const rolesSchema = z
  .array(z.enum(ROLES))
  .min(1, 'Au moins un rôle est obligatoire.')
  .max(ROLES.length)
  .refine((r) => new Set(r).size === r.length, 'Un rôle ne peut pas être attribué deux fois.');

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
    temporaryPassword: passwordPolicySchema,
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    email: emailSchema,
    roles: rolesSchema.optional(),
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
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface UserDto {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  roles: Role[];
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
