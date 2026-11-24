import { convertCents, type PaymentMethod } from '@lims/shared';

export interface TenderInput {
  /** Montant remis, en centimes de la devise remise */
  tenderedCents: number;
  currency: string;
  baseCurrency: string;
  /** Taux du jour « CDF pour 1 USD » (obligatoire si devise remise ≠ devise de base) */
  cdfPerUsd: string | null;
  /** Reste à payer, en centimes de devise de base */
  balanceCents: number;
  method: PaymentMethod;
}

export type TenderResult =
  | { ok: true; convertedCents: number; appliedCents: number; changeCents: number }
  | { ok: false; rule: 'RATE_REQUIRED' | 'AMOUNT_EXCEEDS_BALANCE' | 'ALREADY_PAID'; convertedCents?: number };

/**
 * Règlement d'un montant remis :
 *  - conversion en devise de base au taux du jour si nécessaire (arrondi au centime) ;
 *  - en espèces, l'excédent est rendu en devise de base (monnaie) ;
 *  - par carte, mobile money ou virement, aucun excédent n'est admis (pas de monnaie à rendre).
 */
export function settleTender(t: TenderInput): TenderResult {
  if (t.balanceCents <= 0) return { ok: false, rule: 'ALREADY_PAID' };
  if (t.currency !== t.baseCurrency && !t.cdfPerUsd) return { ok: false, rule: 'RATE_REQUIRED' };
  const convertedCents = t.currency === t.baseCurrency ? t.tenderedCents : convertCents(t.tenderedCents, t.currency, t.baseCurrency, t.cdfPerUsd!);
  if (convertedCents <= t.balanceCents) return { ok: true, convertedCents, appliedCents: convertedCents, changeCents: 0 };
  if (t.method !== 'CASH') return { ok: false, rule: 'AMOUNT_EXCEEDS_BALANCE', convertedCents };
  return { ok: true, convertedCents, appliedCents: t.balanceCents, changeCents: convertedCents - t.balanceCents };
}
