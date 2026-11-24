import {
  dhis2SettingsSchema,
  vlsmSettingsSchema,
  type Dhis2ConflictDto,
  type Dhis2MappingDto,
  type Dhis2Settings,
  type InteropEndpointDto,
  type InteropRunDto,
  type MappingParameterDto,
  type VlsmMappingDto,
  type VlsmSettings,
} from '@lims/shared';
import type { InteropEndpoint } from '../../generated/prisma/client';
import { decimalToNumber } from '../../core/common/values';
import type { Dhis2MappingRow, InteropRunRow, VlsmMappingRow } from './interop.repository';

type ParameterRow = Dhis2MappingRow['parameter'];

export function toParameterDto(p: ParameterRow): MappingParameterDto {
  return { id: p.id, code: p.code, name: p.name, unit: p.unit, resultType: p.resultType, choices: p.choices, examCode: p.exam.code, examName: p.exam.name };
}

/** Paramètres stockés en JSON, relus avec leur schéma (valeurs par défaut comprises). */
export function readDhis2Settings(endpoint: Pick<InteropEndpoint, 'settings'>): Dhis2Settings {
  return dhis2SettingsSchema.parse(endpoint.settings);
}
export function readVlsmSettings(endpoint: Pick<InteropEndpoint, 'settings'>): VlsmSettings {
  return vlsmSettingsSchema.parse(endpoint.settings);
}

export function toEndpointDto(row: InteropEndpoint & { _count: { dhis2Mappings: number; vlsmMappings: number } }): InteropEndpointDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    system: row.system,
    transport: row.transport,
    baseUrl: row.baseUrl,
    authMode: row.authMode,
    username: row.username,
    hasSecret: row.secretCipher !== null,
    timeoutSeconds: row.timeoutSeconds,
    isActive: row.isActive,
    settings: row.system === 'DHIS2' ? readDhis2Settings(row) : readVlsmSettings(row),
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
    mappingCount: row.system === 'DHIS2' ? row._count.dhis2Mappings : row._count.vlsmMappings,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Vue d'audit d'une connexion : le secret chiffré n'y figure jamais, seulement sa présence. */
export function endpointAuditView(row: InteropEndpoint) {
  const { secretCipher, ...rest } = row;
  return { ...rest, hasSecret: secretCipher !== null };
}

export function toDhis2MappingDto(row: Dhis2MappingRow): Dhis2MappingDto {
  return {
    id: row.id,
    endpointId: row.endpointId,
    label: row.label,
    parameter: toParameterDto(row.parameter),
    measure: row.measure,
    threshold: decimalToNumber(row.threshold),
    textMatch: row.textMatch,
    sex: row.sex,
    ageMinYears: row.ageMinYears,
    ageMaxYears: row.ageMaxYears,
    dataElement: row.dataElement,
    categoryOptionCombo: row.categoryOptionCombo,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
  };
}

export function toVlsmMappingDto(row: VlsmMappingRow): VlsmMappingDto {
  return {
    id: row.id,
    endpointId: row.endpointId,
    parameter: toParameterDto(row.parameter),
    testType: row.testType,
    eidPositive: row.eidPositive,
    eidNegative: row.eidNegative,
    eidIndeterminate: row.eidIndeterminate,
    isActive: row.isActive,
  };
}

export function toRunDto(row: InteropRunRow, names: Map<string, string>): InteropRunDto {
  return {
    id: row.id,
    endpoint: row.endpoint,
    kind: row.kind,
    status: row.status,
    period: row.period,
    itemCount: row.itemCount,
    payloadSha256: row.payloadSha256,
    httpStatus: row.httpStatus,
    openhimTransactionId: row.openhimTransactionId,
    imported: row.imported,
    updated: row.updated,
    ignored: row.ignored,
    deleted: row.deleted,
    conflicts: Array.isArray(row.conflicts) ? (row.conflicts as unknown as Dhis2ConflictDto[]) : [],
    message: row.message,
    durationMs: row.durationMs,
    triggeredBy: row.triggeredById ? (names.get(row.triggeredById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}
