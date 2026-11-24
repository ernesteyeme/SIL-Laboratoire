import { Injectable } from '@nestjs/common';
import type { Db } from '../prisma/prisma.service';

export type CounterKey = 'ORDER' | 'SAMPLE' | 'INVOICE' | 'RECEIPT' | 'CASH_SESSION' | 'REPORT' | 'QUALITY_ISSUE';

/** Date « civile » dans le fuseau du laboratoire (les compteurs repartent à 1 chaque année / chaque jour local). */
export function labPeriods(date: Date, timeZone: string): { year: string; yymmdd: string; isoDate: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = get('year');
  return { year, yymmdd: `${year.slice(2)}${get('month')}${get('day')}`, isoDate: `${year}-${get('month')}-${get('day')}` };
}

/**
 * Numérotation séquentielle SANS TROU (exigence comptable pour les factures et reçus).
 * L'incrément se fait par INSERT … ON CONFLICT dans la transaction appelante :
 * le compteur est verrouillé jusqu'au commit, et une transaction annulée ne consomme aucun numéro.
 */
@Injectable()
export class NumberingService {
  async next(db: Db, key: CounterKey, period: string): Promise<number> {
    const rows = await db.$queryRaw<{ value: number }[]>`
      INSERT INTO "counters" ("key", "period", "value") VALUES (${key}, ${period}, 1)
      ON CONFLICT ("key", "period") DO UPDATE SET "value" = "counters"."value" + 1
      RETURNING "value"
    `;
    return Number(rows[0].value);
  }

  /** DEM-2026-000001 */
  async orderNumber(db: Db, timeZone: string, now = new Date()): Promise<string> {
    const { year } = labPeriods(now, timeZone);
    return `DEM-${year}-${String(await this.next(db, 'ORDER', year)).padStart(6, '0')}`;
  }

  /** 2611220001 : date locale AAMMJJ + rang du jour (code-barres numérique compact). */
  async sampleNumber(db: Db, timeZone: string, now = new Date()): Promise<string> {
    const { yymmdd } = labPeriods(now, timeZone);
    return `${yymmdd}${String(await this.next(db, 'SAMPLE', yymmdd)).padStart(4, '0')}`;
  }

  /** FAC-2026-000001 */
  async invoiceNumber(db: Db, timeZone: string, now = new Date()): Promise<string> {
    const { year } = labPeriods(now, timeZone);
    return `FAC-${year}-${String(await this.next(db, 'INVOICE', year)).padStart(6, '0')}`;
  }

  /** REC-2026-000001 */
  async receiptNumber(db: Db, timeZone: string, now = new Date()): Promise<string> {
    const { year } = labPeriods(now, timeZone);
    return `REC-${year}-${String(await this.next(db, 'RECEIPT', year)).padStart(6, '0')}`;
  }

  /** CR-2026-000001 (compte rendu) */
  async reportNumber(db: Db, timeZone: string, now = new Date()): Promise<string> {
    const { year } = labPeriods(now, timeZone);
    return `CR-${year}-${String(await this.next(db, 'REPORT', year)).padStart(6, '0')}`;
  }

  /** NC-2026-0001 (fiche de non-conformité) */
  async qualityIssueNumber(db: Db, timeZone: string, now = new Date()): Promise<string> {
    const { year } = labPeriods(now, timeZone);
    return `NC-${year}-${String(await this.next(db, 'QUALITY_ISSUE', year)).padStart(4, '0')}`;
  }

  /** CS-2026-0001 */
  async cashSessionNumber(db: Db, timeZone: string, now = new Date()): Promise<string> {
    const { year } = labPeriods(now, timeZone);
    return `CS-${year}-${String(await this.next(db, 'CASH_SESSION', year)).padStart(4, '0')}`;
  }
}
