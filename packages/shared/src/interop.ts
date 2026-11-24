import type { Dhis2Measure, RangeSex } from './enums';

/** Identifiant DHIS2 (UID) : 11 caractères alphanumériques, commençant par une lettre. */
export const DHIS2_UID_REGEX = /^[A-Za-z][A-Za-z0-9]{10}$/;
/** Période mensuelle DHIS2 : AAAAMM. */
export const DHIS2_MONTH_PERIOD_REGEX = /^(19|20)\d{2}(0[1-9]|1[0-2])$/;

/** Premier et dernier jour (AAAA-MM-JJ) d'une période mensuelle DHIS2 « AAAAMM ». */
export function monthPeriodBounds(period: string): { from: string; to: string } {
  if (!DHIS2_MONTH_PERIOD_REGEX.test(period)) throw new Error(`Période mensuelle invalide : ${period}`);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/** Période mensuelle précédant celle de la date « AAAA-MM-JJ » (période habituellement rapportée). */
export function previousMonthPeriod(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month === 1 ? `${year - 1}12` : `${year}${String(month - 1).padStart(2, '0')}`;
}

export type ThresholdClass = 'BELOW' | 'AT_OR_ABOVE' | 'UNKNOWN';

/**
 * Position d'une valeur quantitative par rapport à un seuil, en tenant compte de la limite de détection.
 * « < 40 » avec un seuil de 1000 est sous le seuil ; « < 2000 » avec un seuil de 1000 est indéterminé
 * (la valeur réelle peut être de part et d'autre) ; « > 10 000 000 » est au-dessus de tout seuil inférieur.
 */
export function classifyAgainstThreshold(value: number, qualifier: string | null, threshold: number): ThresholdClass {
  if (qualifier === '<') return value <= threshold ? 'BELOW' : 'UNKNOWN';
  if (qualifier === '>') return value >= threshold ? 'AT_OR_ABOVE' : 'UNKNOWN';
  return value < threshold ? 'BELOW' : 'AT_OR_ABOVE';
}

/** Âge révolu en années à la date de référence (dates « AAAA-MM-JJ »). */
export function ageInYearsAt(birthDate: string, refDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ry, rm, rd] = refDate.split('-').map(Number) as [number, number, number];
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return Math.max(0, age);
}

/** Âge révolu en mois à la date de référence. */
export function ageInMonthsAt(birthDate: string, refDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ry, rm, rd] = refDate.split('-').map(Number) as [number, number, number];
  let months = (ry - by) * 12 + (rm - bm);
  if (rd < bd) months -= 1;
  return Math.max(0, months);
}

export interface Dhis2MappingRule {
  id: string;
  parameterId: string;
  measure: Dhis2Measure;
  threshold: number | null;
  textMatch: string | null;
  sex: RangeSex;
  /** Âge minimal inclus (années). */
  ageMinYears: number | null;
  /** Âge maximal exclu (années) : « enfants < 15 ans » → ageMaxYears = 15. */
  ageMaxYears: number | null;
}

export interface Dhis2ResultRow {
  parameterId: string;
  numericValue: number | null;
  qualifier: string | null;
  textValue: string | null;
  sex: 'MALE' | 'FEMALE' | 'UNKNOWN';
  birthDate: string | null;
  /** Date (locale) de la demande, référence du calcul de l'âge. */
  orderDate: string;
}

export interface Dhis2RuleCount {
  count: number;
  /** Résultats écartés faute de date de naissance alors que la règle filtre sur l'âge. */
  excludedNoAge: number;
  /** Résultats écartés car leur position par rapport au seuil est indéterminée (« < 2000 » pour un seuil de 1000…). */
  excludedAmbiguous: number;
}

