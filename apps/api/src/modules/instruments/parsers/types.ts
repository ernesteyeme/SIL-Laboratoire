/** Résultat extrait d'un message d'automate, avant tout appariement. */
export interface ParsedResult {
  /** Identifiant d'échantillon envoyé par l'automate (n° d'échantillon du code-barres, ou identifiant de contrôle). */
  specimenId: string;
  /** Code du test chez l'automate */
  testCode: string;
  /** Valeur brute telle que transmise */
  value: string;
  unit: string | null;
  /** Indicateurs d'anomalie de l'automate (L, H, LL, HH, A, N…) */
  flags: string | null;
  /** Statut du résultat côté automate : F (final), C (correction), P (préliminaire), X (non réalisé)… */
  resultStatus: string | null;
  measuredAt: Date | null;
}

export interface ParsedMessage {
  results: ParsedResult[];
  warnings: string[];
  /** Identifiant de contrôle du message (HL7 MSH-10) pour l'accusé de réception */
  controlId: string | null;
  /** Champs MSH utiles à la construction de l'ACK HL7 */
  hl7Header?: { fieldSep: string; encoding: string; sendingApp: string; sendingFacility: string; receivingApp: string; receivingFacility: string; version: string };
}

export class MessageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageParseError';
  }
}

/** Horodatage AAAAMMJJ[HHMM[SS]] → composantes (null si absent ou mal formé). */
export function parseCompactTimestamp(value: string | undefined | null): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  const v = (value ?? '').trim().replace(/[^\d]/g, '');
  if (v.length < 8) return null;
  return {
    year: Number(v.slice(0, 4)),
    month: Number(v.slice(4, 6)),
    day: Number(v.slice(6, 8)),
    hour: v.length >= 10 ? Number(v.slice(8, 10)) : 0,
    minute: v.length >= 12 ? Number(v.slice(10, 12)) : 0,
    second: v.length >= 14 ? Number(v.slice(12, 14)) : 0,
  };
}
