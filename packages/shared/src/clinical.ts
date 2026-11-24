/**
 * Fonctions métier pures partagées entre l'API et le frontend :
 * calcul de l'âge, normalisation des noms et téléphones, choix et interprétation des valeurs de référence.
 */
import type { RangeSex, Sex } from './enums';

// ---------------------------------------------------------------------------
// Âge
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Convertit « AAAA-MM-JJ » en date UTC minuit (sans décalage de fuseau). */
export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseIsoDate(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface Age {
  totalDays: number;
  years: number;
  months: number;
  days: number;
  /** Libellé clinique : « 34 ans », « 8 mois », « 12 jours ». */
  label: string;
}

/** Âge à une date donnée (par défaut aujourd'hui), à partir d'une date de naissance « AAAA-MM-JJ ». */
export function computeAge(birthDate: string, at: string = todayIso()): Age {
  const birth = parseIsoDate(birthDate);
  const ref = parseIsoDate(at);
  const totalDays = Math.max(0, Math.floor((ref.getTime() - birth.getTime()) / DAY_MS));

  let years = ref.getUTCFullYear() - birth.getUTCFullYear();
  let months = ref.getUTCMonth() - birth.getUTCMonth();
  let days = ref.getUTCDate() - birth.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) {
    years = 0;
    months = 0;
    days = 0;
  }

  let label: string;
  if (years >= 2) label = `${years} ans`;
  else if (years >= 1 || months >= 1) label = `${years * 12 + months} mois`;
  else label = `${totalDays} jour${totalDays > 1 ? 's' : ''}`;

  return { totalDays, years, months, days, label };
}

