import { Injectable } from '@nestjs/common';
import {
  aggregateDhis2,
  dataValueSetToCsv,
  monthPeriodBounds,
  type Dhis2DataValueSet,
  type Dhis2MappingRule,
  type Dhis2PreviewDto,
  type Dhis2PreviewLineDto,
  type Dhis2SendInput,
  type InteropRunDetailDto,
} from '@lims/shared';
import { LabContextService } from '../../core/common/lab-context.service';
import { zonedPeriod } from '../../core/common/time';
import { decimalToNumber } from '../../core/common/values';
import { BusinessRuleError } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InteropEndpointsService } from './endpoints.service';
import { Dhis2Gateway } from './gateways';
import { InteropTransportError } from './interop-http';
import { readDhis2Settings } from './interop.mapper';
import { InteropRepository } from './interop.repository';
import { InteropRunsService, payloadSha256 } from './runs.service';

/** Date locale « AAAA-MM-JJ » d'un instant dans le fuseau du laboratoire. */
export function localIsoDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

interface BuiltSet {
  set: Dhis2DataValueSet;
  preview: Omit<Dhis2PreviewDto, 'lastSentAt' | 'lastSentSha256'>;
  periodStart: Date;
}

@Injectable()
export class Dhis2ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InteropRepository,
    private readonly endpoints: InteropEndpointsService,
    private readonly lab: LabContextService,
    private readonly gateway: Dhis2Gateway,
    private readonly runs: InteropRunsService,
  ) {}

  /**
   * Calcul des valeurs agrégées du mois : résultats ayant reçu leur validation biologique
   * pendant la période (heure locale du laboratoire), hors demandes annulées.
   */
  private async build(endpointId: string, period: string): Promise<BuiltSet> {
    const endpoint = await this.endpoints.require(endpointId, { system: 'DHIS2' });
    const settings = readDhis2Settings(endpoint);
    const { timezone } = await this.lab.settings();
    const { from, to } = monthPeriodBounds(period);
    const { start, end } = zonedPeriod(from, to, timezone);
    const mappings = await this.repo.listDhis2Mappings(endpointId, true);
    const rules: Dhis2MappingRule[] = mappings.map((m) => ({
      id: m.id,
      parameterId: m.parameterId,
      measure: m.measure,
      threshold: decimalToNumber(m.threshold),
      textMatch: m.textMatch,
      sex: m.sex,
      ageMinYears: m.ageMinYears,
      ageMaxYears: m.ageMaxYears,
    }));
    const raw = await this.repo.dhis2Rows([...new Set(rules.map((r) => r.parameterId))], start, end);
    const rows = raw.map((r) => ({
      parameterId: r.parameterId,
      numericValue: decimalToNumber(r.numericValue),
      qualifier: r.qualifier,
      textValue: r.textValue,
      sex: r.sex,
      birthDate: r.birthDate ? r.birthDate.toISOString().slice(0, 10) : null,
      orderDate: localIsoDate(r.orderCreatedAt, timezone),
    }));
    const counts = aggregateDhis2(rules, rows);
    const lines: Dhis2PreviewLineDto[] = mappings.map((m) => {
      const c = counts.get(m.id)!;
      return {
        mappingId: m.id,
        label: m.label,
        dataElement: m.dataElement,
        categoryOptionCombo: m.categoryOptionCombo,
        value: c.count,
        excludedNoAge: c.excludedNoAge,
        excludedAmbiguous: c.excludedAmbiguous,
        sent: c.count > 0 || settings.sendZeros,
      };
    });
    const set: Dhis2DataValueSet = {
      ...(settings.dataSet ? { dataSet: settings.dataSet } : {}),
      period,
      orgUnit: settings.orgUnit,
      ...(settings.attributeOptionCombo ? { attributeOptionCombo: settings.attributeOptionCombo } : {}),
      dataValues: lines
        .filter((l) => l.sent)
        .map((l) => ({ dataElement: l.dataElement, ...(l.categoryOptionCombo ? { categoryOptionCombo: l.categoryOptionCombo } : {}), value: String(l.value) })),
    };
    const warnings: string[] = [];
    if (mappings.length === 0) warnings.push('Aucune correspondance active : définissez les éléments de données à alimenter.');
    const noAge = lines.reduce((s, l) => s + l.excludedNoAge, 0);
    if (noAge > 0) warnings.push(`${noAge} résultat(s) écarté(s) d’une ventilation par âge faute de date de naissance du patient.`);
    const ambiguous = lines.reduce((s, l) => s + l.excludedAmbiguous, 0);
    if (ambiguous > 0) warnings.push(`${ambiguous} résultat(s) écarté(s) car leur position par rapport au seuil est indéterminée (limite de détection supérieure au seuil).`);
    if (end.getTime() > Date.now()) warnings.push('Période en cours : les valeurs évolueront jusqu’à la fin du mois.');
    if (!endpoint.isActive) warnings.push('Connexion désactivée : l’envoi est impossible.');
    return {
      set,
      periodStart: start,
      preview: { endpointId, period, periodFrom: from, periodTo: to, resultCount: rows.length, lines, warnings, payloadSha256: payloadSha256(set) },
    };
  }

  async preview(endpointId: string, period: string): Promise<Dhis2PreviewDto> {
    const built = await this.build(endpointId, period);
    const last = await this.repo.lastDhis2Send(endpointId, period);
    return { ...built.preview, lastSentAt: last?.createdAt.toISOString() ?? null, lastSentSha256: last?.payloadSha256 ?? null };
  }

  async csv(endpointId: string, period: string): Promise<{ filename: string; content: string }> {
    const built = await this.build(endpointId, period);
    const endpoint = await this.endpoints.require(endpointId);
    return { filename: `dhis2-${endpoint.code.toLowerCase()}-${period}.csv`, content: dataValueSetToCsv(built.set) };
  }

  /** Simulation (dryRun : DHIS2 valide sans enregistrer) ou envoi réel, toujours journalisé. */
  async send(endpointId: string, input: Dhis2SendInput, actorId: string): Promise<InteropRunDetailDto> {
    const endpoint = await this.endpoints.require(endpointId, { system: 'DHIS2', active: true });
    const built = await this.build(endpointId, input.period);
    if (built.set.dataValues.length === 0) {
      throw new BusinessRuleError('DHIS2_NOTHING_TO_SEND', 'Aucune valeur à transmettre pour cette période (pas de correspondance active, ou valeurs nulles non envoyées).');
    }
    if (!input.dryRun && built.periodStart.getTime() > Date.now()) {
      throw new BusinessRuleError('DHIS2_FUTURE_PERIOD', 'Impossible de transmettre une période future.');
    }
    const kind = input.dryRun ? 'DHIS2_DRY_RUN' : 'DHIS2_SEND';
    let record;
    try {
      const r = await this.gateway.postDataValueSet(this.endpoints.profile(endpoint), built.set, input.dryRun);
      record = {
        status: r.outcome.status,
        httpStatus: r.httpStatus,
        openhimTransactionId: r.openhimTransactionId,
        imported: r.outcome.imported,
        updated: r.outcome.updated,
        ignored: r.outcome.ignored,
        deleted: r.outcome.deleted,
        conflicts: r.outcome.conflicts,
        message: `${input.dryRun ? 'Simulation : ' : ''}${r.outcome.message}`,
        durationMs: r.durationMs,
      } as const;
    } catch (e) {
      if (!(e instanceof InteropTransportError)) throw e;
      record = { status: 'ERROR', message: e.message, durationMs: e.durationMs } as const;
    }
    const runId = await this.prisma.$transaction((tx) =>
      this.runs.record(tx, { endpointId, kind, period: input.period, itemCount: built.set.dataValues.length, payload: built.set, triggeredById: actorId, ...record }),
    );
    return this.runs.get(runId);
  }
}
