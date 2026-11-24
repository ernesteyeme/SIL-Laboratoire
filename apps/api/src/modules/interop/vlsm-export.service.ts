import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ageInMonthsAt,
  ageInYearsAt,
  formatVlsmDate,
  formatVlsmDateTime,
  formatVlsmViralLoad,
  type InteropRunDetailDto,
  type InteropRunStatus,
  type VlsmPendingItemDto,
  type VlsmPendingQuery,
  type VlsmSendInput,
  type VlsmSettings,
  type VlsmTestType,
} from '@lims/shared';
import { LabContextService } from '../../core/common/lab-context.service';
import { addDaysIso, zonedPeriod } from '../../core/common/time';
import { decimalToNumber } from '../../core/common/values';
import { BusinessRuleError, ConflictError } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { localIsoDate } from './dhis2-export.service';
import { InteropEndpointsService } from './endpoints.service';
import { VlsmAuthError, VlsmGateway } from './gateways';
import { InteropTransportError } from './interop-http';
import { readVlsmSettings } from './interop.mapper';
import { InteropRepository, type VlsmItemRow, type VlsmMappingRow } from './interop.repository';
import { InteropRunsService } from './runs.service';

export const VLSM_APP_VERSION = 'LIMS-ISO15189 1.0';
/** Fenêtre par défaut de la file d'envoi : résultats validés des 30 derniers jours. */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_PENDING = 500;

/** Identifiant VLSM stable d'un examen : une correction met à jour le même enregistrement distant. */
export function vlsmUniqueId(orderItemId: string): string {
  return createHash('sha256').update(`lims:${orderItemId}`, 'utf8').digest('hex').slice(0, 32);
}

const gender = (sex: 'MALE' | 'FEMALE' | 'UNKNOWN') => (sex === 'MALE' ? 'male' : sex === 'FEMALE' ? 'female' : 'unreported');
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export type VlsmBuild = { ok: true; testType: VlsmTestType; record: Record<string, unknown>; display: string } | { ok: false; testType: VlsmTestType; blocker: string; display: string | null };

/**
 * Enregistrement au format de /vl/save-request.php ou /eid/save-request.php (API InteLIS v1.1) :
 * la demande et son résultat validé (resultStatus 7 = accepté), ou la donnée obligatoire manquante.
 */
