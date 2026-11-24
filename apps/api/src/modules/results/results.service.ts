import { HttpStatus, Injectable } from '@nestjs/common';
import {
  computeAge,
  computeResultFlag,
  CRITICAL_FLAGS,
  ERROR_CODES,
  formatAgeInterval,
  parseNumericInput,
  RANGE_SEX_LABELS,
  resolveReferenceRange,
  type AcknowledgeAlertInput,
  type AnalysisItemDto,
  type BiologicalValidationInput,
  type OrderResultsDto,
  type Paginated,
  type ParsedNumeric,
  type RangeSnapshot,
  type ResultReasonInput,
  type SaveResultsInput,
  type ValidationIssue,
  type WorklistItemDto,
  type WorklistQuery,
  formatPrescriberName,
} from '@lims/shared';
import type { Prisma, ReferenceRange, TestResult } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import { dateToIso, decimalToNumber } from '../../core/common/values';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, DomainException, NotFoundError } from '../../core/errors/domain.exception';
import { labPeriods } from '../../core/numbering/numbering.service';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { toPatientSummary } from '../billing/billing.mapper';
import { OrdersService } from '../orders/orders.service';
import { QcService } from '../quality/qc.service';
import { ReportsService } from './reports.service';
import { displayValueOf, isFilled, itemUserIds, toAnalysisItemDto, toReportDto, type PreviousMap } from './results.mapper';
import { ResultsRepository, type AnalysisItemRow } from './results.repository';

function snapshotOf(r: TestResult): RangeSnapshot | null {
  if (!r.hasReference) return null;
  return {
    low: decimalToNumber(r.refLow),
    high: decimalToNumber(r.refHigh),
    criticalLow: decimalToNumber(r.refCriticalLow),
    criticalHigh: decimalToNumber(r.refCriticalHigh),
    normalText: r.refNormalText,
  };
}

