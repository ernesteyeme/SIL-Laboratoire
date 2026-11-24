import type { CsvConfig, InstrumentDto, InstrumentMessageDto, InstrumentResultDto } from '@lims/shared';
import type { InstrumentMessageRow, InstrumentResultRow, InstrumentRow } from './instruments.repository';

export function toInstrumentDto(i: InstrumentRow, pending: number): InstrumentDto {
  return {
    id: i.id,
    code: i.code,
    name: i.name,
    manufacturer: i.manufacturer,
    model: i.model,
    section: i.section,
    protocol: i.protocol,
    csvConfig: (i.csvConfig as CsvConfig | null) ?? null,
    isActive: i.isActive,
    apiKeyPrefix: i.apiKeyPrefix,
    apiKeyRotatedAt: i.apiKeyRotatedAt?.toISOString() ?? null,
    lastMessageAt: i.lastMessageAt?.toISOString() ?? null,
    pendingCount: pending,
    mappings: i.mappings.map((m) => ({
      id: m.id,
      instrumentCode: m.instrumentCode,
      parameter: {
        id: m.parameter.id,
        code: m.parameter.code,
        name: m.parameter.name,
        unit: m.parameter.unit,
        resultType: m.parameter.resultType,
        choices: m.parameter.choices,
        examCode: m.parameter.exam.code,
        examName: m.parameter.exam.name,
      },
      factor: m.factor.toNumber(),
      valueMap: (m.valueMap as Record<string, string>) ?? {},
      isActive: m.isActive,
    })),
    qcMaterials: i.qcMaterials.map((q) => ({ id: q.id, specimenId: q.specimenId, material: q.material })),
  };
}

export function toResultDto(
  r: InstrumentResultRow,
  ctx: { orders: Map<string, { id: string; number: string }>; parameters: Map<string, { id: string; code: string; name: string }> },
  names: Map<string, string>,
): InstrumentResultDto {
  return {
    id: r.id,
    messageId: r.messageId,
    instrument: r.instrument,
    kind: r.kind,
    specimenId: r.specimenId,
    testCode: r.instrumentTestCode,
    rawValue: r.rawValue,
    unit: r.unit,
    flags: r.flags,
    measuredAt: r.measuredAt?.toISOString() ?? null,
    status: r.status,
    reason: r.reason,
    parameter: r.parameterId ? (ctx.parameters.get(r.parameterId) ?? null) : null,
    order: r.kind === 'PATIENT' ? (ctx.orders.get(r.specimenId) ?? null) : null,
    qcRunId: r.qcRunId,
    resolvedBy: r.resolvedById ? (names.get(r.resolvedById) ?? null) : null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toMessageDto(m: Omit<InstrumentMessageRow, 'raw'> & { raw?: string }, names: Map<string, string>): InstrumentMessageDto {
  return {
    id: m.id,
    instrument: m.instrument,
    protocol: m.protocol,
    source: m.source,
    filename: m.filename,
    receivedAt: m.receivedAt.toISOString(),
    receivedBy: names.get(m.receivedById) ?? null,
    status: m.status,
    error: m.error,
    resultCount: m.resultCount,
    appliedCount: m.appliedCount,
    sha256: m.sha256,
  };
}
