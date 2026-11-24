import { Injectable } from '@nestjs/common';
import { parseIsoDate, type ExchangeRateDto, type ExchangeRateInput } from '@lims/shared';
import type { ExchangeRate } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { dateToIso } from '../../core/common/values';
import type { RequestUser } from '../../core/context/request-context';
import { labPeriods } from '../../core/numbering/numbering.service';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

/**
 * Taux de change du jour (CDF pour 1 USD). Un taux par date locale du laboratoire ;
 * un paiement en devise secondaire exige le taux du jour (pas de taux périmé) et le fige.
 */
@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
  ) {}

  async todayDate(db: Db = this.prisma): Promise<string> {
    const settings = await this.lab.settings(db);
    return labPeriods(new Date(), settings.timezone).isoDate;
  }

  /** Taux applicable aujourd'hui, ou null s'il n'a pas encore été saisi. */
  async today(db: Db = this.prisma): Promise<ExchangeRate | null> {
    return db.exchangeRate.findUnique({ where: { effectiveDate: parseIsoDate(await this.todayDate(db)) } });
  }

  async getToday(): Promise<ExchangeRateDto | null> {
    const rate = await this.today();
    return rate ? this.toDto(rate) : null;
  }

  async list(): Promise<ExchangeRateDto[]> {
    const rows = await this.prisma.exchangeRate.findMany({ orderBy: { effectiveDate: 'desc' }, take: 60 });
    const names = await this.lab.userNames(rows.map((r) => r.setById));
    return rows.map((r) => this.toDtoSync(r, names));
  }

  /** Saisie ou correction du taux du jour (les paiements déjà enregistrés gardent leur taux). */
  async setToday(input: ExchangeRateInput, actor: RequestUser): Promise<ExchangeRateDto> {
    const saved = await this.prisma.$transaction(async (tx) => {
      const date = parseIsoDate(await this.todayDate(tx));
      const current = await tx.exchangeRate.findUnique({ where: { effectiveDate: date } });
      const next = await tx.exchangeRate.upsert({
        where: { effectiveDate: date },
        create: { effectiveDate: date, cdfPerUsd: input.cdfPerUsd, note: input.note ?? null, setById: actor.id },
        update: { cdfPerUsd: input.cdfPerUsd, note: input.note ?? null, setById: actor.id },
      });
      const view = (r: ExchangeRate) => ({ effectiveDate: dateToIso(r.effectiveDate), cdfPerUsd: r.cdfPerUsd.toFixed(4), note: r.note });
      await this.audit.record(tx, {
        action: current ? 'UPDATE' : 'CREATE',
        entity: 'ExchangeRate',
        entityId: next.id,
        before: current ? view(current) : undefined,
        after: view(next),
        reason: current
          ? `Correction du taux du ${dateToIso(date)} : ${current.cdfPerUsd.toFixed(4)} → ${next.cdfPerUsd.toFixed(4)} CDF/USD`
          : `Taux du ${dateToIso(date)} : ${next.cdfPerUsd.toFixed(4)} CDF/USD`,
      });
      return next;
    });
    return this.toDto(saved);
  }

  private async toDto(r: ExchangeRate): Promise<ExchangeRateDto> {
    return this.toDtoSync(r, await this.lab.userNames([r.setById]));
  }

  private toDtoSync(r: ExchangeRate, names: Map<string, string>): ExchangeRateDto {
    return {
      id: r.id,
      effectiveDate: dateToIso(r.effectiveDate) ?? '',
      cdfPerUsd: r.cdfPerUsd.toFixed(4),
      note: r.note,
      setBy: names.get(r.setById) ?? null,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
