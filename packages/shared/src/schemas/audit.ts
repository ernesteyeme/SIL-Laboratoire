import { z } from 'zod';
import { AUDIT_ACTIONS, type AuditAction, type Role } from '../enums';
import { optionalText, paginationQuerySchema } from './common';

export const listAuditQuerySchema = paginationQuerySchema
  .extend({
    entity: optionalText(64),
    entityId: optionalText(64),
    actorId: z.string().uuid().optional(),
    action: z.enum(AUDIT_ACTIONS).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'La date de début doit précéder la date de fin.',
    path: ['to'],
  });

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export interface AuditLogDto {
  id: string;
  seq: number;
  occurredAt: string;
  actorId: string | null;
  actorUsername: string | null;
  actorRoles: Role[];
  action: AuditAction;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  hash: string;
}

export type AuditIssueType = 'HASH_MISMATCH' | 'CHAIN_BROKEN' | 'SEQUENCE_GAP';

export interface AuditVerifyResult {
  valid: boolean;
  totalEntries: number;
  checkedAt: string;
  /** Dernier hash de la chaîne : à consigner dans un registre externe pour l'ancrage. */
  lastSeq: number | null;
  lastHash: string | null;
  issues: { seq: number; issue: AuditIssueType }[];
}
