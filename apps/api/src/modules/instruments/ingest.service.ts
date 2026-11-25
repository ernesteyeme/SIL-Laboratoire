import { createHash } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  INSTRUMENT_RESULT_TO_REVIEW,
  parseNumericInput,
  type CsvConfig,
  type IngestResultDto,
  type InstrumentMessageDetailDto,
  type InstrumentMessageDto,
  type InstrumentMessagesQuery,
  type InstrumentMessageSource,
  type InstrumentMessageStatus,
  type InstrumentResultDto,
  type InstrumentResultKind,
  type InstrumentResultsQuery,
  type InstrumentResultStatus,
  type InstrumentWorklistDto,
  type Paginated,
  type ResultType,
} from '@lims/shared';
import { Prisma, type Instrument } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import { dateToIso } from '../../core/common/values';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SectionAccessService } from '../../core/security/section-access.service';
import { QcService } from '../quality/qc.service';
import { ResultsService } from '../results/results.service';
import { toMessageDto, toResultDto } from './instruments.mapper';
import { InstrumentsRepository } from './instruments.repository';
import { buildAstmOrders } from './parsers/astm';
import { buildHl7Ack } from './parsers/hl7';
import { MessageParseError, parseInstrumentMessage, type ParsedMessage } from './parsers';
import { normalizeInstrumentValue } from './parsers/values';

/** Résultat reçu à apparier (issu d'un message, ou relu depuis la file pour une relance). */
export interface StagedResult {
  specimenId: string;
  testCode: string;
  rawValue: string;
  unit: string | null;
  flags: string | null;
  resultStatus: string | null;
  measuredAt: Date | null;
}

export interface Outcome {
  kind: InstrumentResultKind;
  status: InstrumentResultStatus;
  reason: string | null;
  parameterId: string | null;
  testResultId: string | null;
  qcRunId: string | null;
}

interface MappingInfo {
  parameterId: string;
  parameterName: string;
  resultType: ResultType;
  choices: string[];
  decimals: number | null;
  factor: number;
  valueMap: Record<string, string>;
}

const outcome = (o: Partial<Outcome> & Pick<Outcome, 'kind' | 'status'>): Outcome => ({ reason: null, parameterId: null, testResultId: null, qcRunId: null, ...o });
const clip = (v: string | null | undefined, n: number) => (v == null ? null : v.slice(0, n));

/** Deux saisies équivalentes (même valeur numérique et même qualificatif, ou même texte). */
function sameValue(existing: { resultType: ResultType; numericValue: { toNumber(): number } | null; qualifier: string | null; textValue: string | null }, value: string): boolean {
  if (existing.resultType === 'NUMERIC') {
    const p = parseNumericInput(value);
    return !!p && existing.numericValue !== null && existing.numericValue.toNumber() === p.value && (existing.qualifier ?? null) === (p.qualifier ?? null);
  }
  return (existing.textValue ?? '').toLowerCase() === value.toLowerCase();
}