function resultAuditView(r: TestResult) {
  return { parameter: r.parameterCode, value: displayValueOf(r), flag: r.flag, comment: r.comment, source: r.source };
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ResultsRepository,
    private readonly orders: OrdersService,
    private readonly reports: ReportsService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
    private readonly qc: QcService,
  ) {}

  // ---------------------------------------------------------------------------
  // Initialisation (appelée par la réception d'un échantillon, dans sa transaction)
  // ---------------------------------------------------------------------------

  /**
   * Crée les lignes de résultat des examens portés par l'échantillon reçu.
   * Paramètres et valeurs de référence sont figés à cet instant, selon le sexe du patient
   * et son âge à la date du prélèvement.
   */
  async initializeForSample(tx: Db, sampleId: string): Promise<void> {
    const sample = await this.repo.findSampleForInit(sampleId, tx);
    if (!sample) throw new NotFoundError('Échantillon', sampleId);
    const settings = await this.lab.settings(tx);
    const patient = sample.order.patient;
    const birth = dateToIso(patient.birthDate);
    const refDate = labPeriods(sample.collectedAt ?? sample.receivedAt ?? new Date(), settings.timezone).isoDate;
    const ageDays = birth ? computeAge(birth, refDate).totalDays : null;

    for (const item of sample.items) {
      if (item.analysisStatus !== 'AWAITING_SAMPLE' || item.results.length > 0) continue;
      const data: Prisma.TestResultCreateManyInput[] = item.exam.parameters.map((p) => {
        const range = pickRange(p.referenceRanges, patient.sex, ageDays);
        return {
          orderItemId: item.id,
          parameterId: p.id,
          parameterCode: p.code,
          parameterName: p.name,
          unit: p.unit,
          resultType: p.resultType,
          decimals: p.decimals,
          choices: p.choices,
          displayOrder: p.displayOrder,
          hasReference: !!range,
          refLow: range?.low ?? null,
          refHigh: range?.high ?? null,
          refCriticalLow: range?.criticalLow ?? null,
          refCriticalHigh: range?.criticalHigh ?? null,
          refNormalText: range?.normalText ?? null,
          refComment: range?.comment ?? null,
          refLabel: range ? rangeLabel(range) : null,
        };
      });
      if (data.length > 0) await tx.testResult.createMany({ data });
      await tx.orderItem.update({ where: { id: item.id }, data: { analysisStatus: 'TO_ENTER' } });
    }
  }

  /** Échantillon refusé après réception : possible seulement si aucun résultat n'a été saisi. */
  async resetForSample(tx: Db, sampleId: string): Promise<void> {
    const sample = await this.repo.findSampleForInit(sampleId, tx);
    if (!sample) return;
    const blocking = sample.items.find((i) => (i.analysisStatus !== 'AWAITING_SAMPLE' && i.analysisStatus !== 'TO_ENTER') || i.results.some((r) => r.enteredAt));
    if (blocking) {
      throw new BusinessRuleError(
        'SAMPLE_HAS_RESULTS',
        `Des résultats ont déjà été saisis pour ${blocking.examCode} : l’échantillon ne peut plus être refusé. Corrigez ou commentez les résultats.`,
      );
    }
    const itemIds = sample.items.map((i) => i.id);
    await tx.testResult.deleteMany({ where: { orderItemId: { in: itemIds } } });
    await tx.orderItem.updateMany({ where: { id: { in: itemIds } }, data: { analysisStatus: 'AWAITING_SAMPLE' } });
  }

  // ---------------------------------------------------------------------------
  // Consultation
  // ---------------------------------------------------------------------------

  async getOrderResults(orderId: string): Promise<OrderResultsDto> {
    const order = await this.repo.findOrder(orderId);
    if (!order) throw new NotFoundError('Demande', orderId);
    const [reports, previous] = await Promise.all([
      this.repo.listReports(orderId),
      this.repo.previousResults(
        order.patientId,
        order.items.flatMap((i) => i.results.map((r) => r.parameterId)),
        order.items.map((i) => i.id),
      ),
    ]);
    const names = await this.lab.userNames([...order.items.flatMap(itemUserIds), ...reports.map((r) => r.issuedById)]);
    const sorted = [...order.items].sort(
      (a, b) => a.exam.section.displayOrder - b.exam.section.displayOrder || a.examCode.localeCompare(b.examCode),
    );
    return {
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        priority: order.priority,
        createdAt: order.createdAt.toISOString(),
        clinicalInfo: order.clinicalInfo,
        prescriberName: order.prescriber ? formatPrescriberName(order.prescriber) : null,
      },
      patient: toPatientSummary(order.patient),
      items: sorted.map((i) => toAnalysisItemDto(i, names, previous as PreviousMap)),
      reports: reports.map((r) => toReportDto(r, names)),
    };
  }

  async worklist(query: WorklistQuery): Promise<Paginated<WorklistItemDto>> {
    const [rows, total] = await this.repo.worklist(query);
    const now = Date.now();
    return toPage(
      rows.map((i) => {
        const due = i.sample.receivedAt ? new Date(i.sample.receivedAt.getTime() + i.exam.turnaroundHours * 3600_000) : null;
        return {
          orderItemId: i.id,
          orderId: i.orderId,
          orderNumber: i.order.number,
          priority: i.order.priority,
          patient: toPatientSummary(i.order.patient),
          examCode: i.examCode,
          examName: i.examName,
          sectionName: i.exam.section.name,
          sampleNumber: i.sample.number,
          receivedAt: i.sample.receivedAt?.toISOString() ?? null,
          dueAt: due?.toISOString() ?? null,
          overdue: !!due && due.getTime() < now && i.analysisStatus !== 'VALIDATED',
          status: i.analysisStatus,
          hasCritical: i._count.alerts > 0,
          hasReservation: i.sample.hasReservation,
        };
      }),
      total,
      query,
    );
  }

  // ---------------------------------------------------------------------------
  // Saisie
  // ---------------------------------------------------------------------------

  /**
   * Saisie (ou mise à jour) des résultats d'un examen.
   * @param origin renseigné quand les valeurs viennent d'un automate (traçabilité de la source)
   */
  async save(itemId: string, input: SaveResultsInput, actor: RequestUser, origin?: { instrumentId: string }): Promise<AnalysisItemDto> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.lockAndLoad(itemId, tx);
      if (item.analysisStatus === 'TECHNICAL_VALIDATED') {
        throw new BusinessRuleError('ITEM_TECHNICALLY_VALIDATED', 'Résultats validés techniquement : un biologiste doit les renvoyer en saisie pour modification.');
      }
      if (item.analysisStatus === 'VALIDATED') {
        throw new BusinessRuleError('ITEM_VALIDATED', 'Résultats validés : utilisez « Corriger » (biologiste) pour émettre un compte rendu rectificatif.');
      }
      if (item.analysisStatus === 'AWAITING_SAMPLE') {
        throw new BusinessRuleError('SAMPLE_NOT_RECEIVED', 'L’échantillon n’a pas encore été reçu au laboratoire.');
      }

      const byId = new Map(item.results.map((r) => [r.id, r]));
      const issues: ValidationIssue[] = [];
      const updates: { result: TestResult; numeric: ParsedNumeric | null; text: string | null; comment: string | null }[] = [];

      for (const entry of input.results) {
        const result = byId.get(entry.resultId);
        if (!result) {
          issues.push({ path: entry.resultId, message: 'Ce résultat n’appartient pas à cet examen.' });
          continue;
        }
        const raw = entry.value.trim();
        let numeric: ParsedNumeric | null = null;
        let text: string | null = null;
        if (raw !== '') {
          if (result.resultType === 'NUMERIC') {
            numeric = parseNumericInput(raw);
            if (!numeric) {
              issues.push({ path: result.id, message: `${result.parameterName} : valeur numérique attendue (ex. 12,5 ou <40).` });
              continue;
            }
          } else if (result.resultType === 'CHOICE') {
            const match = result.choices.find((c) => c.toLowerCase() === raw.toLowerCase());
            if (!match) {
              issues.push({ path: result.id, message: `${result.parameterName} : choisissez parmi ${result.choices.join(', ')}.` });
              continue;
            }
            text = match;
          } else {
            text = raw;
          }
        }
        updates.push({ result, numeric, text, comment: entry.comment ?? null });
      }

      if (issues.length > 0) {
        throw new DomainException(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Certains résultats sont invalides.', issues);
      }

      const now = new Date();
      for (const u of updates) {
        const { result } = u;
        const flag = computeResultFlag(result.resultType, { numeric: u.numeric, text: u.text }, snapshotOf(result));
        const numericValue = u.numeric ? String(u.numeric.value) : null;
        const unchanged =
          (result.numericValue?.toString() ?? null) === (numericValue === null ? null : String(Number(numericValue))) &&
          (result.qualifier ?? null) === (u.numeric?.qualifier ?? null) &&
          (result.textValue ?? null) === u.text &&
          (result.comment ?? null) === u.comment;
        if (unchanged) continue;

        const next = await tx.testResult.update({
          where: { id: result.id },
          data: {
            numericValue,
            qualifier: u.numeric?.qualifier ?? null,
            textValue: u.text,
            flag,
            comment: u.comment,
            enteredById: u.numeric || u.text ? actor.id : null,
            enteredAt: u.numeric || u.text ? now : null,
            source: origin && (u.numeric || u.text) ? 'INSTRUMENT' : 'MANUAL',
            instrumentId: origin && (u.numeric || u.text) ? origin.instrumentId : null,
          },
        });
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'Result',
          entityId: result.id,
          before: resultAuditView(result),
          after: resultAuditView(next),
          reason: `${item.examCode} / ${result.parameterCode} (échantillon ${item.sample.number})`,
        });
        await this.syncCriticalAlert(tx, item, next, actor);
      }

      const fresh = await tx.testResult.findMany({ where: { orderItemId: itemId } });
      const complete = fresh.length > 0 && fresh.every(isFilled);
      const status = complete ? 'ENTERED' : 'TO_ENTER';
      if (status !== item.analysisStatus) await tx.orderItem.update({ where: { id: itemId }, data: { analysisStatus: status } });
    });
    return this.getItem(itemId);
  }

  /** Une valeur critique ouvre une alerte ; corriger la valeur avant communication annule l'alerte devenue sans objet. */
  private async syncCriticalAlert(tx: Db, item: AnalysisItemRow, result: TestResult, actor: RequestUser): Promise<void> {
    const open = await tx.criticalAlert.findFirst({ where: { resultId: result.id, cancelledAt: null, acknowledgedAt: null } });
    const isCritical = !!result.flag && CRITICAL_FLAGS.includes(result.flag);
    const valueText = `${displayValueOf(result)}${result.unit ? ` ${result.unit}` : ''}`.slice(0, 60);

    if (open && (!isCritical || open.valueText !== valueText)) {
      await tx.criticalAlert.update({ where: { id: open.id }, data: { cancelledAt: new Date() } });
    }
    if (isCritical && (!open || open.valueText !== valueText)) {
      const alert = await tx.criticalAlert.create({
        data: { resultId: result.id, orderItemId: item.id, flag: result.flag!, valueText, detectedById: actor.id },
      });
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'CriticalAlert',
        entityId: alert.id,
        after: { exam: item.examCode, parameter: result.parameterCode, value: valueText, flag: result.flag },
        reason: 'Valeur critique détectée : communication au prescripteur requise',
      });
    }
  }

  async acknowledgeAlert(alertId: string, input: AcknowledgeAlertInput, actor: RequestUser): Promise<AnalysisItemDto> {
    const itemId = await this.prisma.$transaction(async (tx) => {
      const alert = await tx.criticalAlert.findUnique({ where: { id: alertId } });
      if (!alert) throw new NotFoundError('Alerte', alertId);
      await this.repo.lockItem(alert.orderItemId, tx);
      if (alert.cancelledAt) throw new BusinessRuleError('ALERT_CANCELLED', 'Cette alerte est sans objet (valeur corrigée).');
      if (alert.acknowledgedAt) throw new BusinessRuleError('ALERT_ALREADY_ACKNOWLEDGED', 'Cette alerte a déjà été communiquée.');
      const next = await tx.criticalAlert.update({
        where: { id: alertId },
        data: { acknowledgedAt: new Date(), acknowledgedById: actor.id, notifiedTo: input.notifiedTo, note: input.note ?? null },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'CriticalAlert',
        entityId: alertId,
        before: { acknowledgedAt: null },
        after: { acknowledgedAt: next.acknowledgedAt, notifiedTo: next.notifiedTo, note: next.note },
        reason: `Résultat critique ${alert.valueText} communiqué à : ${input.notifiedTo}`,
      });
      return alert.orderItemId;
    });
    return this.getItem(itemId);
  }

  // ---------------------------------------------------------------------------
  // Validations
  // ---------------------------------------------------------------------------

  async technicalValidate(itemId: string, actor: RequestUser): Promise<AnalysisItemDto> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.lockAndLoad(itemId, tx);
      if (item.analysisStatus === 'TO_ENTER') {
        const missing = item.results.filter((r) => !isFilled(r)).map((r) => r.parameterName);
        throw new BusinessRuleError('RESULTS_INCOMPLETE', `Résultats incomplets : ${missing.join(', ')}.`);
      }
      if (item.analysisStatus !== 'ENTERED') {
        throw new BusinessRuleError('INVALID_STATUS', 'Ces résultats ne sont pas en attente de validation technique.');
      }
      await this.qc.assertQcAllowsValidation(tx, item.results.map((r) => r.parameterId));
      await tx.orderItem.update({
        where: { id: itemId },
        data: { analysisStatus: 'TECHNICAL_VALIDATED', technicalValidatedAt: new Date(), technicalValidatedById: actor.id },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Result',
        entityId: itemId,
        before: { status: item.analysisStatus },
        after: { status: 'TECHNICAL_VALIDATED', results: item.results.map(resultAuditView) },
        reason: `Validation technique ${item.examCode} (échantillon ${item.sample.number})`,
      });
    });
    return this.getItem(itemId);
  }

  /**
   * Validation biologique (biologiste) : exige la validation technique et la communication de toute valeur critique.
   * Quand tous les examens de la demande sont validés, le compte rendu définitif (ou rectificatif) est émis automatiquement.
   */
  async biologicalValidate(itemId: string, input: BiologicalValidationInput, actor: RequestUser): Promise<AnalysisItemDto> {
    await this.prisma.$transaction(
      async (tx) => {
        const item = await this.lockAndLoad(itemId, tx);
        if (item.analysisStatus !== 'TECHNICAL_VALIDATED') {
          throw new BusinessRuleError(
            'TECHNICAL_VALIDATION_REQUIRED',
            item.analysisStatus === 'VALIDATED' ? 'Ces résultats sont déjà validés.' : 'La validation technique doit précéder la validation biologique.',
          );
        }
        await this.qc.assertQcAllowsValidation(tx, item.results.map((r) => r.parameterId));
        const pending = item.alerts.filter((a) => !a.acknowledgedAt);
        if (pending.length > 0) {
          throw new BusinessRuleError(
            'CRITICAL_NOT_COMMUNICATED',
            `Valeur(s) critique(s) non communiquée(s) : ${pending.map((a) => `${a.result.parameterName} ${a.valueText}`).join(', ')}. Tracez la communication avant de valider.`,
          );
        }
        await tx.orderItem.update({
          where: { id: itemId },
          data: { analysisStatus: 'VALIDATED', validatedAt: new Date(), validatedById: actor.id, biologistComment: input.comment ?? null },
        });
        await this.orders.refreshStatus(tx, item.orderId);
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'Result',
          entityId: itemId,
          before: { status: item.analysisStatus },
          after: { status: 'VALIDATED', version: item.version, results: item.results.map(resultAuditView), comment: input.comment ?? null },
          reason: `Validation biologique ${item.examCode} v${item.version}`,
        });

        const siblings = await tx.orderItem.findMany({ where: { orderId: item.orderId }, select: { analysisStatus: true } });
        if (siblings.every((s) => s.analysisStatus === 'VALIDATED')) {
          const previous = await this.repo.latestReport(item.orderId, tx);
          const kind = previous && previous.kind !== 'PARTIAL' ? 'AMENDED' : 'FINAL';
          await this.reports.issue(tx, item.orderId, kind, actor);
        }
      },
      { timeout: 30_000 },
    );
    return this.getItem(itemId);
  }

  /** Le biologiste renvoie des résultats validés techniquement en saisie (avant validation biologique). */
  async returnToEntry(itemId: string, input: ResultReasonInput): Promise<AnalysisItemDto> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.lockAndLoad(itemId, tx);
      if (item.analysisStatus !== 'TECHNICAL_VALIDATED') {
        throw new BusinessRuleError('INVALID_STATUS', 'Seuls des résultats validés techniquement peuvent être renvoyés en saisie.');
      }
      await tx.orderItem.update({
        where: { id: itemId },
        data: { analysisStatus: 'ENTERED', technicalValidatedAt: null, technicalValidatedById: null },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Result',
        entityId: itemId,
        before: { status: 'TECHNICAL_VALIDATED' },
        after: { status: 'ENTERED' },
        reason: `Renvoi en saisie ${item.examCode} : ${input.reason}`,
      });
    });
    return this.getItem(itemId);
  }

  /**
   * Correction après validation biologique : les valeurs validées sont archivées, la version est incrémentée
   * et l'examen repasse en saisie. La nouvelle validation donnera un compte rendu rectificatif.
   */
  async amend(itemId: string, input: ResultReasonInput, actor: RequestUser): Promise<AnalysisItemDto> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.lockAndLoad(itemId, tx);
      if (item.analysisStatus !== 'VALIDATED') {
        throw new BusinessRuleError('INVALID_STATUS', 'Seuls des résultats validés biologiquement peuvent faire l’objet d’une correction.');
      }
      await tx.resultAmendment.create({
        data: {
          orderItemId: itemId,
          fromVersion: item.version,
          previousResults: {
            validatedAt: item.validatedAt?.toISOString() ?? null,
            validatedById: item.validatedById,
            biologistComment: item.biologistComment,
            results: item.results.map(resultAuditView),
          },
          reason: input.reason,
          amendedById: actor.id,
        },
      });
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          analysisStatus: 'ENTERED',
          version: item.version + 1,
          technicalValidatedAt: null,
          technicalValidatedById: null,
          validatedAt: null,
          validatedById: null,
        },
      });
      await this.orders.refreshStatus(tx, item.orderId);
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Result',
        entityId: itemId,
        before: { status: 'VALIDATED', version: item.version, results: item.results.map(resultAuditView) },
        after: { status: 'ENTERED', version: item.version + 1 },
        reason: `Correction après validation ${item.examCode} : ${input.reason}`,
      });
    });
    return this.getItem(itemId);
  }

  private async lockAndLoad(itemId: string, tx: Db) {
    await this.repo.lockItem(itemId, tx);
    const item = await this.repo.findItemWithOrder(itemId, tx);
    if (!item) throw new NotFoundError('Examen demandé', itemId);
    if (item.order.status === 'CANCELLED') throw new BusinessRuleError('ORDER_CANCELLED', `La demande ${item.order.number} est annulée.`);
    return item;
  }

  async getItem(itemId: string): Promise<AnalysisItemDto> {
    const item = await this.repo.findItemWithOrder(itemId);
    if (!item) throw new NotFoundError('Examen demandé', itemId);
    const [previous, names] = await Promise.all([
      this.repo.previousResults(item.order.patientId, item.results.map((r) => r.parameterId), [item.id]),
      this.lab.userNames(itemUserIds(item)),
    ]);
    return toAnalysisItemDto(item, names, previous as PreviousMap);
  }
}

/** Population de la plage : « Femmes, ≥ 18 ans », « ≥ 18 ans », « Hommes », « Tous âges ». */
function rangeLabel(range: ReferenceRange): string {
  const allAges = range.ageMinDays === 0 && range.ageMaxDays === null;
  if (range.sex === 'ANY') return allAges ? 'Tous âges' : formatAgeInterval(range.ageMinDays, range.ageMaxDays);
  return allAges ? RANGE_SEX_LABELS[range.sex] : `${RANGE_SEX_LABELS[range.sex]}, ${formatAgeInterval(range.ageMinDays, range.ageMaxDays)}`;
}

/** Plage applicable ; âge inconnu → seules les plages valables à tout âge sont utilisables. */
function pickRange(ranges: ReferenceRange[], sex: 'MALE' | 'FEMALE' | 'UNKNOWN', ageDays: number | null) {
  if (ageDays === null) {
    return resolveReferenceRange(ranges.filter((r) => r.ageMinDays === 0 && r.ageMaxDays === null), sex, 0);
  }
  return resolveReferenceRange(ranges, sex, ageDays);
}
