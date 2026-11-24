import { parseNumericInput, type ResultType } from '@lims/shared';

/** Statuts de résultat d'automate signifiant « pas de valeur exploitable » (ASTM R-9 / HL7 OBX-11). */
const NOT_PERFORMED_STATUSES = new Set(['X', 'D', 'W', 'I']);

export type NormalizedValue = { ok: true; value: string } | { ok: false; notPerformed: boolean; reason: string };

/**
 * Valeur brute de l'automate → saisie acceptable par le moteur de résultats :
 * 1. table de correspondance (insensible à la casse) : « Target Not Detected » → « <40 » ;
 * 2. notation scientifique : « 1.23E2 » → « 123 » (qualificatif < > conservé) ;
 * 3. facteur de conversion d'unité, appliqué aux valeurs numériques ;
 * 4. pour un paramètre qualitatif, la valeur doit correspondre à un choix du paramètre.
 */
export function normalizeInstrumentValue(
  raw: string,
  resultStatus: string | null,
  param: { resultType: ResultType; choices: string[]; decimals: number | null },
  mapping: { factor: number; valueMap: Record<string, string> },
): NormalizedValue {
  if (resultStatus && NOT_PERFORMED_STATUSES.has(resultStatus)) {
    return { ok: false, notPerformed: true, reason: `Analyse non réalisée par l’automate (statut ${resultStatus}).` };
  }
  let v = raw.trim();
  const mapped = Object.entries(mapping.valueMap).find(([k]) => k.toLowerCase() === v.toLowerCase());
  if (mapped) v = mapped[1].trim();
  if (v === '') return { ok: false, notPerformed: true, reason: 'Valeur vide transmise par l’automate.' };

  if (param.resultType === 'NUMERIC') {
    const sci = v.replace(',', '.').match(/^([<>]?)\s*(\d+(?:\.\d+)?)[eE]([+-]?\d+)$/);
    if (sci) v = `${sci[1]}${Number(`${sci[2]}e${sci[3]}`)}`;
    const parsed = parseNumericInput(v);
    if (!parsed) return { ok: false, notPerformed: false, reason: `Valeur « ${raw} » non numérique (ajoutez une correspondance de valeur si besoin).` };
    let n = parsed.value * mapping.factor;
    // Évite les artefacts binaires (0.1 × 3 = 0.30000000000000004) sans tronquer au-delà de la précision stockée.
    n = Math.round(n * 1e4) / 1e4;
    return { ok: true, value: `${parsed.qualifier ?? ''}${String(n)}` };
  }
  if (param.resultType === 'CHOICE') {
    const choice = param.choices.find((c) => c.toLowerCase() === v.toLowerCase());
    if (!choice) return { ok: false, notPerformed: false, reason: `Valeur « ${raw} » hors des choix du paramètre (${param.choices.join(', ')}).` };
    return { ok: true, value: choice };
  }
  return { ok: true, value: v.slice(0, 500) };
}
