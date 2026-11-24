import {
  formatResultValue,
  NON_CONFORMITY_TYPE_LABELS,
  type AnalysisItemDto,
  type CriticalAlertDto,
  type Qualifier,
  type ReportDto,
  type ResultDto,
  type ResultFlag,
} from '@lims/shared';
import type { TestResult } from '../../generated/prisma/client';
import { decimalToNumber } from '../../core/common/values';
import type { AnalysisItemRow, ReportMetaRow } from './results.repository';

export type PreviousMap = Map<
  string,
  { resultType: string; numericValue: { toNumber(): number } | null; qualifier: string | null; textValue: string | null; decimals: number | null; flag: string | null; validatedAt: Date }
>;

export function displayValueOf(r: { resultType: string; numericValue: { toNumber(): number } | null; qualifier: string | null; textValue: string | null; decimals: number | null }): string {
  if (r.resultType === 'NUMERIC') return formatResultValue(decimalToNumber(r.numericValue), (r.qualifier as Qualifier | null) ?? null, r.decimals);
  return r.textValue ?? '';
}

export function isFilled(r: Pick<TestResult, 'resultType' | 'numericValue' | 'textValue'>): boolean {
  return r.resultType === 'NUMERIC' ? r.numericValue !== null : !!r.textValue;
}

export function toResultDto(r: TestResult, names: Map<string, string>, previous: PreviousMap): ResultDto {
  const prev = previous.get(r.parameterId);
  return {
    id: r.id,
    parameterId: r.parameterId,
    parameterCode: r.parameterCode,
    parameterName: r.parameterName,
    unit: r.unit,
    resultType: r.resultType,
    decimals: r.decimals,
    choices: r.choices,
    numericValue: decimalToNumber(r.numericValue),
    qualifier: (r.qualifier as Qualifier | null) ?? null,
    textValue: r.textValue,
    displayValue: displayValueOf(r),
    flag: r.flag,
    reference: r.hasReference
      ? {
          low: decimalToNumber(r.refLow),
          high: decimalToNumber(r.refHigh),
          criticalLow: decimalToNumber(r.refCriticalLow),
          criticalHigh: decimalToNumber(r.refCriticalHigh),
          normalText: r.refNormalText,
          comment: r.refComment,
          label: r.refLabel,
        }
      : null,
    comment: r.comment,
    enteredBy: r.enteredById ? (names.get(r.enteredById) ?? null) : null,
    enteredAt: r.enteredAt?.toISOString() ?? null,
    source: r.source,
    previous: prev
      ? {
          displayValue: displayValueOf(prev),
          flag: (prev.flag as ResultFlag | null) ?? null,
          validatedAt: prev.validatedAt.toISOString(),
        }
      : null,
  };
}

export function itemUserIds(item: AnalysisItemRow): (string | null)[] {
  return [
    item.technicalValidatedById,
    item.validatedById,
    ...item.results.map((r) => r.enteredById),
    ...item.alerts.flatMap((a) => [a.detectedById, a.acknowledgedById]),
    ...item.amendments.map((a) => a.amendedById),
  ];
}

export function toAnalysisItemDto(item: AnalysisItemRow, names: Map<string, string>, previous: PreviousMap): AnalysisItemDto {
  const receivedAt = item.sample.receivedAt;
  const alerts: CriticalAlertDto[] = item.alerts.map((a) => ({
    id: a.id,
    resultId: a.resultId,
    parameterName: a.result.parameterName,
    valueText: a.valueText,
    flag: a.flag,
    detectedAt: a.detectedAt.toISOString(),
    detectedBy: names.get(a.detectedById) ?? null,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: a.acknowledgedById ? (names.get(a.acknowledgedById) ?? null) : null,
    notifiedTo: a.notifiedTo,
    note: a.note,
  }));
  return {
    id: item.id,
    examCode: item.examCode,
    examName: item.examName,
    section: { id: item.exam.section.id, name: item.exam.section.name },
    sampleNumber: item.sample.number,
    sampleReceivedAt: receivedAt?.toISOString() ?? null,
    dueAt: receivedAt ? new Date(receivedAt.getTime() + item.exam.turnaroundHours * 3600_000).toISOString() : null,
    status: item.analysisStatus,
    version: item.version,
    hasReservation: item.sample.hasReservation,
    reservations: item.sample.nonConformities.map((n) => `${NON_CONFORMITY_TYPE_LABELS[n.type]}${n.comment ? ` — ${n.comment}` : ''}`),
    results: item.results.map((r) => toResultDto(r, names, previous)),
    alerts,
    biologistComment: item.biologistComment,
    technicalValidatedBy: item.technicalValidatedById ? (names.get(item.technicalValidatedById) ?? null) : null,
    technicalValidatedAt: item.technicalValidatedAt?.toISOString() ?? null,
    validatedBy: item.validatedById ? (names.get(item.validatedById) ?? null) : null,
    validatedAt: item.validatedAt?.toISOString() ?? null,
    amendments: item.amendments.map((a) => ({
      fromVersion: a.fromVersion,
      reason: a.reason,
      amendedBy: names.get(a.amendedById) ?? null,
      amendedAt: a.amendedAt.toISOString(),
    })),
  };
}

export function toReportDto(r: ReportMetaRow, names: Map<string, string>): ReportDto {
  return {
    id: r.id,
    number: r.number,
    version: r.version,
    kind: r.kind,
    sha256: r.sha256,
    issuedAt: r.issuedAt.toISOString(),
    issuedBy: names.get(r.issuedById) ?? null,
    examCodes: r.examCodes,
    supersedesNumber: r.supersedes?.number ?? null,
  };
}
