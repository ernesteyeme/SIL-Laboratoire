import { parseIsoDate, type Sex } from '@lims/shared';

/** Seuil à partir duquel un patient existant est signalé comme doublon potentiel. */
export const DUPLICATE_THRESHOLD = 0.5;

export interface DuplicateSignals {
  nameScore: number;
  phoneMatch: boolean;
  externalMatch: boolean;
  candidate: { sex: Sex; birthDate: string | null; birthDateEstimated: boolean };
  input: { sex?: Sex; birthDate?: string | null };
}

/**
 * Score de similarité (0–1) et motifs lisibles.
 * Le nom pèse 60 %, la date de naissance la confirme ou l'infirme,
 * le téléphone et l'identifiant externe sont des indices forts.
 */
export function scoreDuplicate(s: DuplicateSignals): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = s.nameScore * 0.6;

  if (s.nameScore >= 0.95) reasons.push('Nom identique');
  else if (s.nameScore >= 0.6) reasons.push('Nom très proche');
  else if (s.nameScore >= 0.35) reasons.push('Nom ressemblant');

  if (s.input.birthDate && s.candidate.birthDate) {
    const a = parseIsoDate(s.input.birthDate);
    const b = parseIsoDate(s.candidate.birthDate);
    const yearGap = Math.abs(a.getUTCFullYear() - b.getUTCFullYear());
    if (s.input.birthDate === s.candidate.birthDate) {
      score += 0.3;
      reasons.push('Même date de naissance');
    } else if (yearGap === 0) {
      score += 0.15;
      reasons.push('Même année de naissance');
    } else if (yearGap <= 2 && s.candidate.birthDateEstimated) {
      score += 0.05;
      reasons.push('Âge proche (date estimée)');
    } else {
      score -= 0.25;
    }
  }

  if (s.input.sex && s.input.sex !== 'UNKNOWN' && s.candidate.sex !== 'UNKNOWN' && s.input.sex !== s.candidate.sex) {
    score -= 0.3;
  }

  if (s.phoneMatch) {
    score += 0.35;
    reasons.push('Même numéro de téléphone');
  }
  if (s.externalMatch) {
    score += 0.6;
    reasons.push('Même identifiant externe');
  }

  return { score: Math.round(Math.min(1, Math.max(0, score)) * 100) / 100, reasons };
}
