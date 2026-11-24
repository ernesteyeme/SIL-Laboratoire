import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CancelQualityIssueInput,
  type CloseQualityIssueInput,
  type CreateQualityIssueInput,
  type Paginated,
  type PlanQualityIssueInput,
  type QualityIssueDto,
  type QualityIssuesQuery,
  type WestgardRule,
} from '@lims/shared';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import { isoToDate } from '../../core/common/values';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, DomainException, NotFoundError } from '../../core/errors/domain.exception';
import { labPeriods, NumberingService } from '../../core/numbering/numbering.service';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { ROLE_GROUPS } from '../../core/security/role-groups';
import { issueUserIds, toIssueDto } from './quality-issues.mapper';
import { QualityIssuesRepository, type IssueRow } from './quality-issues.repository';

const canReadAll = (actor: RequestUser) => actor.roles.some((r) => (ROLE_GROUPS.QUALITY_READ_ALL as readonly string[]).includes(r));

function auditView(i: IssueRow) {
  return {
    number: i.number,
    status: i.status,
    title: i.title,
    category: i.category,
    severity: i.severity,
    rootCause: i.rootCause,
    correctiveAction: i.correctiveAction,
    actionOwner: i.actionOwner,
    actionDueDate: i.actionDueDate,
    effectivenessCheck: i.effectivenessCheck,
    cancelledReason: i.cancelledReason,
  };
}

