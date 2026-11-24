import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  evaluateWestgard,
  formatPatientName,
  formatResultValue,
  QC_STATUS_LABELS,
  qcStatistics,
  zScore,
  type LeveyJenningsDto,
  type LeveyJenningsQuery,
  type Paginated,
  type QcCorrectiveActionInput,
  type QcExcludeInput,
  type QcMaterialDto,
  type QcMaterialInput,
  type QcParameterStatusDto,
  type QcRunDetailDto,
  type QcRunDto,
  type QcRunInput,
  type QcRunsQuery,
  type QcTargetDto,
  type QcTargetInput,
  type Qualifier,
  type QcStatus,
  type WestgardRule,
} from '@lims/shared';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import { addDaysIso, zonedPeriod, zonedStartOfDay } from '../../core/common/time';
import { isoToDate } from '../../core/common/values';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, ConflictError, DomainException, NotFoundError } from '../../core/errors/domain.exception';
import { labPeriods } from '../../core/numbering/numbering.service';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { isExpired, runUserIds, toMaterialDto, toParameterRef, toRunDto, toTargetDto } from './qc.mapper';
import { QcRepository } from './qc.repository';
import { QualityIssuesService } from './quality-issues.service';

const LJ_DEFAULT_DAYS = 90;

@Injectable()
export class QcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QcRepository,
    private readonly issues: QualityIssuesService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
  ) {}

  private async today(): Promise<{ iso: string; tz: string }> {
    const { timezone } = await this.lab.settings();
    return { iso: labPeriods(new Date(), timezone).isoDate, tz: timezone };
  }

  // ---------------------------------------------------------------------------
  // Matériaux et cibles
  // ---------------------------------------------------------------------------

  async listMaterials(includeInactive: boolean): Promise<QcMaterialDto[]> {
    const [rows, { iso }] = await Promise.all([this.repo.listMaterials(includeInactive), this.today()]);
    return rows.map((m) => toMaterialDto(m, iso));
  }

  async createMaterial(input: QcMaterialInput): Promise<QcMaterialDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertSection(tx, input.sectionId);
      try {
        const m = await tx.qcMaterial.create({
          data: {
            name: input.name,
            manufacturer: input.manufacturer ?? null,
            lotNumber: input.lotNumber,
            level: input.level,
            expiresOn: isoToDate(input.expiresOn)!,
            sectionId: input.sectionId ?? null,
            isActive: input.isActive ?? true,
          },
        });
        await this.audit.record(tx, { action: 'CREATE', entity: 'QcMaterial', entityId: m.id, after: m });
        return m.id;
      } catch (e) {
        throw this.uniqueMaterial(e);
      }
    });
    return this.material(id);
  }

  async updateMaterial(id: string, input: QcMaterialInput): Promise<QcMaterialDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.qcMaterial.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Matériau de contrôle', id);
      await this.assertSection(tx, input.sectionId);
      try {
        const after = await tx.qcMaterial.update({
          where: { id },
          data: {
            name: input.name,
            manufacturer: input.manufacturer ?? null,
            lotNumber: input.lotNumber,
            level: input.level,
            expiresOn: isoToDate(input.expiresOn)!,
            sectionId: input.sectionId ?? null,
            isActive: input.isActive ?? before.isActive,
          },
        });
        await this.audit.record(tx, { action: 'UPDATE', entity: 'QcMaterial', entityId: id, before, after });
      } catch (e) {
        throw this.uniqueMaterial(e);
      }
    });
    return this.material(id);
  }

  private async material(id: string): Promise<QcMaterialDto> {
    const [m, { iso }] = await Promise.all([this.repo.findMaterial(id), this.today()]);
    if (!m) throw new NotFoundError('Matériau de contrôle', id);
    return toMaterialDto(m, iso);
  }

  private async assertSection(db: Db, sectionId: string | null | undefined): Promise<void> {
    if (!sectionId) return;
    const s = await db.labSection.findUnique({ where: { id: sectionId } });
    if (!s) throw new NotFoundError('Section', sectionId);
  }

  private uniqueMaterial(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictError('Ce lot existe déjà pour ce contrôle et ce niveau.');
    }
    return e;
  }

  /** Création ou mise à jour de la cible d'un matériau pour un paramètre numérique. */
  async upsertTarget(materialId: string, input: QcTargetInput): Promise<QcTargetDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const material = await tx.qcMaterial.findUnique({ where: { id: materialId } });
      if (!material) throw new NotFoundError('Matériau de contrôle', materialId);
      const parameter = await this.repo.findParameter(input.parameterId, tx);
      if (!parameter) throw new NotFoundError('Paramètre', input.parameterId);
      if (parameter.resultType !== 'NUMERIC') {
        throw new BusinessRuleError('QC_PARAMETER_NOT_NUMERIC', `${parameter.name} n’est pas un paramètre numérique : pas de CIQ quantitatif possible.`);
      }
      const existing = await tx.qcTarget.findUnique({ where: { materialId_parameterId: { materialId, parameterId: input.parameterId } } });
      const data = { mean: String(input.mean), sd: String(input.sd), source: input.source, isActive: input.isActive ?? true };
      if (!existing) {
        const t = await tx.qcTarget.create({ data: { materialId, parameterId: input.parameterId, ...data } });
        await this.audit.record(tx, {
          action: 'CREATE',
          entity: 'QcTarget',
          entityId: t.id,
          after: { material: `${material.name} ${material.lotNumber} ${material.level}`, parameter: parameter.code, mean: input.mean, sd: input.sd, source: input.source },
        });
        return t.id;
      }
      const valuesChanged = existing.mean.toNumber() !== input.mean || existing.sd.toNumber() !== input.sd;
      if (valuesChanged && !input.reason) {
        throw new BusinessRuleError('TARGET_REASON_REQUIRED', 'Indiquez le motif de modification de la cible (nouvelle notice, fin de période probatoire…).');
      }
      const t = await tx.qcTarget.update({ where: { id: existing.id }, data });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'QcTarget',
        entityId: t.id,
        before: { mean: existing.mean, sd: existing.sd, source: existing.source, isActive: existing.isActive },
        after: { mean: t.mean, sd: t.sd, source: t.source, isActive: t.isActive },
        reason: input.reason ?? null,
      });
      return t.id;
    });
    const t = await this.repo.findTarget(id);
    return toTargetDto(t!);
  }

  // ---------------------------------------------------------------------------
  // État du CIQ par paramètre
  // ---------------------------------------------------------------------------

  async parameterStatus(sectionId?: string): Promise<QcParameterStatusDto[]> {
    const [params, { iso, tz }] = await Promise.all([this.repo.parametersWithTargets(sectionId), this.today()]);
    const ids = params.map((p) => p.id);
    const [latest, today] = await Promise.all([this.repo.latestRunsByParameter(ids), this.repo.parametersRunSince(ids, zonedStartOfDay(iso, tz))]);
    const byParam = new Map(latest.map((r) => [r.parameterId, r]));
    return params.map((p) => {
      const last = byParam.get(p.id);
      return {
        parameter: toParameterRef(p),
        targets: p.qcTargets.map((t) => ({
          id: t.id,
          materialName: t.material.name,
          lotNumber: t.material.lotNumber,
          level: t.material.level,
          mean: t.mean.toNumber(),
          sd: t.sd.toNumber(),
          expired: isExpired(t.material.expiresOn, iso),
        })),
        lastRun: last ? { id: last.id, performedAt: last.performedAt.toISOString(), status: last.status, resolved: !!last.resolvedAt } : null,
        ranToday: today.has(p.id),
        blocking: last?.status === 'REJECTED',
      };
    });
  }

  /**
   * Garde de validation : les résultats patients d'un paramètre ne peuvent pas être validés
   * tant que sa dernière série de CIQ (non exclue) est rejetée.
   */
  async assertQcAllowsValidation(db: Db, parameterIds: string[]): Promise<void> {
    const latest = await this.repo.latestRunsByParameter([...new Set(parameterIds)], db);
    const rejected = latest.filter((r) => r.status === 'REJECTED');
    if (rejected.length === 0) return;
    const params = await db.examParameter.findMany({ where: { id: { in: rejected.map((r) => r.parameterId) } }, select: { name: true } });
    throw new BusinessRuleError(
      'QC_REJECTED',
      `Contrôle qualité interne rejeté pour ${params.map((p) => p.name).join(', ')} : documentez l’action corrective puis repassez un CIQ accepté avant de valider.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Séries
  // ---------------------------------------------------------------------------

  async createRun(input: QcRunInput, actor: RequestUser): Promise<QcRunDetailDto> {
    const runId = await this.prisma.$transaction(
      async (tx) => {
        await this.repo.lockParameter(input.parameterId, tx);
        const parameter = await this.repo.findParameter(input.parameterId, tx);
        if (!parameter) throw new NotFoundError('Paramètre', input.parameterId);
        const performedAt = input.performedAt ? new Date(input.performedAt) : new Date();

        const pending = await this.repo.unresolvedRejected(parameter.id, tx);
        if (pending) {
          throw new BusinessRuleError(
            'QC_ACTION_REQUIRED',
            `La série rejetée du ${pending.performedAt.toLocaleString('fr-FR')} attend son action corrective : documentez-la avant de repasser le contrôle.`,
          );
        }
        const last = await this.repo.lastRun(parameter.id, tx);
        if (last && performedAt < last.performedAt) {
          throw new BusinessRuleError('QC_OUT_OF_ORDER', 'Une série plus récente existe déjà pour ce paramètre : l’heure de passage ne peut pas être antérieure.');
        }

        const { timezone } = await this.lab.settings(tx);
        const dayIso = labPeriods(performedAt, timezone).isoDate;
        const targets = await this.repo.activeTargetsOf(parameter.id, tx);
        const byId = new Map(targets.map((t) => [t.id, t]));
        const issues: { path: string; message: string }[] = [];
        input.results.forEach((r, i) => {
          const t = byId.get(r.targetId);
          if (!t) issues.push({ path: `results.${i}.targetId`, message: 'Niveau de contrôle inconnu ou inactif pour ce paramètre.' });
          else if (isExpired(t.material.expiresOn, dayIso)) issues.push({ path: `results.${i}.targetId`, message: `Lot ${t.material.lotNumber} (${t.material.level}) périmé.` });
        });
        if (issues.length > 0) throw new DomainException(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Certains niveaux de contrôle sont invalides.', issues);

        const points = input.results.map((r) => {
          const t = byId.get(r.targetId)!;
          return { targetId: t.id, value: r.value, mean: t.mean.toNumber(), sd: t.sd.toNumber(), z: zScore(r.value, t.mean.toNumber(), t.sd.toNumber()) };
        });
        const history = await this.repo.history(points.map((p) => p.targetId), tx);
        const evaluation = evaluateWestgard(points, history);

        const run = await tx.qcRun.create({
          data: {
            parameterId: parameter.id,
            performedAt,
            performedById: actor.id,
            status: evaluation.status,
            violatedRules: evaluation.rules,
            comment: input.comment ?? null,
            results: {
              create: points.map((p) => {
                const e = evaluation.byTarget.get(p.targetId)!;
                return { targetId: p.targetId, value: String(p.value), mean: String(p.mean), sd: String(p.sd), zScore: String(p.z), status: e.status, violatedRules: e.rules };
              }),
            },
          },
        });
        const summary = points.map((p) => `${byId.get(p.targetId)!.material.level} ${p.value} (z ${p.z})`).join(' ; ');
        await this.audit.record(tx, {
          action: 'CREATE',
          entity: 'QcRun',
          entityId: run.id,
          after: { parameter: parameter.code, performedAt, status: evaluation.status, rules: evaluation.rules, points },
          reason: `CIQ ${parameter.code} ${QC_STATUS_LABELS[evaluation.status].toLowerCase()} : ${summary}`,
        });

        if (evaluation.status === 'REJECTED') {
          await this.issues.createFromQcRun(
            tx,
            {
              runId: run.id,
              parameterLabel: `${parameter.name} (${parameter.code})`,
              rules: evaluation.rules,
              summary,
              performedAt,
            },
            actor,
          );
        }
        return run.id;
      },
      { timeout: 20_000 },
    );
    return this.getRun(runId);
  }

  async recordCorrectiveAction(id: string, input: QcCorrectiveActionInput, actor: RequestUser): Promise<QcRunDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const run = await tx.qcRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundError('Série de contrôle', id);
      await this.repo.lockParameter(run.parameterId, tx);
      if (run.status !== 'REJECTED') throw new BusinessRuleError('QC_NOT_REJECTED', 'Seule une série rejetée appelle une action corrective.');
      if (run.resolvedAt) throw new BusinessRuleError('QC_ALREADY_RESOLVED', 'L’action corrective de cette série est déjà documentée.');
      if (run.excludedAt) throw new BusinessRuleError('QC_EXCLUDED', 'Cette série a été exclue.');
      const after = await tx.qcRun.update({
        where: { id },
        data: { correctiveAction: input.correctiveAction, resolvedAt: new Date(), resolvedById: actor.id },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'QcRun',
        entityId: id,
        before: { resolvedAt: null },
        after: { correctiveAction: after.correctiveAction, resolvedAt: after.resolvedAt },
        reason: 'Action corrective après CIQ rejeté',
      });
    });
    return this.getRun(id);
  }

  async exclude(id: string, input: QcExcludeInput, actor: RequestUser): Promise<QcRunDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const run = await tx.qcRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundError('Série de contrôle', id);
      await this.repo.lockParameter(run.parameterId, tx);
      if (run.excludedAt) throw new BusinessRuleError('QC_EXCLUDED', 'Cette série est déjà exclue.');
      await tx.qcRun.update({ where: { id }, data: { excludedAt: new Date(), excludedById: actor.id, excludedReason: input.reason } });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'QcRun',
        entityId: id,
        before: { excludedAt: null, status: run.status },
        after: { excluded: true },
        reason: `Exclusion de la série des statistiques : ${input.reason}`,
      });
    });
    return this.getRun(id);
  }

  async listRuns(query: QcRunsQuery): Promise<Paginated<QcRunDto>> {
    const { tz } = await this.today();
    const period = {
      start: query.from ? zonedStartOfDay(query.from, tz) : undefined,
      end: query.to ? zonedStartOfDay(addDaysIso(query.to, 1), tz) : undefined,
    };
    const [rows, total] = await this.repo.listRuns(query, period);
    const names = await this.lab.userNames(rows.flatMap(runUserIds));
    return toPage(
      rows.map((r) => toRunDto(r, names)),
      total,
      query,
    );
  }

  async getRun(id: string): Promise<QcRunDetailDto> {
    const run = await this.repo.findRun(id);
    if (!run) throw new NotFoundError('Série de contrôle', id);
    const names = await this.lab.userNames(runUserIds(run));
    const dto = toRunDto(run, names);
    if (run.status !== 'REJECTED') return { ...dto, lastAcceptedAt: null, impactedResults: [] };

    const lastOk = await this.repo.lastAcceptableBefore(run.parameterId, run.performedAt);
    const nextOk = await this.repo.firstAcceptableAfter(run.parameterId, run.performedAt);
    const from = lastOk?.performedAt ?? new Date(run.performedAt.getTime() - 24 * 3600_000);
    const rows = await this.repo.patientResultsBetween(run.parameterId, from, nextOk?.performedAt ?? new Date());
    return {
      ...dto,
      lastAcceptedAt: lastOk?.performedAt.toISOString() ?? null,
      impactedResults: rows.map((r) => ({
        orderId: r.orderItem.order.id,
        orderNumber: r.orderItem.order.number,
        patientName: formatPatientName(r.orderItem.order.patient),
        examCode: r.orderItem.examCode,
        value:
          r.resultType === 'NUMERIC'
            ? formatResultValue(r.numericValue?.toNumber() ?? null, (r.qualifier as Qualifier | null) ?? null, r.decimals)
            : (r.textValue ?? ''),
        analysisStatus: r.orderItem.analysisStatus,
        enteredAt: r.enteredAt?.toISOString() ?? null,
      })),
    };
  }

  async leveyJennings(targetId: string, query: LeveyJenningsQuery): Promise<LeveyJenningsDto> {
    const target = await this.repo.findTarget(targetId);
    if (!target) throw new NotFoundError('Cible de contrôle', targetId);
    const { iso, tz } = await this.today();
    const to = query.to ?? iso;
    const from = query.from ?? addDaysIso(to, -LJ_DEFAULT_DAYS);
    const rows = await this.repo.targetPoints(targetId, zonedPeriod(from, to, tz));
    const points = rows.map((r) => ({
      runId: r.run.id,
      performedAt: r.run.performedAt.toISOString(),
      value: r.value.toNumber(),
      z: r.zScore.toNumber(),
      status: r.status as QcStatus,
      rules: r.violatedRules as WestgardRule[],
      excluded: !!r.run.excludedAt,
    }));
    const retained = rows.filter((r) => !r.run.excludedAt && r.run.status !== 'REJECTED').map((r) => r.value.toNumber());
    return {
      target: { ...toTargetDto(target), materialName: target.material.name, lotNumber: target.material.lotNumber, level: target.material.level },
      points,
      observed: qcStatistics(retained),
    };
  }
}
