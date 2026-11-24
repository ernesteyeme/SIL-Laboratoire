/**
 * Calculs monétaires en centimes entiers (jamais en virgule flottante).
 * Les montants circulent en chaînes décimales (« 8000.50 ») entre l'API et le frontend.
 */
import type { InvoiceStatus } from './enums';

/** « 8000.5 » / 8000.5 / « 8000,50 » → 800050. Lève une erreur si le format est invalide. */
export function toCents(value: string | number): number {
  const s = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Montant invalide : ${value}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

/** 800050 → « 8000.50 » */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export interface InvoiceTotalsInput {
  lineCents: number[];
  discountCents: number;
  /** Part prise en charge par un tiers (assurance, employeur, programme), en % entier 0–100 */
  coveragePercent: number;
  paidCents: number;
  cancelled?: boolean;
}

export interface InvoiceTotals {
  totalCents: number;
  discountCents: number;
  netCents: number;
  thirdPartyCents: number;
  patientCents: number;
  paidCents: number;
  balanceCents: number;
  status: InvoiceStatus;
}

/**
 * Totaux d'une facture : total − remise = net ; net × couverture = part tiers ; reste = part patient.
 * Le statut ne dépend que de la part patient et de ce qui a été encaissé.
 */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const totalCents = input.lineCents.reduce((a, b) => a + b, 0);
  const discountCents = Math.min(Math.max(0, input.discountCents), totalCents);
  const netCents = totalCents - discountCents;
  const coverage = Math.min(100, Math.max(0, Math.trunc(input.coveragePercent)));
  const thirdPartyCents = Math.round((netCents * coverage) / 100);
  const patientCents = netCents - thirdPartyCents;
  const balanceCents = patientCents - input.paidCents;

  let status: InvoiceStatus;
  if (input.cancelled) status = 'CANCELLED';
  else if (balanceCents <= 0) status = 'PAID';
  else if (input.paidCents > 0) status = 'PARTIALLY_PAID';
  else status = 'UNPAID';

  return { totalCents, discountCents, netCents, thirdPartyCents, patientCents, paidCents: input.paidCents, balanceCents, status };
}

// ---------------------------------------------------------------------------
// Bi-devise CDF / USD
// ---------------------------------------------------------------------------

/** Devise secondaire acceptée en caisse (null si la caisse n'est pas bi-devise). */
export function secondaryCurrencyFor(baseCurrency: string, enabled: boolean): string | null {
  if (!enabled) return null;
  if (baseCurrency === 'CDF') return 'USD';
  if (baseCurrency === 'USD') return 'CDF';
  return null;
}

/** « 2850.5 » → 28505000n (taux en dix-millièmes). */
export function rateToScaled(rate: string | number): bigint {
  const s = String(rate).trim().replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) throw new Error(`Taux invalide : ${rate}`);
  return BigInt(m[1]) * 10000n + BigInt((m[2] ?? '').padEnd(4, '0'));
}

function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (2n * d);
}

/**
 * Conversion entre CDF et USD au taux « X CDF pour 1 USD », en centimes, arrondi au centime le plus proche.
 * Toute autre combinaison de devises est refusée.
 */
export function convertCents(cents: number, from: string, to: string, cdfPerUsd: string | number): number {
  if (from === to) return cents;
  const rate = rateToScaled(cdfPerUsd);
  if (rate <= 0n) throw new Error('Le taux de change doit être positif.');
  const c = BigInt(Math.round(cents));
  if (from === 'USD' && to === 'CDF') return Number(divRoundHalfUp(c * rate, 10000n));
  if (from === 'CDF' && to === 'USD') return Number(divRoundHalfUp(c * 10000n, rate));
  throw new Error(`Conversion ${from} → ${to} non prise en charge.`);
}
