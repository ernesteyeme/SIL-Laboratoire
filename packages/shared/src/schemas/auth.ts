import { z } from 'zod';
import type { Role } from '../enums';

export const PASSWORD_MIN_LENGTH = 10;

export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`)
  .max(128, 'Le mot de passe doit contenir au plus 128 caractères.')
  .refine((v) => /[a-z]/.test(v), 'Le mot de passe doit contenir au moins une minuscule.')
  .refine((v) => /[A-Z]/.test(v), 'Le mot de passe doit contenir au moins une majuscule.')
  .refine((v) => /\d/.test(v), 'Le mot de passe doit contenir au moins un chiffre.')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Le mot de passe doit contenir au moins un caractère spécial.');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._-]{3,50}$/,
    "L'identifiant doit faire 3 à 50 caractères : lettres minuscules, chiffres, point, tiret ou tiret bas.",
  );

export const loginSchema = z
  .object({
    username: z.string().trim().toLowerCase().min(1, "L'identifiant est obligatoire.").max(50),
    password: z.string().min(1, 'Le mot de passe est obligatoire.').max(128),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Le mot de passe actuel est obligatoire.').max(128),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1, 'Veuillez confirmer le nouveau mot de passe.'),
  })
  .strict()
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Les deux mots de passe ne correspondent pas.',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "Le nouveau mot de passe doit être différent de l'actuel.",
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  roles: Role[];
  mustChangePassword: boolean;
}

export interface AuthResponse {
  accessToken: string;
  /** Durée de validité du jeton d'accès, en secondes. */
  expiresIn: number;
  user: AuthUser;
}