/** Date de naissance estimée à partir d'un âge en années (même jour/mois qu'aujourd'hui). */
export function birthDateFromAge(years: number, at: string = todayIso()): string {
  const ref = parseIsoDate(at);
  const d = new Date(Date.UTC(ref.getUTCFullYear() - years, ref.getUTCMonth(), ref.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Âges des valeurs de référence (stockés en jours, saisis en jours / mois / années)
// ---------------------------------------------------------------------------

export const AGE_UNITS = ['DAYS', 'MONTHS', 'YEARS'] as const;
export type AgeUnit = (typeof AGE_UNITS)[number];
export const AGE_UNIT_LABELS: Record<AgeUnit, string> = { DAYS: 'jours', MONTHS: 'mois', YEARS: 'ans' };

const DAYS_PER: Record<AgeUnit, number> = { DAYS: 1, MONTHS: 30.4375, YEARS: 365.25 };

export function ageToDays(value: number, unit: AgeUnit): number {
  return Math.round(value * DAYS_PER[unit]);
}

/** Exprime un nombre de jours dans l'unité la plus lisible (inverse de ageToDays si possible). */
export function daysToAge(totalDays: number): { value: number; unit: AgeUnit } {
  if (totalDays === 0) return { value: 0, unit: 'YEARS' };
  for (const unit of ['YEARS', 'MONTHS'] as const) {
    const value = totalDays / DAYS_PER[unit];
    const rounded = Math.round(value);
    if (rounded >= 1 && ageToDays(rounded, unit) === totalDays) return { value: rounded, unit };
  }
  return { value: totalDays, unit: 'DAYS' };
}

export function formatAgeBound(totalDays: number): string {
  const { value, unit } = daysToAge(totalDays);
  return `${value} ${AGE_UNIT_LABELS[unit]}`;
}

/** Libellé de la tranche d'âge [min, max[. */
export function formatAgeInterval(minDays: number, maxDays: number | null): string {
  if (minDays === 0 && maxDays === null) return 'Tous âges';
  if (maxDays === null) return `≥ ${formatAgeBound(minDays)}`;
  if (minDays === 0) return `< ${formatAgeBound(maxDays)}`;
  return `${formatAgeBound(minDays)} – < ${formatAgeBound(maxDays)}`;
}

// ---------------------------------------------------------------------------
// Normalisation pour la recherche et la détection de doublons
// ---------------------------------------------------------------------------

/** Minuscules, sans accents ni ponctuation, espaces simples. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Clé de recherche d'un nom : jetons normalisés triés alphabétiquement,
 * pour que « KABILA Mbuyi Marie » et « Marie MBUYI Kabila » soient identiques.
 */
export function nameSearchKey(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .flatMap((p) => normalizeText(p).split(' '))
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Chiffres significatifs d'un téléphone : les 9 derniers chiffres.
 * « +243 81 234 5678 », « 00243812345678 » et « 0812345678 » donnent la même clé.
 */
export function phoneKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return digits.slice(-9);
}

// ---------------------------------------------------------------------------
// Valeurs de référence
// ---------------------------------------------------------------------------

export interface RangeLike {
  sex: RangeSex;
  ageMinDays: number;
  ageMaxDays: number | null;
}

/** Deux tranches d'âge [min, max[ se chevauchent-elles ? */
export function ageIntervalsOverlap(a: RangeLike, b: RangeLike): boolean {
  const aMax = a.ageMaxDays ?? Number.POSITIVE_INFINITY;
  const bMax = b.ageMaxDays ?? Number.POSITIVE_INFINITY;
  return a.ageMinDays < bMax && b.ageMinDays < aMax;
}

/**
 * Conflit de valeurs de référence : même sexe et tranches d'âge qui se chevauchent.
 * Une plage « Tous » peut coexister avec une plage spécifique (la spécifique est prioritaire).
 */
export function rangesConflict(a: RangeLike, b: RangeLike): boolean {
  return a.sex === b.sex && ageIntervalsOverlap(a, b);
}

/**
 * Sélectionne la valeur de référence applicable à un patient :
 * tranche d'âge contenant l'âge, sexe spécifique prioritaire sur « Tous », puis tranche la plus étroite.
 * Si le sexe est inconnu, seules les plages « Tous » s'appliquent.
 */
export function resolveReferenceRange<T extends RangeLike>(ranges: T[], sex: Sex, ageDays: number): T | null {
  const candidates = ranges.filter(
    (r) =>
      (r.sex === 'ANY' || (sex !== 'UNKNOWN' && r.sex === sex)) &&
      ageDays >= r.ageMinDays &&
      (r.ageMaxDays === null || ageDays < r.ageMaxDays),
  );
  if (candidates.length === 0) return null;
  const width = (r: T) => (r.ageMaxDays ?? 100_000) - r.ageMinDays;
  return [...candidates].sort((a, b) => {
    const sexScore = (r: T) => (r.sex === 'ANY' ? 1 : 0);
    return sexScore(a) - sexScore(b) || width(a) - width(b);
  })[0];
}

export type InterpretationFlag = 'CRITICAL_LOW' | 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL_HIGH';

export interface NumericBounds {
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
}

/** Interprétation d'un résultat numérique par rapport à sa valeur de référence. */
export function interpretNumeric(value: number, bounds: NumericBounds): InterpretationFlag {
  if (bounds.criticalLow !== null && value < bounds.criticalLow) return 'CRITICAL_LOW';
  if (bounds.criticalHigh !== null && value > bounds.criticalHigh) return 'CRITICAL_HIGH';
  if (bounds.low !== null && value < bounds.low) return 'LOW';
  if (bounds.high !== null && value > bounds.high) return 'HIGH';
  return 'NORMAL';
}

/** Affichage d'une plage numérique : « 12 – 16 », « < 5 », « > 150 ». */
export function formatNumericRange(low: number | null, high: number | null): string {
  const f = (v: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(v);
  if (low !== null && high !== null) return `${f(low)} – ${f(high)}`;
  if (low !== null) return `≥ ${f(low)}`;
  if (high !== null) return `≤ ${f(high)}`;
  return '—';
}