@Injectable()
export class QualityIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QualityIssuesRepository,
    private readonly numbering: NumberingService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
  ) {}

  private async todayIso(db: Db = this.prisma): Promise<string> {
    const { timezone } = await this.lab.settings(db);
    return labPeriods(new Date(), timezone).isoDate;
  }

  async list(query: QualityIssuesQuery, actor: RequestUser): Promise<Paginated<QualityIssueDto>> {
    const today = await this.todayIso();
    const [rows, total] = await this.repo.list(query, canReadAll(actor) ? null : actor.id, isoToDate(today)!);
    const names = await this.lab.userNames(rows.flatMap(issueUserIds));
    return toPage(
      rows.map((r) => toIssueDto(r, names, today)),
      total,
      query,
    );
  }

  async get(id: string, actor: RequestUser): Promise<QualityIssueDto> {
    const row = await this.repo.find(id);
    // Une fiche non visible est signalée comme introuvable (pas de fuite d'existence).
    if (!row || (!canReadAll(actor) && row.declaredById !== actor.id)) throw new NotFoundError('Fiche de non-conformité', id);
    const [names, today] = await Promise.all([this.lab.userNames(issueUserIds(row)), this.todayIso()]);
    return toIssueDto(row, names, today);
  }

  /** Déclaration par tout membre du personnel. */
  async create(input: CreateQualityIssueInput, actor: RequestUser): Promise<QualityIssueDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const issues: { path: string; message: string }[] = [];
      let orderId: string | null = null;
      let sampleId: string | null = null;
      if (input.sampleNumber) {
        const sample = await tx.sample.findUnique({ where: { number: input.sampleNumber }, select: { id: true, orderId: true } });
        if (!sample) issues.push({ path: 'sampleNumber', message: `Échantillon ${input.sampleNumber} introuvable.` });
        else {
          sampleId = sample.id;
          orderId = sample.orderId;
        }
      }
      if (input.orderNumber) {
        const order = await tx.labOrder.findUnique({ where: { number: input.orderNumber.toUpperCase() }, select: { id: true } });
        if (!order) issues.push({ path: 'orderNumber', message: `Demande ${input.orderNumber} introuvable.` });
        else if (orderId && orderId !== order.id) issues.push({ path: 'orderNumber', message: 'L’échantillon indiqué n’appartient pas à cette demande.' });
        else orderId = order.id;
      }
      if (issues.length > 0) throw new DomainException(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Références introuvables.', issues);

      const { timezone } = await this.lab.settings(tx);
      const created = await tx.qualityIssue.create({
        data: {
          number: await this.numbering.qualityIssueNumber(tx, timezone),
          title: input.title,
          category: input.category,
          severity: input.severity,
          description: input.description,
          detectedAt: new Date(input.detectedAt),
          declaredById: actor.id,
          immediateAction: input.immediateAction ?? null,
          orderId,
          sampleId,
        },
        include: { order: { select: { id: true, number: true } }, sample: { select: { id: true, number: true } } },
      });
      await this.audit.record(tx, { action: 'CREATE', entity: 'QualityIssue', entityId: created.id, after: auditView(created), reason: `Déclaration ${created.number}` });
      return created.id;
    });
    return this.get(id, actor);
  }

  /** Fiche ouverte automatiquement lors d'un CIQ rejeté (dans la transaction de la série). */
  async createFromQcRun(
    tx: Db,
    data: { runId: string; parameterLabel: string; rules: WestgardRule[]; summary: string; performedAt: Date },
    actor: RequestUser,
  ): Promise<string> {
    const { timezone } = await this.lab.settings(tx);
    const created = await tx.qualityIssue.create({
      data: {
        number: await this.numbering.qualityIssueNumber(tx, timezone),
        title: `CIQ rejeté — ${data.parameterLabel} (${data.rules.join(', ')})`.slice(0, 200),
        category: 'ANALYTICAL',
        severity: 'MAJOR',
        description: `Série de contrôle qualité interne rejetée par les règles de Westgard ${data.rules.join(', ')}. Valeurs : ${data.summary}.`,
        detectedAt: data.performedAt,
        declaredById: actor.id,
        immediateAction: 'Validation des résultats patients du paramètre bloquée automatiquement jusqu’à une série de contrôle acceptée. Résultats rendus depuis le dernier CIQ accepté à réévaluer.',
        qcRunId: data.runId,
      },
      include: { order: { select: { id: true, number: true } }, sample: { select: { id: true, number: true } } },
    });
    await this.audit.record(tx, { action: 'CREATE', entity: 'QualityIssue', entityId: created.id, after: auditView(created), reason: `Ouverture automatique ${created.number} (CIQ rejeté)` });
    return created.id;
  }

  /** Analyse des causes et plan d'action (modifiable tant que la fiche n'est pas clôturée). */
  async plan(id: string, input: PlanQualityIssueInput, actor: RequestUser): Promise<QualityIssueDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.loadForUpdate(id, tx);
      if (before.status !== 'OPEN' && before.status !== 'IN_PROGRESS') {
        throw new BusinessRuleError('ISSUE_FINALIZED', 'Cette fiche est clôturée ou annulée.');
      }
      if (input.actionDueDate < (await this.todayIso(tx))) {
        throw new BusinessRuleError('ACTION_DUE_IN_PAST', 'L’échéance de l’action ne peut pas être dans le passé.');
      }
      const after = await tx.qualityIssue.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
          rootCause: input.rootCause,
          correctiveAction: input.correctiveAction,
          actionOwner: input.actionOwner,
          actionDueDate: isoToDate(input.actionDueDate)!,
          analyzedById: actor.id,
          analyzedAt: new Date(),
        },
        include: { order: { select: { id: true, number: true } }, sample: { select: { id: true, number: true } } },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'QualityIssue',
        entityId: id,
        before: auditView(before),
        after: auditView(after),
        reason: before.status === 'OPEN' ? `Plan d’action ${before.number}` : `Mise à jour du plan d’action ${before.number}`,
      });
    });
    return this.get(id, actor);
  }

  /** Clôture après vérification de l'efficacité de l'action (responsable qualité). */
  async close(id: string, input: CloseQualityIssueInput, actor: RequestUser): Promise<QualityIssueDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.loadForUpdate(id, tx);
      if (before.status !== 'IN_PROGRESS') {
        throw new BusinessRuleError('ISSUE_NOT_IN_PROGRESS', 'Une fiche ne peut être clôturée qu’après analyse des causes et plan d’action.');
      }
      if (before.qcRunId) {
        const run = await tx.qcRun.findUnique({ where: { id: before.qcRunId }, select: { resolvedAt: true, excludedAt: true } });
        if (run && !run.resolvedAt && !run.excludedAt) {
          throw new BusinessRuleError('QC_ACTION_PENDING', 'L’action corrective de la série de CIQ rejetée n’est pas documentée.');
        }
      }
      const after = await tx.qualityIssue.update({
        where: { id },
        data: { status: 'CLOSED', effectivenessCheck: input.effectivenessCheck, closedById: actor.id, closedAt: new Date() },
        include: { order: { select: { id: true, number: true } }, sample: { select: { id: true, number: true } } },
      });
      await this.audit.record(tx, { action: 'UPDATE', entity: 'QualityIssue', entityId: id, before: auditView(before), after: auditView(after), reason: `Clôture ${before.number}` });
    });
    return this.get(id, actor);
  }

  /** Annulation d'une déclaration non fondée (jamais pour une fiche issue d'un CIQ rejeté). */
  async cancel(id: string, input: CancelQualityIssueInput, actor: RequestUser): Promise<QualityIssueDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.loadForUpdate(id, tx);
      if (before.status !== 'OPEN' && before.status !== 'IN_PROGRESS') {
        throw new BusinessRuleError('ISSUE_FINALIZED', 'Cette fiche est clôturée ou annulée.');
      }
      if (before.qcRunId) {
        throw new BusinessRuleError('QC_ISSUE_NOT_CANCELLABLE', 'Une fiche ouverte par un CIQ rejeté ne peut pas être annulée : traitez-la puis clôturez-la.');
      }
      const after = await tx.qualityIssue.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledReason: input.reason, closedById: actor.id, closedAt: new Date() },
        include: { order: { select: { id: true, number: true } }, sample: { select: { id: true, number: true } } },
      });
      await this.audit.record(tx, { action: 'UPDATE', entity: 'QualityIssue', entityId: id, before: auditView(before), after: auditView(after), reason: `Annulation ${before.number} : ${input.reason}` });
    });
    return this.get(id, actor);
  }

  private async loadForUpdate(id: string, tx: Db): Promise<IssueRow> {
    await this.repo.lock(id, tx);
    const row = await this.repo.find(id, tx);
    if (!row) throw new NotFoundError('Fiche de non-conformité', id);
    return row;
  }
}
