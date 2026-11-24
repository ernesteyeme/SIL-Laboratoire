import { z } from 'zod';

/** Texte facultatif : chaîne vide → null, espaces supprimés. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const reasonSchema = z
  .string()
  .trim()
  .min(5, 'Le motif doit contenir au moins 5 caractères.')
  .max(500);

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  path: string;
  timestamp: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}
