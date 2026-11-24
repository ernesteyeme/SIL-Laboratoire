import type { QcMaterialDto, QcParameterRef, QcResultDto, QcRunDto, QcStatus, QcTargetDto, WestgardRule } from '@lims/shared';
import { dateToIso } from '../../core/common/values';
import type { MaterialRow, ParameterRefRow, RunRow } from './qc.repository';

export function toParameterRef(p: ParameterRefRow): QcParameterRef {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    unit: p.unit,
    decimals: p.decimals,
    examCode: p.exam.code,
    examName: p.exam.name,
    sectionId: p.exam.section.id,
    sectionName: p.exam.section.name,
  };
}

/** Lot périmé à la date donnée (« AAAA-MM-JJ », jour local du laboratoire). */
export function isExpired(expiresOn: Date, todayIso: string): boolean {
  return (dateToIso(expiresOn) ?? '') < todayIso;
}

export function toTargetDto(t: {
  id: string;
  materialId: string;
  parameter: ParameterRefRow;
  mean: { toNumber(): number };
  sd: { toNumber(): number };
  source: QcTargetDto['source'];
  isActive: boolean;
  updatedAt: Date;
}): QcTargetDto {
  const mean = t.mean.toNumber();
  const sd = t.sd.toNumber();
  return {
    id: t.id,
    materialId: t.materialId,
    parameter: toParameterRef(t.parameter),
    mean,
    sd,
    cvPercent: mean !== 0 ? Math.round((sd / Math.abs(mean)) * 10000) / 100 : null,
    source: t.source,
    isActive: t.isActive,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toMaterialDto(m: MaterialRow, todayIso: string): QcMaterialDto {
  return {
    id: m.id,
    name: m.name,
    manufacturer: m.manufacturer,
    lotNumber: m.lotNumber,
    level: m.level,
    expiresOn: dateToIso(m.expiresOn)!,
    expired: isExpired(m.expiresOn, todayIso),
    section: m.section,
    isActive: m.isActive,
    targets: m.targets.map(toTargetDto),
  };
}

export function toRunDto(r: RunRow, names: Map<string, string>): QcRunDto {
  return {
    id: r.id,
    parameter: toParameterRef(r.parameter),
    performedAt: r.performedAt.toISOString(),
    performedBy: names.get(r.performedById) ?? null,
    status: r.status,
    rules: r.violatedRules as WestgardRule[],
    comment: r.comment,
    results: r.results.map(
      (x): QcResultDto => ({
        id: x.id,
        targetId: x.targetId,
        materialName: x.target.material.name,
        lotNumber: x.target.material.lotNumber,
        level: x.target.material.level,
        value: x.value.toNumber(),
        mean: x.mean.toNumber(),
        sd: x.sd.toNumber(),
        z: x.zScore.toNumber(),
        status: x.status as QcStatus,
        rules: x.violatedRules as WestgardRule[],
      }),
    ),
    correctiveAction: r.correctiveAction,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolvedBy: r.resolvedById ? (names.get(r.resolvedById) ?? null) : null,
    excludedAt: r.excludedAt?.toISOString() ?? null,
    excludedBy: r.excludedById ? (names.get(r.excludedById) ?? null) : null,
    excludedReason: r.excludedReason,
    qualityIssue: r.qualityIssue,
  };
}

export const runUserIds = (r: RunRow) => [r.performedById, r.resolvedById, r.excludedById];
