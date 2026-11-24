import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Dhis2ConflictDto, InteropRunDetailDto, InteropRunDto, InteropRunKind, InteropRunStatus, InteropRunsQuery, Paginated } from '@lims/shared';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import { NotFoundError } from '../../core/errors/domain.exception';
import type { Db } from '../../core/prisma/prisma.service';
import { toRunDto } from './interop.mapper';
import { InteropRepository } from './interop.repository';

/** Empreinte SHA-256 d'une charge utile JSON (sérialisation déterministe : clés triées). */
export function payloadSha256(payload: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(payload)), 'utf8').digest('hex');
}

export interface RunRecord {
  endpointId: string;
  kind: InteropRunKind;
  status: InteropRunStatus;
  period?: string | null;
  itemCount?: number;
  payload?: unknown;
  /** Contenu dont l'empreinte est conservée quand la charge stockée en est une version expurgée (données patient). */
  hashedContent?: unknown;
  httpStatus?: number | null;
  openhimTransactionId?: string | null;
  imported?: number | null;
  updated?: number | null;
  ignored?: number | null;
  deleted?: number | null;
  conflicts?: Dhis2ConflictDto[];
  message?: string | null;
  durationMs: number;
  triggeredById: string;
}

@Injectable()
export class InteropRunsService {
  constructor(
    private readonly repo: InteropRepository,
    private readonly audit: AuditService,
    private readonly lab: LabContextService,
  ) {}

  /** Inscrit un échange au journal (ajout seul) et dans la piste d'audit, dans la même transaction. */
  async record(tx: Db, r: RunRecord): Promise<string> {
    const hashed = r.hashedContent !== undefined ? r.hashedContent : r.payload;
    const sha = hashed === undefined ? null : payloadSha256(hashed);
    const run = await tx.interopRun.create({
      data: {
        endpointId: r.endpointId,
        kind: r.kind,
        status: r.status,
        period: r.period ?? null,
        itemCount: r.itemCount ?? 0,
        payload: r.payload === undefined ? Prisma.DbNull : (r.payload as Prisma.InputJsonValue),
        payloadSha256: sha,
        httpStatus: r.httpStatus ?? null,
        openhimTransactionId: r.openhimTransactionId ?? null,
        imported: r.imported ?? null,
        updated: r.updated ?? null,
        ignored: r.ignored ?? null,
        deleted: r.deleted ?? null,
        conflicts: r.conflicts && r.conflicts.length ? (r.conflicts as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        message: r.message?.slice(0, 1000) ?? null,
        durationMs: Math.max(0, Math.round(r.durationMs)),
        triggeredById: r.triggeredById,
      },
    });
    const { payload: _payload, ...summary } = run;
    await this.audit.record(tx, { action: 'CREATE', entity: 'InteropRun', entityId: run.id, after: summary });
    return run.id;
  }

  async list(query: InteropRunsQuery): Promise<Paginated<InteropRunDto>> {
    const [rows, total] = await this.repo.listRuns(query);
    const names = await this.lab.userNames(rows.map((r) => r.triggeredById));
    return toPage(rows.map((r) => toRunDto(r, names)), total, query);
  }

  async get(id: string): Promise<InteropRunDetailDto> {
    const row = await this.repo.findRun(id);
    if (!row) throw new NotFoundError('Échange', id);
    const names = await this.lab.userNames([row.triggeredById]);
    return {
      ...toRunDto(row, names),
      payload: row.payload,
      submissions: row.submissions.map((s) => ({
        id: s.id,
        orderItemId: s.orderItemId,
        sampleNumber: s.orderItem.sample.number,
        itemVersion: s.itemVersion,
        status: s.status,
        remoteSampleCode: s.remoteSampleCode,
        message: s.message,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }
}
