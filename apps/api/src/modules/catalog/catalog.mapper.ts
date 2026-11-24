import type {
  ExamDetailDto,
  ExamListItemDto,
  ExamParameterDto,
  LabSectionDto,
  ReferenceRangeDto,
  SampleTypeDto,
} from '@lims/shared';
import type { ExamParameter, ReferenceRange } from '../../generated/prisma/client';
import { decimalToNumber, moneyToString } from '../../core/common/values';
import type { ExamDetailRow, ExamListRow, SampleTypeRow, SectionRow } from './catalog.repository';

export function toSectionDto(s: SectionRow): LabSectionDto {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    displayOrder: s.displayOrder,
    isActive: s.isActive,
    activeExamCount: s._count.exams,
  };
}

export function toSampleTypeDto(s: SampleTypeRow): SampleTypeDto {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    container: s.container,
    instructions: s.instructions,
    isActive: s.isActive,
    activeExamCount: s._count.exams,
  };
}

export function toRangeDto(r: ReferenceRange): ReferenceRangeDto {
  return {
    id: r.id,
    sex: r.sex,
    ageMinDays: r.ageMinDays,
    ageMaxDays: r.ageMaxDays,
    low: decimalToNumber(r.low),
    high: decimalToNumber(r.high),
    criticalLow: decimalToNumber(r.criticalLow),
    criticalHigh: decimalToNumber(r.criticalHigh),
    normalText: r.normalText,
    comment: r.comment,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toParameterDto(p: ExamParameter & { referenceRanges: ReferenceRange[] }): ExamParameterDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    resultType: p.resultType,
    unit: p.unit,
    decimals: p.decimals,
    choices: p.choices,
    displayOrder: p.displayOrder,
    isActive: p.isActive,
    referenceRanges: p.referenceRanges.map(toRangeDto),
  };
}

export function toExamListItemDto(e: ExamListRow): ExamListItemDto {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    shortName: e.shortName,
    section: e.section,
    sampleType: e.sampleType,
    price: moneyToString(e.price),
    turnaroundHours: e.turnaroundHours,
    isActive: e.isActive,
    activeParameterCount: e._count.parameters,
  };
}

export function toExamDetailDto(e: ExamDetailRow): ExamDetailDto {
  return {
    ...toExamListItemDto(e),
    patientInstructions: e.patientInstructions,
    displayOrder: e.displayOrder,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    parameters: e.parameters.map(toParameterDto),
  };
}

/** Vue d'audit d'un examen (sans les relations). */
export function examAuditView(e: ExamDetailRow) {
  return {
    code: e.code,
    name: e.name,
    shortName: e.shortName,
    sectionId: e.sectionId,
    sampleTypeId: e.sampleTypeId,
    price: moneyToString(e.price),
    turnaroundHours: e.turnaroundHours,
    patientInstructions: e.patientInstructions,
    displayOrder: e.displayOrder,
    isActive: e.isActive,
  };
}

export function parameterAuditView(p: ExamParameter) {
  const { createdAt: _c, updatedAt: _u, ...rest } = p;
  return rest;
}

export function rangeAuditView(r: ReferenceRange) {
  const { createdAt: _c, updatedAt: _u, ...rest } = r;
  return rest;
}