export function buildVlsmRecord(item: VlsmItemRow, mapping: Pick<VlsmMappingRow, 'parameterId' | 'testType' | 'eidPositive' | 'eidNegative' | 'eidIndeterminate'>, settings: VlsmSettings, timeZone: string): VlsmBuild {
  const result = item.results.find((r) => r.parameterId === mapping.parameterId);
  const patient = item.order.patient;
  const testType = mapping.testType;
  const numeric = decimalToNumber(result?.numericValue ?? null);
  let display: string | null = null;
  let eidResult: string | null = null;
  if (testType === 'VL') {
    display = formatVlsmViralLoad(numeric, result?.qualifier ?? null, result?.textValue ?? null);
  } else {
    const text = result?.textValue?.trim() ?? null;
    display = text;
    if (text) {
      const t = normalize(text);
      if (mapping.eidPositive && t === normalize(mapping.eidPositive)) eidResult = 'positive';
      else if (mapping.eidNegative && t === normalize(mapping.eidNegative)) eidResult = 'negative';
      else if (mapping.eidIndeterminate && t === normalize(mapping.eidIndeterminate)) eidResult = 'indeterminate';
    }
  }
  const artNo = patient.externalId?.trim() || null;
  const fail = (blocker: string): VlsmBuild => ({ ok: false, testType, blocker, display });
  if (!result || display === null) return fail('Résultat vide.');
  if (testType === 'EID' && !eidResult) return fail(`Résultat « ${display} » sans correspondance EID (positif / négatif / indéterminé).`);
  if (!artNo) return fail(testType === 'VL' ? 'N° TARV du patient manquant (identifiant externe du dossier patient).' : 'Code de l’enfant exposé manquant (identifiant externe du dossier patient).');
  if (!item.sample.collectedAt) return fail('Date de prélèvement inconnue.');
  if (!item.validatedAt) return fail('Examen non validé.');

  const specimenType = settings.specimenTypes.find((s) => s.sampleTypeId === item.sample.sampleTypeId)?.vlsmSpecimenType ?? settings.defaultSpecimenType;
  const orderDate = localIsoDate(item.order.createdAt, timeZone);
  const dob = patient.birthDate ? patient.birthDate.toISOString().slice(0, 10) : null;
  const prescriber = item.order.prescriber ? [item.order.prescriber.title, item.order.prescriber.firstName, item.order.prescriber.lastName].filter(Boolean).join(' ') : '';
  const dt = (d: Date | null | undefined) => (d ? formatVlsmDateTime(d, timeZone) : '');
  const tested = item.technicalValidatedAt ?? result.enteredAt ?? item.validatedAt;
  const common = {
    uniqueId: vlsmUniqueId(item.id),
    appSampleCode: item.sample.number,
    facilityId: String(settings.facilityId),
    ...(settings.provinceId ? { provinceId: String(settings.provinceId) } : {}),
    labId: String(settings.labId),
    sampleCollectionDate: dt(item.sample.collectedAt),
    specimenType: String(specimenType),
    sampleReceivedDate: dt(item.sample.receivedAt),
    resultDispatchedOn: dt(item.validatedAt),
    isSampleRejected: 'no',
    labComments: item.biologistComment ?? '',
  };
  if (testType === 'VL') {
    return {
      ok: true,
      testType,
      display,
      record: {
        ...common,
        sampleReordered: 'no',
        patientFirstName: patient.firstName ?? '',
        patientMiddleName: patient.middleName ?? '',
        patientLastName: patient.lastName,
        patientGender: gender(patient.sex),
        patientDob: dob ? formatVlsmDate(dob) : '',
        ageInYears: dob ? String(ageInYearsAt(dob, orderDate)) : '',
        ageInMonths: dob ? String(ageInMonthsAt(dob, orderDate) % 12) : '',
        patientArtNo: artNo,
        patientPhoneNumber: patient.phone ?? '',
        reasonForVLTesting: settings.reasonForVLTesting,
        reqClinician: prescriber,
        reqClinicianPhoneNumber: item.order.prescriber?.phone ?? '',
        requestDate: formatVlsmDate(orderDate),
        sampleTestingDateAtLab: dt(tested),
        vlResult: display,
        result: display,
        approvedOnDateTime: dt(item.validatedAt),
        resultStatus: '7',
      },
    };
  }
  return {
    ok: true,
    testType,
    display,
    record: {
      ...common,
      childId: artNo,
      childName: patient.firstName ?? '',
      childSurName: patient.lastName,
      childDob: dob ? formatVlsmDate(dob) : '',
      childGender: gender(patient.sex),
      childAge: dob ? String(ageInMonthsAt(dob, orderDate)) : '',
      mothersId: '',
      sampleRequestorName: prescriber,
      sampleRequestorPhone: item.order.prescriber?.phone ?? '',
      sampleTestedDateTime: dt(tested),
      result: eidResult,
      approvedOn: dt(item.validatedAt),
      status: '7',
      resultStatus: '7',
    },
  };
}

