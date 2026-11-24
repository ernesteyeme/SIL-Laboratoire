import { Injectable } from '@nestjs/common';
import type { AuditIssueType, ListAuditQuery } from '@lims/shared';
import { Prisma, type AuditLog } from '../../generated/prisma/client';
import { PrismaService, type Db } from '../prisma/prisma.service';

export interface AuditInsert {
  actorId: string | null;
  actorUsername: string | null;
  actorRoles: AuditLog['actorRoles'];
  action: AuditLog['action'];
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(db: Db, data: AuditInsert): Promise<void> {
    await db.auditLog.create({
      data: {
        actorId: data.actorId,
        actorUsername: data.actorUsername,
        actorRoles: data.actorRoles,
        action: data.action,
        entity: data.entity,
        entityId: data.entityId,
        before: data.before ?? Prisma.DbNull,
        after: data.after ?? Prisma.DbNull,
        reason: data.reason ?? null,
        requestId: data.requestId ?? null,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  }

  async findMany(query: ListAuditQuery): Promise<[AuditLog[], number]> {
    const where: Prisma.AuditLogWhereInput = {
      entity: query.entity ?? undefined,
      entityId: query.entityId ?? undefined,
      actorId: query.actorId,
      action: query.action,
      occurredAt: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { seq: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
  }

  /** Recalcule chaque hash et vérifie le chaînage et la continuité de la séquence. */
  async verifyChain(maxIssues = 200): Promise<{
    total: number;
    lastSeq: bigint | null;
    lastHash: string | null;
    issues: { seq: bigint; issue: AuditIssueType }[];
  }> {
    const issues = await this.prisma.$queryRaw<{ seq: bigint; issue: AuditIssueType }[]>`
      WITH ordered AS (
        SELECT
          "seq",
          "hash",
          "prev_hash",
          lag("hash") OVER (ORDER BY "seq") AS expected_prev,
          lag("seq")  OVER (ORDER BY "seq") AS previous_seq,
          audit_log_compute_hash(
            "seq", "prev_hash", "occurred_at", "actor_id", "action"::text,
            "entity", "entity_id", "before", "after", "reason"
          ) AS recomputed
        FROM "audit_log"
      )
      SELECT "seq",
        CASE
          WHEN recomputed <> "hash" THEN 'HASH_MISMATCH'
          WHEN "prev_hash" IS DISTINCT FROM expected_prev THEN 'CHAIN_BROKEN'
          WHEN (previous_seq IS NULL AND "seq" <> 1) OR (previous_seq IS NOT NULL AND "seq" <> previous_seq + 1)
            THEN 'SEQUENCE_GAP'
        END AS issue
      FROM ordered
      WHERE recomputed <> "hash"
         OR "prev_hash" IS DISTINCT FROM expected_prev
         OR (previous_seq IS NULL AND "seq" <> 1)
         OR (previous_seq IS NOT NULL AND "seq" <> previous_seq + 1)
      ORDER BY "seq"
      LIMIT ${maxIssues}
    `;

    const [total, last] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } }),
    ]);

    return { total, lastSeq: last?.seq ?? null, lastHash: last?.hash ?? null, issues };
  }
}
