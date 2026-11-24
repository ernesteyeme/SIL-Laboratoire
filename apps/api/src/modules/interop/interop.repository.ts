import { Injectable } from '@nestjs/common';
import type { InteropRunsQuery } from '@lims/shared';
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
  exam: { select: { code: true, name: true } },
} satisfies Prisma.ExamParameterSelect;

export const dhis2MappingInclude = { parameter: { select: mappingParameterSelect } } satisfies Prisma.Dhis2MappingInclude;
export const vlsmMappingInclude = { parameter: { select: mappingParameterSelect } } satisfies Prisma.VlsmMappingInclude;
export const runInclude = {
  endpoint: { select: { id: true, code: true, name: true, system: true, transport: true } },
} satisfies Prisma.InteropRunInclude;

export type Dhis2MappingRow = Prisma.Dhis2MappingGetPayload<{ include: typeof dhis2MappingInclude }>;
export type VlsmMappingRow = Prisma.VlsmMappingGetPayload<{ include: typeof vlsmMappingInclude }>;
export type InteropRunRow = Prisma.InteropRunGetPayload<{ include: typeof runInclude }>;

/** Examen validé candidat à l'envoi vers VLSM, avec tout ce que le format VLSM exige. */
export const vlsmItemSelect = {
  id: true,
  version: true,
  validatedAt: true,
  technicalValidatedAt: true,
  biologistComment: true,
  examName: true,
  order: {
    select: {
      id: true,
      number: true,
      createdAt: true,
      status: true,
      patient: { select: { code: true, lastName: true, middleName: true, firstName: true, sex: true, birthDate: true, externalId: true, phone: true } },
      prescriber: { select: { title: true, lastName: true, firstName: true, phone: true } },
    },
  },
  sample: { select: { number: true, sampleTypeId: true, collectedAt: true, receivedAt: true } },
  results: { select: { parameterId: true, numericValue: true, qualifier: true, textValue: true, enteredAt: true } },
} satisfies Prisma.OrderItemSelect;
export type VlsmItemRow = Prisma.OrderItemGetPayload<{ select: typeof vlsmItemSelect }>;

export interface Dhis2RawRow {
  parameterId: string;
  numericValue: Prisma.Decimal | null;
  qualifier: string | null;
  textValue: string | null;
  sex: 'MALE' | 'FEMALE' | 'UNKNOWN';
  birthDate: Date | null;
  orderCreatedAt: Date;
}

