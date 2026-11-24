/**
 * Lecture et interprétation des résultats saisis (partagées API / frontend pour un affichage identique).
 */
import type { ResultFlag, ResultType } from './enums';
import { interpretNumeric } from './clinical';

export type Qualifier = '<' | '>';

export interface ParsedNumeric {
  value: number;
  qualifier: Qualifier | null;
}

/**
 * Lit une saisie numérique : « 12,5 », « 12.5 », « 1 250 000 », « <40 », « < 40 », « >10 000 000 ».
 * Les qualificatifs < et > expriment les limites de détection ou de quantification (ex. charge virale indétectable).
 */
export function parseNumericInput(raw: string): ParsedNumeric | null {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.');
  const m = /^([<>])?(-?\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const value = Number(m[2]);
  if (!Number.isFinite(value) || Math.abs(value) >= 1e10) return null;
  return { value, qualifier: (m[1] as Qualifier | undefined) ?? null };
}

/** Instantané de la valeur de référence appliquée à un résultat (figé à la saisie). */
export interface RangeSnapshot {
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  normalText: string | null;
}

/**
 * Interprétation d'un résultat :
 *  - numérique : bas / normal / élevé / critique selon les bornes ;
 *  - « < x » : seul le seuil bas compte (la valeur réelle est inférieure à x) ; « > x » : seul le seuil haut compte ;
 *  - texte / choix : « Anormal » si la valeur diffère de la valeur normale attendue.
 * Renvoie null s'il n'y a pas de valeur de référence ou pas de valeur.
 */
export function computeResultFlag(
  type: ResultType,
  input: { numeric?: ParsedNumeric | null; text?: string | null },
  range: RangeSnapshot | null,
): ResultFlag | null {
  if (!range) return null;
  if (type === 'NUMERIC') {
    const n = input.numeric;
    if (!n) return null;
    const hasBounds = range.low !== null || range.high !== null || range.criticalLow !== null || range.criticalHigh !== null;
    if (!hasBounds) return null;
    if (n.qualifier === '<') {
      // Valeur réelle < x : anormale basse seulement si x lui-même est sous le seuil.
      if (range.criticalLow !== null && n.value <= range.criticalLow) return 'CRITICAL_LOW';
      if (range.low !== null && n.value <= range.low) return 'LOW';
      return 'NORMAL';
    }
    if (n.qualifier === '>') {
      if (range.criticalHigh !== null && n.value >= range.criticalHigh) return 'CRITICAL_HIGH';
      if (range.high !== null && n.value >= range.high) return 'HIGH';
      return 'NORMAL';
    }
    return interpretNumeric(n.value, range);
  }
  const text = input.text?.trim();
  if (!text || !range.normalText) return null;
  return text.toLowerCase() === range.normalText.toLowerCase() ? 'NORMAL' : 'ABNORMAL';
}

/** Mise en forme d'une valeur numérique selon les décimales du paramètre. */
export function formatResultValue(value: number | null, qualifier: Qualifier | null, decimals: number | null): string {
  if (value === null) return '';
  const formatted =
    decimals === null
      ? String(value).replace('.', ',')
      : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return `${qualifier ?? ''}${formatted}`;
}
