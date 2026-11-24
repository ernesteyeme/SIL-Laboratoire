import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { AuditAction, AuditEntity, AuditLogDto, AuditVerifyResult, ListAuditQuery, Paginated } from '@lims/shared';
import type { AuditLog, Prisma } from '../../generated/prisma/client';
import type { AppClsStore } from '../context/request-context';
import type { Db } from '../prisma/prisma.service';
import { AuditRepository } from './audit.repository';
import { toAuditJson } from './audit-serializer';

export interface AuditEntry {
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Acteur explicite (ex. connexion, où l'utilisateur n'est pas encore dans le contexte). */
  actor?: { id: string; username: string; roles: AuditLog['actorRoles'] } | null;
}

/**
 * Point d'entrée unique de la piste d'audit.
 * Toujours appeler `record` avec le client de transaction (`tx`) de l'opération métier
 * pour que la donnée et sa trace soient validées ou annulées ensemble.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async record(db: Db, entry: AuditEntry): Promise<void> {
    const ctxActive = this.cls.isActive();
    const contextUser = ctxActive ? this.cls.get('user') : undefined;
    const actor = entry.actor === undefined ? contextUser : entry.actor;

    await this.repository.insert(db, {
      actorId: actor?.id ?? null,
      actorUsername: actor?.username ?? null,
      actorRoles: actor?.roles ?? [],
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId.slice(0, 64),
      before: entry.before === undefined ? undefined : (toAuditJson(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (toAuditJson(entry.after) as Prisma.InputJsonValue),
      reason: entry.reason?.slice(0, 500) ?? null,
      requestId: ctxActive ? (this.cls.getId()?.slice(0, 64) ?? null) : null,
      ip: ctxActive ? (this.cls.get('ip')?.slice(0, 64) ?? null) : null,
      userAgent: ctxActive ? (this.cls.get('userAgent')?.slice(0, 500) ?? null) : null,
    });
  }

  async list(query: ListAuditQuery): Promise<Paginated<AuditLogDto>> {
    const [rows, total] = await this.repository.findMany(query);
    return {
      items: rows.map(toAuditLogDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async verify(): Promise<AuditVerifyResult> {
    const result = await this.repository.verifyChain();
    return {
      valid: result.issues.length === 0,
      totalEntries: result.total,
      checkedAt: new Date().toISOString(),
      lastSeq: result.lastSeq === null ? null : Number(result.lastSeq),
      lastHash: result.lastHash,
      issues: result.issues.map((i) => ({ seq: Number(i.seq), issue: i.issue })),
    };
  }
}

export function toAuditLogDto(row: AuditLog): AuditLogDto {
  return {
    id: row.id.toString(),
    seq: Number(row.seq),
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorId,
    actorUsername: row.actorUsername,
    actorRoles: row.actorRoles,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    reason: row.reason,
    requestId: row.requestId,
    ip: row.ip,
    userAgent: row.userAgent,
    hash: row.hash,
  };
}