@Injectable()
export class InteropRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Connexions ----------------------------------------------------------

  listEndpoints() {
    return this.prisma.interopEndpoint.findMany({
      orderBy: [{ isActive: 'desc' }, { system: 'asc' }, { code: 'asc' }],
      include: { _count: { select: { dhis2Mappings: true, vlsmMappings: true } } },
    });
  }

  findEndpoint(id: string, db: Db = this.prisma) {
    return db.interopEndpoint.findUnique({
      where: { id },
      include: { _count: { select: { dhis2Mappings: true, vlsmMappings: true } } },
    });
  }

  // --- Correspondances -------------------------------------------------------

  listDhis2Mappings(endpointId: string, onlyActive = false, db: Db = this.prisma) {
    return db.dhis2Mapping.findMany({
      where: { endpointId, ...(onlyActive ? { isActive: true } : {}) },
      include: dhis2MappingInclude,
      orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
    });
  }

  findDhis2Mapping(id: string, db: Db = this.prisma) {
    return db.dhis2Mapping.findUnique({ where: { id }, include: dhis2MappingInclude });
  }

  /** Autre règle alimentant déjà la même cellule DHIS2 (élément × combinaison). */
  findDhis2Cell(db: Db, endpointId: string, dataElement: string, categoryOptionCombo: string | null, exceptId?: string) {
    return db.dhis2Mapping.findFirst({
      where: { endpointId, dataElement, categoryOptionCombo, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, label: true },
    });
  }

  listVlsmMappings(endpointId: string, onlyActive = false, db: Db = this.prisma) {
    return db.vlsmMapping.findMany({
      where: { endpointId, ...(onlyActive ? { isActive: true } : {}) },
      include: vlsmMappingInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  findVlsmMapping(id: string, db: Db = this.prisma) {
    return db.vlsmMapping.findUnique({ where: { id }, include: vlsmMappingInclude });
  }

  findParameter(db: Db, id: string) {
    return db.examParameter.findUnique({ where: { id }, select: mappingParameterSelect });
  }

  // --- Données DHIS2 ---------------------------------------------------------

  /** Résultats des examens validés (validation biologique) dans [start, end[, hors demandes annulées. */
  async dhis2Rows(parameterIds: string[], start: Date, end: Date): Promise<Dhis2RawRow[]> {
    if (parameterIds.length === 0) return [];
    const rows = await this.prisma.testResult.findMany({
      where: {
        parameterId: { in: parameterIds },
        orderItem: { analysisStatus: 'VALIDATED', validatedAt: { gte: start, lt: end }, order: { status: { not: 'CANCELLED' } } },
      },
      select: {
        parameterId: true,
        numericValue: true,
        qualifier: true,
        textValue: true,
        orderItem: { select: { order: { select: { createdAt: true, patient: { select: { sex: true, birthDate: true } } } } } },
      },
    });
    return rows.map((r) => ({
      parameterId: r.parameterId,
      numericValue: r.numericValue,
      qualifier: r.qualifier,
      textValue: r.textValue,
      sex: r.orderItem.order.patient.sex,
      birthDate: r.orderItem.order.patient.birthDate,
      orderCreatedAt: r.orderItem.order.createdAt,
    }));
  }

  lastDhis2Send(endpointId: string, period: string) {
    return this.prisma.interopRun.findFirst({
      where: { endpointId, period, kind: 'DHIS2_SEND', status: { in: ['SUCCESS', 'WARNING'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, payloadSha256: true },
    });
  }

  // --- Données VLSM ----------------------------------------------------------

  vlsmCandidates(parameterIds: string[], start: Date, end: Date, take: number) {
    return this.prisma.orderItem.findMany({
      where: {
        analysisStatus: 'VALIDATED',
        validatedAt: { gte: start, lt: end },
        order: { status: { not: 'CANCELLED' } },
        results: { some: { parameterId: { in: parameterIds } } },
      },
      select: vlsmItemSelect,
      orderBy: { validatedAt: 'asc' },
      take,
    });
  }

  vlsmItemsByIds(ids: string[], parameterIds: string[]) {
    return this.prisma.orderItem.findMany({
      where: { id: { in: ids }, results: { some: { parameterId: { in: parameterIds } } } },
      select: { ...vlsmItemSelect, analysisStatus: true },
    });
  }

  /** Dernière tentative d'envoi de chaque examen vers cette connexion. */
  async lastSubmissions(endpointId: string, orderItemIds: string[]) {
    if (orderItemIds.length === 0) return new Map<string, { status: 'SENT' | 'FAILED'; message: string | null; createdAt: Date; itemVersion: number }>();
    const rows = await this.prisma.vlsmSubmission.findMany({
      where: { endpointId, orderItemId: { in: orderItemIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { orderItemId: true, status: true, message: true, createdAt: true, itemVersion: true },
    });
    const out = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!out.has(r.orderItemId)) out.set(r.orderItemId, r);
    return out;
  }

  /** Examens déjà acceptés par VLSM à leur version actuelle. */
  async sentVersions(endpointId: string, orderItemIds: string[]): Promise<Set<string>> {
    if (orderItemIds.length === 0) return new Set();
    const rows = await this.prisma.vlsmSubmission.findMany({
      where: { endpointId, orderItemId: { in: orderItemIds }, status: 'SENT' },
      select: { orderItemId: true, itemVersion: true },
    });
    return new Set(rows.map((r) => `${r.orderItemId}:${r.itemVersion}`));
  }

  // --- Journal -----------------------------------------------------------------

  async listRuns(query: InteropRunsQuery) {
    const where: Prisma.InteropRunWhereInput = {
      ...(query.endpointId ? { endpointId: query.endpointId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    return Promise.all([
      this.prisma.interopRun.findMany({ where, include: runInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...skipTake(query) }),
      this.prisma.interopRun.count({ where }),
    ]);
  }

  findRun(id: string) {
    return this.prisma.interopRun.findUnique({
      where: { id },
      include: {
        ...runInclude,
        submissions: { orderBy: { createdAt: 'asc' }, include: { orderItem: { select: { sample: { select: { number: true } } } } } },
      },
    });
  }
}
