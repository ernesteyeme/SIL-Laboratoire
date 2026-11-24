import { Injectable } from '@nestjs/common';
import {
  rangesConflict,
  RANGE_SEX_LABELS,
  formatAgeInterval,
  type CreateParameterInput,
  type DeleteWithReasonInput,
  type ExamParameterDto,
  type ReferenceRangeDto,
  type ReferenceRangeInput,
  type ResultType,
  type UpdateParameterInput,
} from '@lims/shared';
import type { ReferenceRange } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { changedFields } from '../../core/audit/audit-serializer';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { CatalogRepository } from './catalog.repository';
import { parameterAuditView, rangeAuditView, toParameterDto, toRangeDto } from './catalog.mapper';

/** Paramètres d'examen et valeurs de référence. */
@Injectable()
export class ParametersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CatalogRepository,
    private readonly audit: AuditService,
  ) {}

  // --- Paramètres --------------------------------------------------------------

  async create(examId: string, input: CreateParameterInput): Promise<ExamParameterDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      await this.repo.lock('exams', examId, tx);
      const exam = await this.repo.findExam(examId, tx);
      if (!exam) throw new NotFoundError('Examen', examId);
      if (await this.repo.findParameterByCode(examId, input.code, tx)) {
        throw new ConflictError(`Le code « ${input.code} » existe déjà pour cet examen.`, [
          { path: 'code', message: 'Code déjà utilisé dans cet examen.' },
        ]);
      }
      const p = await this.repo.createParameter(
        {
          examId,
          code: input.code,
          name: input.name,
          resultType: input.resultType,
          unit: input.unit ?? null,
          decimals: input.resultType === 'NUMERIC' ? input.decimals : null,
          choices: input.resultType === 'CHOICE' ? input.choices : [],
          displayOrder: input.displayOrder,
        },
        tx,
      );
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'ExamParameter',
        entityId: p.id,
        after: parameterAuditView(p),
        reason: `Ajout au paramétrage de l’examen ${exam.code}`,
      });
      return { ...p, referenceRanges: [] };
    });
    return toParameterDto(created);
  }

  async update(id: string, input: UpdateParameterInput): Promise<ExamParameterDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.repo.lock('exam_parameters', id, tx);
      const current = await this.repo.findParameter(id, tx);
      if (!current) throw new NotFoundError('Paramètre', id);

      const resultType: ResultType = input.resultType ?? current.resultType;
      const choices = resultType === 'CHOICE' ? (input.choices ?? current.choices) : [];

      if (input.isActive === current.isActive) {
        throw new BusinessRuleError('STATUS_UNCHANGED', current.isActive ? 'Ce paramètre est déjà actif.' : 'Ce paramètre est déjà inactif.');
      }
      if (resultType !== current.resultType && current.referenceRanges.length > 0) {
        throw new BusinessRuleError(
          'TYPE_CHANGE_WITH_RANGES',
          'Supprimez d’abord les valeurs de référence de ce paramètre avant de changer son type de résultat.',
        );
      }
      if (resultType === 'CHOICE' && choices.length < 2) {
        throw new BusinessRuleError('CHOICES_REQUIRED', 'Une liste de choix doit comporter au moins 2 valeurs.');
      }
      if (resultType === 'CHOICE') {
        const lower = new Set(choices.map((c) => c.toLowerCase()));
        const orphan = current.referenceRanges.find((r) => r.normalText && !lower.has(r.normalText.toLowerCase()));
        if (orphan) {
          throw new BusinessRuleError(
            'CHOICE_USED_BY_RANGE',
            `La valeur « ${orphan.normalText} » est utilisée comme valeur normale : modifiez d’abord la valeur de référence.`,
          );
        }
      }
      if (input.isActive === false && current.exam.isActive) {
        const others = await this.repo.countActiveParameters(current.examId, tx, id);
        if (others === 0) {
          throw new BusinessRuleError(
            'LAST_ACTIVE_PARAMETER',
            'Impossible de désactiver le dernier paramètre actif d’un examen actif. Désactivez d’abord l’examen.',
          );
        }
      }

      const next = await this.repo.updateParameter(
        id,
        {
          name: input.name,
          resultType,
          unit: input.unit,
          decimals: resultType === 'NUMERIC' ? (input.decimals === undefined ? current.decimals : input.decimals) : null,
          choices,
          displayOrder: input.displayOrder,
          isActive: input.isActive,
        },
        tx,
      );

      const before = parameterAuditView(current);
      const after = parameterAuditView(next);
      const fields = changedFields(before, after);
      if (fields.length > 0) {
        await this.audit.record(tx, {
          action: input.isActive === false ? 'DELETE' : input.isActive === true ? 'RESTORE' : 'UPDATE',
          entity: 'ExamParameter',
          entityId: id,
          before,
          after,
          reason: input.reason ?? `Champs modifiés : ${fields.join(', ')}`,
        });
      }
      return { ...next, referenceRanges: current.referenceRanges };
    });
    return toParameterDto(updated);
  }

  // --- Valeurs de référence ----------------------------------------------------

  async createRange(parameterId: string, input: ReferenceRangeInput): Promise<ReferenceRangeDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      await this.repo.lock('exam_parameters', parameterId, tx);
      const parameter = await this.repo.findParameter(parameterId, tx);
      if (!parameter) throw new NotFoundError('Paramètre', parameterId);
      this.assertRangeMatchesType(input, parameter.resultType, parameter.choices);
      this.assertNoConflict(input, parameter.referenceRanges);

      const range = await this.repo.createRange({ parameterId, ...rangeData(input) }, tx);
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'ReferenceRange',
        entityId: range.id,
        after: rangeAuditView(range),
        reason: input.reason ?? `Nouvelle valeur de référence pour ${parameter.exam.code}/${parameter.code}`,
      });
      return range;
    });
    return toRangeDto(created);
  }

  async updateRange(id: string, input: ReferenceRangeInput): Promise<ReferenceRangeDto> {
    if (!input.reason) {
      throw new BusinessRuleError('REASON_REQUIRED', 'Un motif est obligatoire pour modifier une valeur de référence.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.getRangeOrThrow(id, tx);
      await this.repo.lock('exam_parameters', current.parameterId, tx);
      const parameter = await this.repo.findParameter(current.parameterId, tx);
      if (!parameter) throw new NotFoundError('Paramètre', current.parameterId);
      this.assertRangeMatchesType(input, parameter.resultType, parameter.choices);
      this.assertNoConflict(input, parameter.referenceRanges.filter((r) => r.id !== id));

      const next = await this.repo.updateRange(id, rangeData(input), tx);
      const before = rangeAuditView(current);
      const after = rangeAuditView(next);
      if (changedFields(before, after).length > 0) {
        await this.audit.record(tx, { action: 'UPDATE', entity: 'ReferenceRange', entityId: id, before, after, reason: input.reason });
      }
      return next;
    });
    return toRangeDto(updated);
  }

  async deleteRange(id: string, input: DeleteWithReasonInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.getRangeOrThrow(id, tx);
      await this.repo.lock('exam_parameters', current.parameterId, tx);
      await this.repo.deleteRange(id, tx);
      await this.audit.record(tx, {
        action: 'DELETE',
        entity: 'ReferenceRange',
        entityId: id,
        before: rangeAuditView(current),
        reason: input.reason,
      });
    });
  }

  private async getRangeOrThrow(id: string, db: Db): Promise<ReferenceRange> {
    const range = await this.repo.findRange(id, db);
    if (!range) throw new NotFoundError('Valeur de référence', id);
    return range;
  }

  private assertRangeMatchesType(input: ReferenceRangeInput, type: ResultType, choices: string[]): void {
    const hasNumeric = [input.low, input.high, input.criticalLow, input.criticalHigh].some((v) => v !== null);
    if (type === 'NUMERIC') {
      if (!hasNumeric) throw new BusinessRuleError('NUMERIC_BOUNDS_REQUIRED', 'Un paramètre numérique exige au moins une borne.');
      if (input.normalText) {
        throw new BusinessRuleError('TEXT_ON_NUMERIC', 'La valeur normale texte ne s’applique pas à un paramètre numérique.');
      }
      return;
    }
    if (hasNumeric) {
      throw new BusinessRuleError('NUMERIC_ON_TEXT', 'Les bornes numériques ne s’appliquent qu’aux paramètres numériques.');
    }
    if (!input.normalText) {
      throw new BusinessRuleError('NORMAL_TEXT_REQUIRED', 'Indiquez la valeur normale attendue (ex. « Négatif »).');
    }
    if (type === 'CHOICE' && !choices.some((c) => c.toLowerCase() === input.normalText!.toLowerCase())) {
      throw new BusinessRuleError(
        'NORMAL_TEXT_NOT_IN_CHOICES',
        `La valeur normale doit faire partie des choix du paramètre : ${choices.join(', ')}.`,
      );
    }
  }

  private assertNoConflict(input: ReferenceRangeInput, existing: ReferenceRange[]): void {
    const conflict = existing.find((r) => rangesConflict(r, input));
    if (conflict) {
      throw new BusinessRuleError(
        'RANGE_OVERLAP',
        `Chevauchement avec une valeur de référence existante (${RANGE_SEX_LABELS[conflict.sex]}, ${formatAgeInterval(
          conflict.ageMinDays,
          conflict.ageMaxDays,
        )}). Ajustez les tranches d’âge.`,
      );
    }
  }
}

function rangeData(input: ReferenceRangeInput) {
  return {
    sex: input.sex,
    ageMinDays: input.ageMinDays,
    ageMaxDays: input.ageMaxDays,
    low: input.low,
    high: input.high,
    criticalLow: input.criticalLow,
    criticalHigh: input.criticalHigh,
    normalText: input.normalText ?? null,
    comment: input.comment ?? null,
  };
}
