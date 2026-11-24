import { parseIsoDate } from '@lims/shared';

/** Decimal Prisma (ou null) → number (ou null). Réservé aux valeurs de mesure, jamais aux montants. */
export function decimalToNumber(value: { toNumber(): number } | null | undefined): number | null {
  return value == null ? null : value.toNumber();
}

/** Decimal Prisma → chaîne à 2 décimales (montants). */
export function moneyToString(value: { toFixed(dp: number): string }): string {
  return value.toFixed(2);
}

/** Colonne DATE (renvoyée à minuit UTC) → « AAAA-MM-JJ ». */
export function dateToIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** « AAAA-MM-JJ » → Date pour une colonne DATE. */
export function isoToDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : parseIsoDate(value);
}