@Injectable()
export class VlsmExportService {
  /** Envois en cours par connexion : empêche deux envois simultanés des mêmes résultats. */
  private readonly busy = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InteropRepository,
    private readonly endpoints: InteropEndpointsService,
    private readonly lab: LabContextService,
    private readonly gateway: VlsmGateway,
    private readonly runs: InteropRunsService,
  ) {}

  private mappingFor(item: VlsmItemRow, mappings: VlsmMappingRow[]): VlsmMappingRow | undefined {
    return mappings.find((m) => item.results.some((r) => r.parameterId === m.parameterId));
  }

  /** File d'envoi : examens validés transmissibles qui n'ont pas encore été acceptés par VLSM à leur version actuelle. */
  async pending(endpointId: string, query: VlsmPendingQuery): Promise<VlsmPendingItemDto[]> {
    const endpoint = await this.endpoints.require(endpointId, { system: 'VLSM' });
    const settings = readVlsmSettings(endpoint);
    const { timezone } = await this.lab.settings();
    const today = localIsoDate(new Date(), timezone);
    const to = query.to ?? today;
    const from = query.from ?? addDaysIso(to, -DEFAULT_WINDOW_DAYS);
    if (from > to) throw new BusinessRuleError('PERIOD_INVALID', 'La date de début doit précéder la date de fin.');
    const mappings = await this.repo.listVlsmMappings(endpointId, true);
    if (mappings.length === 0) return [];
    const { start, end } = zonedPeriod(from, to, timezone);
    const items = await this.repo.vlsmCandidates(mappings.map((m) => m.parameterId), start, end, MAX_PENDING);
    const ids = items.map((i) => i.id);
    const [sent, last] = await Promise.all([this.repo.sentVersions(endpointId, ids), this.repo.lastSubmissions(endpointId, ids)]);
    const out: VlsmPendingItemDto[] = [];
    for (const item of items) {
      if (sent.has(`${item.id}:${item.version}`)) continue;
      const mapping = this.mappingFor(item, mappings)!;
      const built = buildVlsmRecord(item, mapping, settings, timezone);
      const p = item.order.patient;
      const attempt = last.get(item.id);
      out.push({
        orderItemId: item.id,
        orderId: item.order.id,
        orderNumber: item.order.number,
        sampleNumber: item.sample.number,
        patientCode: p.code,
        patientName: [p.lastName, p.middleName, p.firstName].filter(Boolean).join(' '),
        patientArtNo: p.externalId,
        examName: item.examName,
        testType: mapping.testType,
        value: built.display,
        validatedAt: item.validatedAt!.toISOString(),
        itemVersion: item.version,
        blocker: built.ok ? null : built.blocker,
        lastAttempt: attempt ? { status: attempt.status, message: attempt.message, at: attempt.createdAt.toISOString(), itemVersion: attempt.itemVersion } : null,
      });
    }
    return out;
  }

  async send(endpointId: string, input: VlsmSendInput, actorId: string): Promise<InteropRunDetailDto> {
    if (this.busy.has(endpointId)) throw new ConflictError('Un envoi vers cette connexion VLSM est déjà en cours.');
    this.busy.add(endpointId);
    try {
      return await this.doSend(endpointId, [...new Set(input.orderItemIds)], actorId);
    } finally {
      this.busy.delete(endpointId);
    }
  }

  private async doSend(endpointId: string, ids: string[], actorId: string): Promise<InteropRunDetailDto> {
    const endpoint = await this.endpoints.require(endpointId, { system: 'VLSM', active: true });
    const settings = readVlsmSettings(endpoint);
    const { timezone } = await this.lab.settings();
    const mappings = await this.repo.listVlsmMappings(endpointId, true);
    if (mappings.length === 0) throw new BusinessRuleError('VLSM_NO_MAPPING', 'Aucun paramètre n’est associé à VLSM pour cette connexion.');
    const items = await this.repo.vlsmItemsByIds(ids, mappings.map((m) => m.parameterId));
    const found = new Set(items.map((i) => i.id));
    const notEligible = ids.filter((id) => !found.has(id)).length + items.filter((i) => i.analysisStatus !== 'VALIDATED' || i.order.status === 'CANCELLED').length;
    if (notEligible > 0) {
      throw new BusinessRuleError('VLSM_ITEM_NOT_ELIGIBLE', `${notEligible} examen(s) sélectionné(s) introuvable(s), non validé(s) ou sans paramètre transmis à VLSM.`);
    }
    const sent = await this.repo.sentVersions(endpointId, ids);
    const toSend = items.filter((i) => !sent.has(`${i.id}:${i.version}`));
    if (toSend.length === 0) throw new BusinessRuleError('VLSM_ALREADY_SENT', 'Ces résultats ont déjà été acceptés par VLSM (dans leur version actuelle).');

    const builds = toSend.map((item) => ({ item, build: buildVlsmRecord(item, this.mappingFor(item, mappings)!, settings, timezone) }));
    const blocked = builds.filter((b) => !b.build.ok);
    if (blocked.length) {
      const detail = blocked.slice(0, 5).map((b) => `${b.item.sample.number} : ${(b.build as { blocker: string }).blocker}`).join(' ; ');
      throw new BusinessRuleError('VLSM_ITEM_INCOMPLETE', `${blocked.length} résultat(s) incomplet(s) pour VLSM — ${detail}`);
    }

    const profile = this.endpoints.profile(endpoint);
    const groups = (['VL', 'EID'] as const)
      .map((t) => ({ testType: t, entries: builds.filter((b) => b.build.testType === t) as { item: VlsmItemRow; build: Extract<VlsmBuild, { ok: true }> }[] }))
      .filter((g) => g.entries.length > 0);
    const outcomes = new Map<string, { ok: boolean; remote: string | null; message: string | null }>();
    const messages: string[] = [];
    let httpStatus: number | null = null;
    let openhimTransactionId: string | null = null;
    let durationMs = 0;

    let token: string | undefined;
    let authFailed: string | null = null;
    try {
      const auth = await this.gateway.bearer(profile);
      token = auth.token;
      durationMs += auth.trace?.durationMs ?? 0;
    } catch (e) {
      if (e instanceof VlsmAuthError) {
        authFailed = e.message;
        httpStatus = e.trace.httpStatus;
        durationMs += e.trace.durationMs;
      } else if (e instanceof InteropTransportError) {
        authFailed = e.message;
        durationMs += e.durationMs;
      } else throw e;
    }

    for (const group of groups) {
      if (authFailed) {
        for (const e of group.entries) outcomes.set(e.item.id, { ok: false, remote: null, message: authFailed });
        continue;
      }
      try {
        const r = await this.gateway.saveRequests(profile, token, group.testType, group.entries.map((e) => e.build.record), VLSM_APP_VERSION);
        httpStatus = r.httpStatus;
        openhimTransactionId = r.openhimTransactionId ?? openhimTransactionId;
        durationMs += r.durationMs;
        if (r.outcome.rotatedToken) token = r.outcome.rotatedToken;
        group.entries.forEach((e, index) => {
          if (r.outcome.globalError) {
            outcomes.set(e.item.id, { ok: false, remote: null, message: r.outcome.globalError });
            return;
          }
          const uid = e.build.record.uniqueId as string;
          const rec =
            r.outcome.records.find((x) => x.uniqueId === uid) ??
            r.outcome.records.find((x) => x.appSampleCode === e.item.sample.number) ??
            r.outcome.records[index];
          outcomes.set(e.item.id, rec ? { ok: rec.ok, remote: rec.sampleCode, message: rec.message } : { ok: false, remote: null, message: 'Aucune réponse de VLSM pour cet enregistrement.' });
        });
        if (r.outcome.globalError) messages.push(`${group.testType} : ${r.outcome.globalError}`);
      } catch (e) {
        if (!(e instanceof InteropTransportError)) throw e;
        durationMs += e.durationMs;
        messages.push(`${group.testType} : ${e.message}`);
        for (const entry of group.entries) outcomes.set(entry.item.id, { ok: false, remote: null, message: e.message });
      }
    }
    if (authFailed) messages.unshift(authFailed);

    const okCount = [...outcomes.values()].filter((o) => o.ok).length;
    const status: InteropRunStatus = okCount === builds.length ? 'SUCCESS' : okCount === 0 ? 'ERROR' : 'WARNING';
    const summary = `${okCount}/${builds.length} résultat(s) accepté(s) par VLSM`;
    // La charge stockée est expurgée des données patient ; l'empreinte porte sur le contenu réellement envoyé.
    const stored = groups.map((g) => ({ testType: g.testType, records: g.entries.map((e) => ({ appSampleCode: e.item.sample.number, uniqueId: e.build.record.uniqueId, itemVersion: e.item.version })) }));
    const sentBody = groups.map((g) => ({ testType: g.testType, appVersion: VLSM_APP_VERSION, data: g.entries.map((e) => e.build.record) }));

    const runId = await this.prisma.$transaction(async (tx) => {
      const id = await this.runs.record(tx, {
        endpointId,
        kind: 'VLSM_SEND',
        status,
        itemCount: builds.length,
        payload: stored,
        hashedContent: sentBody,
        httpStatus,
        openhimTransactionId,
        message: [summary, ...messages].join(' — '),
        durationMs,
        triggeredById: actorId,
      });
      await tx.vlsmSubmission.createMany({
        data: builds.map(({ item, build }) => {
          const o = outcomes.get(item.id)!;
          return {
            endpointId,
            runId: id,
            orderItemId: item.id,
            itemVersion: item.version,
            status: o.ok ? ('SENT' as const) : ('FAILED' as const),
            uniqueId: (build as Extract<VlsmBuild, { ok: true }>).record.uniqueId as string,
            remoteSampleCode: o.remote?.slice(0, 100) ?? null,
            message: o.message?.slice(0, 500) ?? null,
          };
        }),
      });
      return id;
    });
    return this.runs.get(runId);
  }
}