function errorText(e: unknown): string {
  if (e instanceof HttpException) {
    const body = e.getResponse() as { message?: string; details?: { message?: string }[] };
    const details = Array.isArray(body.details) ? body.details.map((d) => d.message).filter(Boolean).join(' ; ') : '';
    return [body.message, details].filter(Boolean).join(' ') || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

@Injectable()
export class InstrumentIngestService {
  private readonly logger = new Logger(InstrumentIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InstrumentsRepository,
    private readonly results: ResultsService,
    private readonly qc: QcService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
    private readonly sections: SectionAccessService,
  ) {}

  /** Habilitations par service : l'automate relève d'une section ; seuls ses techniciens et biologistes le pilotent. */
  private async assertInstrumentAccess(instrumentId: string, actor: RequestUser, action: string): Promise<void> {
    const instrument = await this.prisma.instrument.findUnique({ where: { id: instrumentId }, select: { section: { select: { id: true, name: true } } } });
    if (instrument?.section) await this.sections.assertCanAct(this.prisma, actor, instrument.section, action);
  }

  // ---------------------------------------------------------------------------
  // Réception d'un message
  // ---------------------------------------------------------------------------

  /**
   * Traitement d'un message d'automate :
   * 1. conservation du message brut (une retransmission identique est reconnue et n'est pas réappliquée) ;
   * 2. analyse selon le protocole ;
   * 3. appariement de chaque résultat (échantillon, paramètre, contrôle qualité) et intégration ;
   * 4. tout ce qui ne peut pas être intégré sans risque part dans la file « à traiter ».
   *
   * Un résultat d'automate n'est jamais validé automatiquement : la validation technique puis biologique restent humaines.
   */
  async ingest(instrument: Instrument, raw: string, source: InstrumentMessageSource, actor: RequestUser, filename?: string | null): Promise<IngestResultDto> {
    if (source === 'UPLOAD') await this.assertInstrumentAccess(instrument.id, actor, 'import d’un fichier de l’automate');
    const sha256 = createHash('sha256').update(raw, 'utf8').digest('hex');
    const previous = await this.repo.findMessageBySha(instrument.id, sha256);
    if (previous) return this.duplicateResponse(instrument, previous, raw);

    const { timezone } = await this.lab.settings();
    let parsed: ParsedMessage;
    try {
      parsed = parseInstrumentMessage(raw, instrument.protocol, (instrument.csvConfig as CsvConfig | null) ?? null, timezone);
    } catch (e) {
      if (!(e instanceof MessageParseError)) throw e;
      const failed = await this.storeMessage(instrument, raw, sha256, source, actor, filename, { status: 'FAILED', error: e.message, warnings: [] });
      if ('duplicate' in failed) return this.duplicateResponse(instrument, failed.duplicate, raw);
      return { messageId: failed.id, duplicate: false, status: 'FAILED', counts: {}, warnings: [e.message], ack: instrument.protocol === 'HL7' ? buildHl7Ack(null, null, 'AR', e.message, new Date()) : null };
    }

    const stored = await this.storeMessage(instrument, raw, sha256, source, actor, filename, { status: 'PARTIAL', error: null, warnings: parsed.warnings });
    if ('duplicate' in stored) return this.duplicateResponse(instrument, stored.duplicate, raw);

    const staged: StagedResult[] = parsed.results.map((r) => ({
      specimenId: r.specimenId.slice(0, 60),
      testCode: r.testCode.slice(0, 40),
      rawValue: r.value.slice(0, 100),
      unit: clip(r.unit, 30),
      flags: clip(r.flags, 20),
      resultStatus: r.resultStatus,
      measuredAt: r.measuredAt,
    }));
    const outcomes = await this.resolve(instrument, staged, actor);

    await this.prisma.instrumentResult.createMany({
      data: staged.map((s, i) => ({
        messageId: stored.id,
        instrumentId: instrument.id,
        kind: outcomes[i].kind,
        specimenId: s.specimenId,
        instrumentTestCode: s.testCode,
        rawValue: s.rawValue,
        unit: s.unit,
        flags: s.flags,
        measuredAt: s.measuredAt,
        status: outcomes[i].status,
        reason: clip(outcomes[i].reason, 300),
        parameterId: outcomes[i].parameterId,
        testResultId: outcomes[i].testResultId,
        qcRunId: outcomes[i].qcRunId,
      })),
    });
    const status = await this.refreshMessage(stored.id);
    await this.prisma.instrument.update({ where: { id: instrument.id }, data: { lastMessageAt: new Date() } });

    const counts = await this.repo.messageCounts(stored.id);
    const toReview = INSTRUMENT_RESULT_TO_REVIEW.reduce((n, s) => n + (counts[s] ?? 0), 0);
    return {
      messageId: stored.id,
      duplicate: false,
      status,
      counts,
      warnings: parsed.warnings,
      ack:
        instrument.protocol === 'HL7'
          ? buildHl7Ack(parsed.hl7Header ?? null, parsed.controlId, 'AA', `${staged.length} résultat(s) reçu(s)${toReview ? `, ${toReview} à traiter au laboratoire` : ''}`, new Date())
          : null,
    };
  }

  private async storeMessage(
    instrument: Instrument,
    raw: string,
    sha256: string,
    source: InstrumentMessageSource,
    actor: RequestUser,
    filename: string | null | undefined,
    state: { status: InstrumentMessageStatus; error: string | null; warnings: string[] },
  ): Promise<{ id: string } | { duplicate: { id: string; status: InstrumentMessageStatus } }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const m = await tx.instrumentMessage.create({
          data: {
            instrumentId: instrument.id,
            protocol: instrument.protocol,
            source,
            filename: filename ?? null,
            raw,
            sha256,
            receivedById: actor.id,
            status: state.status,
            error: clip(state.error, 1000),
            warnings: state.warnings.slice(0, 50).map((w) => w.slice(0, 300)),
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'CREATE',
          entity: 'InstrumentMessage',
          entityId: m.id,
          after: { instrument: instrument.code, protocol: instrument.protocol, source, sha256, bytes: raw.length, status: state.status, error: state.error },
          reason: `Message reçu de ${instrument.code}${filename ? ` (${filename})` : ''}`,
        });
        return m;
      });
    } catch (e) {
      // Deux envois simultanés du même message : le second est une retransmission.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.repo.findMessageBySha(instrument.id, sha256);
        if (existing) return { duplicate: existing };
      }
      throw e;
    }
  }

  private async duplicateResponse(instrument: Instrument, previous: { id: string; status: InstrumentMessageStatus }, raw: string): Promise<IngestResultDto> {
    let ack: string | null = null;
    if (instrument.protocol === 'HL7') {
      const { timezone } = await this.lab.settings();
      try {
        const p = parseInstrumentMessage(raw, 'HL7', null, timezone);
        ack = buildHl7Ack(p.hl7Header ?? null, p.controlId, 'AA', 'Message déjà reçu', new Date());
      } catch {
        ack = buildHl7Ack(null, null, 'AR', 'Message illisible', new Date());
      }
    }
    return { messageId: previous.id, duplicate: true, status: previous.status, counts: await this.repo.messageCounts(previous.id), warnings: [], ack };
  }

  /** Statut et compteurs du message d'après ses résultats. */
  private async refreshMessage(messageId: string): Promise<InstrumentMessageStatus> {
    const counts = await this.repo.messageCounts(messageId);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const applied = (counts.APPLIED ?? 0) + (counts.QC_APPLIED ?? 0);
    const toReview = INSTRUMENT_RESULT_TO_REVIEW.some((s) => (counts[s] ?? 0) > 0);
    const status: InstrumentMessageStatus = toReview ? 'PARTIAL' : 'PROCESSED';
    await this.prisma.instrumentMessage.update({ where: { id: messageId }, data: { status, resultCount: total, appliedCount: applied } });
    return status;
  }

  // ---------------------------------------------------------------------------
  // Appariement et intégration
  // ---------------------------------------------------------------------------

  /**
   * Décide du sort de chaque résultat reçu, dans l'ordre du message.
   * @param force intègre aussi en cas de conflit avec une saisie existante (décision explicite d'un technicien)
   */
  async resolve(instrument: Instrument, staged: StagedResult[], actor: RequestUser, force = false): Promise<Outcome[]> {
    const out: Outcome[] = new Array(staged.length);
    const [mappings, qcLinks] = await Promise.all([
      this.prisma.instrumentTestMapping.findMany({
        where: { instrumentId: instrument.id, isActive: true },
        include: { parameter: { select: { id: true, name: true, resultType: true, choices: true, decimals: true } } },
      }),
      this.prisma.instrumentQcMaterial.findMany({ where: { instrumentId: instrument.id }, include: { material: { select: { id: true, isActive: true } } } }),
    ]);
    const byCode = new Map<string, MappingInfo>();
    for (const m of mappings) {
      const info: MappingInfo = {
        parameterId: m.parameterId,
        parameterName: m.parameter.name,
        resultType: m.parameter.resultType,
        choices: m.parameter.choices,
        decimals: m.parameter.decimals,
        factor: m.factor.toNumber(),
        valueMap: (m.valueMap as Record<string, string>) ?? {},
      };
      byCode.set(m.instrumentCode, info);
      if (!byCode.has(m.instrumentCode.toUpperCase())) byCode.set(m.instrumentCode.toUpperCase(), info);
    }
    const mappingOf = (code: string) => byCode.get(code) ?? byCode.get(code.toUpperCase()) ?? null;
    const qcMaterialOf = new Map(qcLinks.map((l) => [l.specimenId.toUpperCase(), l.material]));

    const qcIdx: number[] = [];
    const patientIdx: number[] = [];
    staged.forEach((s, i) => (qcMaterialOf.has(s.specimenId.toUpperCase()) ? qcIdx : patientIdx).push(i));

    await this.resolveQc(staged, qcIdx, mappingOf, qcMaterialOf, out, actor);
    await this.resolvePatients(instrument, staged, patientIdx, mappingOf, out, actor, force);
    return out;
  }

  private async resolveQc(
    staged: StagedResult[],
    indexes: number[],
    mappingOf: (code: string) => MappingInfo | null,
    qcMaterialOf: Map<string, { id: string; isActive: boolean }>,
    out: Outcome[],
    actor: RequestUser,
  ): Promise<void> {
    // Regroupement par paramètre : les niveaux d'un même paramètre forment une série.
    const groups = new Map<string, { idx: number; targetId: string; value: number }[]>();
    for (const i of indexes) {
      const s = staged[i];
      const material = qcMaterialOf.get(s.specimenId.toUpperCase())!;
      const m = mappingOf(s.testCode);
      if (!m) {
        out[i] = outcome({ kind: 'QC', status: 'UNMATCHED', reason: `Code test « ${s.testCode} » sans correspondance pour cet automate.` });
        continue;
      }
      if (!material.isActive) {
        out[i] = outcome({ kind: 'QC', status: 'UNMATCHED', parameterId: m.parameterId, reason: 'Lot de contrôle inactif.' });
        continue;
      }
      const v = normalizeInstrumentValue(s.rawValue, s.resultStatus, { ...m, resultType: 'NUMERIC' }, m);
      if (!v.ok) {
        out[i] = outcome({ kind: 'QC', status: v.notPerformed ? 'NOT_PERFORMED' : 'UNMATCHED', parameterId: m.parameterId, reason: v.reason });
        continue;
      }
      const parsed = parseNumericInput(v.value);
      if (!parsed || parsed.qualifier) {
        out[i] = outcome({ kind: 'QC', status: 'UNMATCHED', parameterId: m.parameterId, reason: `Valeur de contrôle « ${s.rawValue} » inexploitable (valeur numérique exacte attendue).` });
        continue;
      }
      const target = await this.prisma.qcTarget.findUnique({ where: { materialId_parameterId: { materialId: material.id, parameterId: m.parameterId } } });
      if (!target || !target.isActive) {
        out[i] = outcome({ kind: 'QC', status: 'UNMATCHED', parameterId: m.parameterId, reason: `Pas de cible active pour ce lot et ${m.parameterName}.` });
        continue;
      }
      const list = groups.get(m.parameterId) ?? [];
      if (list.some((x) => x.targetId === target.id)) {
        out[i] = outcome({ kind: 'QC', status: 'UNMATCHED', parameterId: m.parameterId, reason: 'Même niveau transmis deux fois dans le message.' });
        continue;
      }
      list.push({ idx: i, targetId: target.id, value: parsed.value });
      groups.set(m.parameterId, list);
    }

    const now = Date.now();
    for (const [parameterId, list] of groups) {
      const times = list.map((x) => staged[x.idx].measuredAt?.getTime()).filter((t): t is number => !!t && t <= now + 5 * 60_000);
      const performedAt = new Date(times.length ? Math.max(...times) : now);
      try {
        const run = await this.qc.createRun(
          { parameterId, performedAt: performedAt.toISOString(), results: list.map((x) => ({ targetId: x.targetId, value: x.value })), comment: 'Transmis par l’automate' },
          actor,
        );
        for (const x of list) out[x.idx] = outcome({ kind: 'QC', status: 'QC_APPLIED', parameterId, qcRunId: run.id, reason: run.status === 'ACCEPTED' ? null : `Série ${run.status === 'WARNING' ? 'en avertissement' : 'rejetée'} (${run.rules.join(', ')})` });
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        for (const x of list) out[x.idx] = outcome({ kind: 'QC', status: 'UNMATCHED', parameterId, reason: errorText(e) });
      }
    }
  }

  private async resolvePatients(
    instrument: Instrument,
    staged: StagedResult[],
    indexes: number[],
    mappingOf: (code: string) => MappingInfo | null,
    out: Outcome[],
    actor: RequestUser,
    force: boolean,
  ): Promise<void> {
    const specimens = [...new Set(indexes.map((i) => staged[i].specimenId))];
    const samples = await this.prisma.sample.findMany({
      where: { number: { in: specimens } },
      select: {
        number: true,
        status: true,
        order: { select: { status: true } },
        items: {
          select: {
            id: true,
            analysisStatus: true,
            results: { select: { id: true, parameterId: true, resultType: true, numericValue: true, qualifier: true, textValue: true, comment: true } },
          },
        },
      },
    });
    const sampleOf = new Map(samples.map((s) => [s.number, s]));

    // Valeurs à intégrer, regroupées par examen (une saisie = une transaction, avec alertes critiques et audit).
    const toApply = new Map<string, { idx: number; resultId: string; value: string; comment: string | null; parameterId: string }[]>();
    const claimed = new Set<string>();

    for (const i of indexes) {
      const s = staged[i];
      const m = mappingOf(s.testCode);
      if (!m) {
        out[i] = outcome({ kind: 'PATIENT', status: 'UNMATCHED', reason: `Code test « ${s.testCode} » sans correspondance pour cet automate.` });
        continue;
      }
      const base = { kind: 'PATIENT' as const, parameterId: m.parameterId };
      const sample = sampleOf.get(s.specimenId);
      if (!sample) {
        out[i] = outcome({ ...base, status: 'UNMATCHED', reason: `Échantillon « ${s.specimenId} » inconnu du laboratoire.` });
        continue;
      }
      if (sample.order.status === 'CANCELLED') {
        out[i] = outcome({ ...base, status: 'UNMATCHED', reason: 'Demande annulée.' });
        continue;
      }
      if (sample.status !== 'RECEIVED') {
        out[i] = outcome({ ...base, status: 'UNMATCHED', reason: sample.status === 'REJECTED' ? 'Échantillon refusé (non-conformité).' : 'Échantillon pas encore réceptionné au laboratoire.' });
        continue;
      }
      const found = sample.items.flatMap((it) => it.results.map((r) => ({ item: it, result: r }))).find((x) => x.result.parameterId === m.parameterId);
      if (!found) {
        out[i] = outcome({ ...base, status: 'UNMATCHED', reason: `${m.parameterName} n’est pas demandé pour cet échantillon.` });
        continue;
      }
      const v = normalizeInstrumentValue(s.rawValue, s.resultStatus, m, m);
      if (!v.ok) {
        out[i] = outcome({ ...base, status: v.notPerformed ? 'NOT_PERFORMED' : 'UNMATCHED', reason: v.reason });
        continue;
      }
      if (found.item.analysisStatus === 'TECHNICAL_VALIDATED' || found.item.analysisStatus === 'VALIDATED') {
        out[i] = outcome({ ...base, status: 'LOCKED', testResultId: found.result.id, reason: 'Examen déjà validé : une correction doit d’abord être ouverte.' });
        continue;
      }
      if (claimed.has(found.result.id)) {
        out[i] = outcome({ ...base, status: 'CONFLICT', testResultId: found.result.id, reason: 'Même paramètre transmis deux fois dans le message.' });
        continue;
      }
      const r = found.result;
      const filled = r.resultType === 'NUMERIC' ? r.numericValue !== null : !!r.textValue;
      if (filled && sameValue(r, v.value)) {
        out[i] = outcome({ ...base, status: 'APPLIED', testResultId: r.id, reason: 'Valeur identique à celle déjà enregistrée.' });
        claimed.add(r.id);
        continue;
      }
      if (filled && !force) {
        out[i] = outcome({ ...base, status: 'CONFLICT', testResultId: r.id, reason: 'Une autre valeur est déjà enregistrée pour ce paramètre.' });
        continue;
      }
      claimed.add(r.id);
      const list = toApply.get(found.item.id) ?? [];
      list.push({ idx: i, resultId: r.id, value: v.value, comment: r.comment, parameterId: m.parameterId });
      toApply.set(found.item.id, list);
    }

    for (const [itemId, list] of toApply) {
      try {
        await this.results.save(itemId, { results: list.map((x) => ({ resultId: x.resultId, value: x.value, comment: x.comment })) }, actor, { instrumentId: instrument.id });
        for (const x of list) out[x.idx] = outcome({ kind: 'PATIENT', status: 'APPLIED', parameterId: x.parameterId, testResultId: x.resultId });
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        this.logger.warn(`Intégration refusée (${instrument.code}, examen ${itemId}) : ${errorText(e)}`);
        for (const x of list) out[x.idx] = outcome({ kind: 'PATIENT', status: 'UNMATCHED', parameterId: x.parameterId, testResultId: x.resultId, reason: errorText(e) });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // File « à traiter »
  // ---------------------------------------------------------------------------

  /** Relance l'appariement (après ajout d'une correspondance, réception de l'échantillon, correction ouverte…). */
  retry(id: string, actor: RequestUser): Promise<InstrumentResultDto> {
    return this.redo(id, actor, false, 'Relance de l’appariement');
  }

  /** Conflit : le technicien choisit la valeur de l'automate, qui remplace la saisie existante (tracé). */
  accept(id: string, actor: RequestUser): Promise<InstrumentResultDto> {
    return this.redo(id, actor, true, 'Valeur de l’automate retenue à la place de la saisie');
  }

  private async redo(id: string, actor: RequestUser, force: boolean, label: string): Promise<InstrumentResultDto> {
    const row = await this.repo.findResult(id);
    if (!row) throw new NotFoundError('Résultat reçu', id);
    await this.assertInstrumentAccess(row.instrumentId, actor, label.toLowerCase());
    if (force && row.status !== 'CONFLICT') throw new BusinessRuleError('NOT_A_CONFLICT', 'Seul un conflit avec une saisie existante peut être tranché en faveur de l’automate.');
    if (!INSTRUMENT_RESULT_TO_REVIEW.includes(row.status)) throw new BusinessRuleError('ALREADY_RESOLVED', 'Ce résultat a déjà été traité.');
    const instrument = await this.prisma.instrument.findUniqueOrThrow({ where: { id: row.instrumentId } });

    const [o] = await this.resolve(
      instrument,
      [{ specimenId: row.specimenId, testCode: row.instrumentTestCode, rawValue: row.rawValue, unit: row.unit, flags: row.flags, resultStatus: null, measuredAt: row.measuredAt }],
      actor,
      force,
    );
    const resolved = !INSTRUMENT_RESULT_TO_REVIEW.includes(o.status);
    await this.prisma.$transaction(async (tx) => {
      await this.repo.lockResult(id, tx);
      await tx.instrumentResult.update({
        where: { id },
        data: {
          kind: o.kind,
          status: o.status,
          reason: clip(o.reason, 300),
          parameterId: o.parameterId,
          testResultId: o.testResultId,
          qcRunId: o.qcRunId,
          resolvedById: resolved ? actor.id : null,
          resolvedAt: resolved ? new Date() : null,
        },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'InstrumentResult',
        entityId: id,
        before: { status: row.status, reason: row.reason },
        after: { status: o.status, reason: o.reason, testResultId: o.testResultId, qcRunId: o.qcRunId },
        reason: `${label} (${row.specimenId} / ${row.instrumentTestCode} = ${row.rawValue})`,
      });
    });
    await this.refreshMessage(row.messageId);
    return this.getResult(id);
  }

  async dismiss(id: string, reason: string, actor: RequestUser): Promise<InstrumentResultDto> {
    const target = await this.repo.findResult(id);
    if (!target) throw new NotFoundError('Résultat reçu', id);
    await this.assertInstrumentAccess(target.instrumentId, actor, 'mise à l’écart d’un résultat d’automate');
    await this.prisma.$transaction(async (tx) => {
      await this.repo.lockResult(id, tx);
      const row = await this.repo.findResult(id, tx);
      if (!row) throw new NotFoundError('Résultat reçu', id);
      if (!INSTRUMENT_RESULT_TO_REVIEW.includes(row.status)) throw new BusinessRuleError('ALREADY_RESOLVED', 'Ce résultat a déjà été traité.');
      await tx.instrumentResult.update({ where: { id }, data: { status: 'DISMISSED', reason: clip(reason, 300), resolvedById: actor.id, resolvedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'InstrumentResult',
        entityId: id,
        before: { status: row.status, reason: row.reason },
        after: { status: 'DISMISSED' },
        reason: `Résultat d’automate écarté (${row.specimenId} / ${row.instrumentTestCode} = ${row.rawValue}) : ${reason}`,
      });
    });
    const row = await this.repo.findResult(id);
    await this.refreshMessage(row!.messageId);
    return this.getResult(id);
  }

  // ---------------------------------------------------------------------------
  // Consultation
  // ---------------------------------------------------------------------------

  async listResults(query: InstrumentResultsQuery): Promise<Paginated<InstrumentResultDto>> {
    const [rows, total] = await this.repo.listResults(query);
    const [ctx, names] = await Promise.all([this.repo.resultContext(rows), this.lab.userNames(rows.map((r) => r.resolvedById))]);
    return toPage(
      rows.map((r) => toResultDto(r, ctx, names)),
      total,
      query,
    );
  }

  async getResult(id: string): Promise<InstrumentResultDto> {
    const row = await this.repo.findResult(id);
    if (!row) throw new NotFoundError('Résultat reçu', id);
    const [ctx, names] = await Promise.all([this.repo.resultContext([row]), this.lab.userNames([row.resolvedById])]);
    return toResultDto(row, ctx, names);
  }

  async listMessages(query: InstrumentMessagesQuery): Promise<Paginated<InstrumentMessageDto>> {
    const [rows, total] = await this.repo.listMessages(query);
    const names = await this.lab.userNames(rows.map((r) => r.receivedById));
    return toPage(
      rows.map((r) => toMessageDto(r, names)),
      total,
      query,
    );
  }

  async getMessage(id: string): Promise<InstrumentMessageDetailDto> {
    const m = await this.repo.findMessage(id);
    if (!m) throw new NotFoundError('Message d’automate', id);
    const [ctx, names] = await Promise.all([this.repo.resultContext(m.results), this.lab.userNames([m.receivedById, ...m.results.map((r) => r.resolvedById)])]);
    return { ...toMessageDto(m, names), raw: m.raw, warnings: m.warnings, results: m.results.map((r) => toResultDto(r, ctx, names)) };
  }

  /**
   * Liste de travail (requête hôte) : échantillons reçus dont au moins un paramètre à saisir
   * est réalisable par cet automate. Urgences d'abord, puis par ordre de réception.
   */
  async worklist(instrument: Instrument, specimens?: string[]): Promise<InstrumentWorklistDto> {
    const mappings = await this.prisma.instrumentTestMapping.findMany({ where: { instrumentId: instrument.id, isActive: true }, select: { instrumentCode: true, parameterId: true } });
    const codeOf = new Map<string, string>();
    for (const m of mappings) if (!codeOf.has(m.parameterId)) codeOf.set(m.parameterId, m.instrumentCode);
    const now = new Date();
    const { timezone } = await this.lab.settings();
    if (codeOf.size === 0) return { generatedAt: now.toISOString(), orders: [], astm: buildAstmOrders([], now, timezone) };

    const samples = await this.prisma.sample.findMany({
      where: {
        status: 'RECEIVED',
        ...(specimens && specimens.length > 0 ? { number: { in: specimens } } : {}),
        order: { status: { not: 'CANCELLED' } },
        items: { some: { analysisStatus: 'TO_ENTER', results: { some: { parameterId: { in: [...codeOf.keys()] }, numericValue: null, textValue: null } } } },
      },
      select: {
        number: true,
        collectedAt: true,
        receivedAt: true,
        order: { select: { priority: true, patient: { select: { code: true, lastName: true, firstName: true, sex: true, birthDate: true } } } },
        items: {
          where: { analysisStatus: 'TO_ENTER' },
          select: { results: { where: { numericValue: null, textValue: null }, select: { parameterId: true } } },
        },
      },
      orderBy: [{ receivedAt: 'asc' }],
      take: 200,
    });
    const orders = samples
      .map((s) => ({
        sampleNumber: s.number,
        priority: s.order.priority,
        patient: { code: s.order.patient.code, lastName: s.order.patient.lastName, firstName: s.order.patient.firstName, sex: s.order.patient.sex, birthDate: dateToIso(s.order.patient.birthDate) },
        collectedAt: s.collectedAt?.toISOString() ?? null,
        tests: [...new Set(s.items.flatMap((i) => i.results.map((r) => codeOf.get(r.parameterId)).filter((c): c is string => !!c)))],
      }))
      .filter((o) => o.tests.length > 0)
      .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'URGENT' ? -1 : 1));
    return {
      generatedAt: now.toISOString(),
      orders,
      astm: buildAstmOrders(
        orders.map((o) => ({ ...o, collectedAt: o.collectedAt ? new Date(o.collectedAt) : null })),
        now,
        timezone,
      ),
    };
  }
}
