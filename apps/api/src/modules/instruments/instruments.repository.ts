import { Injectable } from '@nestjs/common';
import type { InstrumentMessagesQuery, InstrumentResultsQuery } from '@lims/shared';
import { INSTRUMENT_RESULT_TO_REVIEW } from '@lims/shared';
import type { Prisma } from '../../generated/prisma/client';
import { skipTake } from '../../core/common/pagination';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export const mappingParameterSelect = {
  id: true,
  code: true,
  name: true,
  unit: true,
  resultType: true,
  choices: true,
  decimals: true,
  exam: { select: { code: true, name: true } },
} satisfies Prisma.ExamParameterSelect;

export const instrumentInclude = {
  section: { select: { id: true, name: true } },
  mappings: { include: { parameter: { select: mappingParameterSelect } }, orderBy: { instrumentCode: 'asc' } },
  qcMaterials: { include: { material: { select: { id: true, name: true, level: true, lotNumber: true, isActive: true } } }, orderBy: { specimenId: 'asc' } },
} satisfies Prisma.InstrumentInclude;

export const resultInclude = {
  instrument: { select: { id: true, code: true, name: true } },
} satisfies Prisma.InstrumentResultInclude;

export const messageInclude = {
  instrument: { select: { id: true, code: true, name: true } },
} satisfies Prisma.InstrumentMessageInclude;

export type InstrumentRow = Prisma.InstrumentGetPayload<{ include: typeof instrumentInclude }>;
export type InstrumentResultRow = Prisma.InstrumentResultGetPayload<{ include: typeof resultInclude }>;
export type InstrumentMessageRow = Prisma.InstrumentMessageGetPayload<{ include: typeof messageInclude }>;

@Injectable()
export class InstrumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<InstrumentRow[]> {
    return this.prisma.instrument.findMany({ include: instrumentInclude, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
  }

  find(id: string, db: Db = this.prisma): Promise<InstrumentRow | null> {
    return db.instrument.findUnique({ where: { id }, include: instrumentInclude });
  }

  findByKeyHash(hash: string) {
    return this.prisma.instrument.findUnique({
      where: { apiKeyHash: hash },
      include: { serviceUser: { select: { id: true, username: true, fullName: true, isActive: true } } },
    });
  }

  async pendingCounts(): Promise<Map<string, number>> {
    const rows = await this.prisma.instrumentResult.groupBy({
      by: ['instrumentId'],
      where: { status: { in: INSTRUMENT_RESULT_TO_REVIEW } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.instrumentId, r._count._all]));
  }

  findMessageBySha(instrumentId: string, sha256: string, db: Db = this.prisma) {
    return db.instrumentMessage.findUnique({ where: { instrumentId_sha256: { instrumentId, sha256 } } });
  }

  async messageCounts(messageId: string, db: Db = this.prisma): Promise<Record<string, number>> {
    const rows = await db.instrumentResult.groupBy({ by: ['status'], where: { messageId }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  listMessages(query: InstrumentMessagesQuery): Promise<[InstrumentMessageRow[], number]> {
    const where: Prisma.InstrumentMessageWhereInput = { instrumentId: query.instrumentId, status: query.status };
    return this.prisma.$transaction([
      this.prisma.instrumentMessage.findMany({ where, include: messageInclude, orderBy: { receivedAt: 'desc' }, ...skipTake(query), omit: { raw: true } }),
      this.prisma.instrumentMessage.count({ where }),
    ]) as Promise<[InstrumentMessageRow[], number]>;
  }

  findMessage(id: string) {
    return this.prisma.instrumentMessage.findUnique({
      where: { id },
      include: { ...messageInclude, results: { include: resultInclude, orderBy: [{ specimenId: 'asc' }, { instrumentTestCode: 'asc' }] } },
    });
  }

  listResults(query: InstrumentResultsQuery): Promise<[InstrumentResultRow[], number]> {
    const q = query.q?.trim();
    const where: Prisma.InstrumentResultWhereInput = {
      instrumentId: query.instrumentId,
      status: query.status === 'TO_REVIEW' ? { in: INSTRUMENT_RESULT_TO_REVIEW } : query.status,
      ...(q ? { OR: [{ specimenId: { contains: q, mode: 'insensitive' } }, { instrumentTestCode: { contains: q, mode: 'insensitive' } }] } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.instrumentResult.findMany({ where, include: resultInclude, orderBy: { createdAt: 'desc' }, ...skipTake(query) }),
      this.prisma.instrumentResult.count({ where }),
    ]);
  }

  findResult(id: string, db: Db = this.prisma): Promise<InstrumentResultRow | null> {
    return db.instrumentResult.findUnique({ where: { id }, include: resultInclude });
  }

  async lockResult(id: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT id FROM "instrument_results" WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Commandes de demandes (n°) et paramètres pour l'affichage des résultats reçus. */
  async resultContext(rows: { specimenId: string; parameterId: string | null; kind: string }[]) {
    const specimens = [...new Set(rows.filter((r) => r.kind === 'PATIENT').map((r) => r.specimenId))];
    const params = [...new Set(rows.map((r) => r.parameterId).filter((p): p is string => !!p))];
    const [samples, parameters] = await Promise.all([
      specimens.length ? this.prisma.sample.findMany({ where: { number: { in: specimens } }, select: { number: true, order: { select: { id: true, number: true } } } }) : [],
      params.length ? this.prisma.examParameter.findMany({ where: { id: { in: params } }, select: { id: true, code: true, name: true } }) : [],
    ]);
    return {
      orders: new Map(samples.map((s) => [s.number, s.order])),
      parameters: new Map(parameters.map((p) => [p.id, p])),
    };
  }
}