const normalizeText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Applique une règle de correspondance à un résultat validé. */
export function evaluateDhis2Rule(rule: Dhis2MappingRule, row: Dhis2ResultRow): 'COUNT' | 'SKIP' | 'NO_AGE' | 'AMBIGUOUS' {
  if (row.parameterId !== rule.parameterId) return 'SKIP';
  if (rule.sex !== 'ANY' && row.sex !== rule.sex) return 'SKIP';
  if (rule.ageMinYears !== null || rule.ageMaxYears !== null) {
    if (!row.birthDate) return 'NO_AGE';
    const age = ageInYearsAt(row.birthDate, row.orderDate);
    if (rule.ageMinYears !== null && age < rule.ageMinYears) return 'SKIP';
    if (rule.ageMaxYears !== null && age >= rule.ageMaxYears) return 'SKIP';
  }
  switch (rule.measure) {
    case 'VALIDATED_COUNT':
      return row.numericValue !== null || (row.textValue !== null && row.textValue.trim() !== '') ? 'COUNT' : 'SKIP';
    case 'TEXT_EQUALS':
      return row.textValue !== null && rule.textMatch !== null && normalizeText(row.textValue) === normalizeText(rule.textMatch) ? 'COUNT' : 'SKIP';
    case 'NUMERIC_BELOW':
    case 'NUMERIC_AT_OR_ABOVE': {
      if (row.numericValue === null || rule.threshold === null) return 'SKIP';
      const cls = classifyAgainstThreshold(row.numericValue, row.qualifier, rule.threshold);
      if (cls === 'UNKNOWN') return 'AMBIGUOUS';
      return (cls === 'BELOW') === (rule.measure === 'NUMERIC_BELOW') ? 'COUNT' : 'SKIP';
    }
  }
}

/** Compte, pour chaque règle, les résultats validés de la période qui la satisfont. */
export function aggregateDhis2(rules: Dhis2MappingRule[], rows: Dhis2ResultRow[]): Map<string, Dhis2RuleCount> {
  const out = new Map<string, Dhis2RuleCount>();
  for (const rule of rules) {
    const acc: Dhis2RuleCount = { count: 0, excludedNoAge: 0, excludedAmbiguous: 0 };
    for (const row of rows) {
      const r = evaluateDhis2Rule(rule, row);
      if (r === 'COUNT') acc.count += 1;
      else if (r === 'NO_AGE') acc.excludedNoAge += 1;
      else if (r === 'AMBIGUOUS') acc.excludedAmbiguous += 1;
    }
    out.set(rule.id, acc);
  }
  return out;
}

export interface Dhis2DataValue {
  dataElement: string;
  categoryOptionCombo?: string;
  value: string;
  comment?: string;
}

export interface Dhis2DataValueSet {
  dataSet?: string;
  period: string;
  orgUnit: string;
  attributeOptionCombo?: string;
  dataValues: Dhis2DataValue[];
}

const csvCell = (v: string | undefined) => {
  const s = v ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Export CSV au format d'import DHIS2 (Import/Export → Data import, format CSV). */
export function dataValueSetToCsv(set: Dhis2DataValueSet): string {
  const header = 'dataelement,period,orgunit,categoryoptioncombo,attributeoptioncombo,value,storedby,lastupdated,comment,followup';
  const lines = set.dataValues.map((dv) =>
    [dv.dataElement, set.period, set.orgUnit, dv.categoryOptionCombo, set.attributeOptionCombo, dv.value, '', '', dv.comment, 'false'].map(csvCell).join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date au format attendu par l'API VLSM/InteLIS : « 01-Sep-2021 10:36 » (heure locale du laboratoire). */
export function formatVlsmDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('day')}-${MONTHS_EN[Number(get('month')) - 1]}-${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Date seule au format VLSM : « 12-Mar-1994 » (date « AAAA-MM-JJ »). */
export function formatVlsmDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${MONTHS_EN[Number(m) - 1]}-${y}`;
}

const NOT_DETECTED = /^(non\s*d[ée]tect[ée]e?|ind[ée]tectable|tnd|target\s*not\s*detected|not\s*detected)$/i;

/**
 * Résultat de charge virale tel que transmis à VLSM : valeur numérique (avec « < » ou « > »
 * pour une limite de détection) ou texte ; « Non détecté » est traduit en « Target Not Detected ».
 */
export function formatVlsmViralLoad(numericValue: number | null, qualifier: string | null, textValue: string | null): string | null {
  if (numericValue !== null) {
    const n = Number.isInteger(numericValue) ? String(numericValue) : String(Number(numericValue.toFixed(4)));
    return `${qualifier === '<' || qualifier === '>' ? qualifier : ''}${n}`;
  }
  const t = textValue?.trim();
  if (!t) return null;
  return NOT_DETECTED.test(t) ? 'Target Not Detected' : t;
}
