/**
 * Contrôle qualité interne : score z et règles de Westgard (multirègle).
 * Fonctions pures partagées : le serveur fait foi, le frontend s'en sert pour l'aperçu pendant la saisie.
 */
import { WESTGARD_WARNING_RULES, type QcStatus, type WestgardRule } from './enums';

/** Score z = (valeur − moyenne cible) / écart-type cible, arrondi au millième. */
export function zScore(value: number, mean: number, sd: number): number {
  if (!(sd > 0)) throw new Error('Écart-type cible invalide.');
  return Math.round(((value - mean) / sd) * 1000) / 1000;
}

export interface QcPoint {
  /** Cible (matériau × paramètre) à laquelle appartient le contrôle */
  targetId: string;
  z: number;
}

export interface QcEvaluation {
  status: QcStatus;
  /** Règles violées par la série (toutes cibles confondues) */
  rules: WestgardRule[];
  /** Règles violées attribuées à chaque contrôle */
  byTarget: Map<string, { status: QcStatus; rules: WestgardRule[] }>;
}

const side = (z: number) => (z > 0 ? 1 : z < 0 ? -1 : 0);

/**
 * Évalue une série de contrôles d'un même paramètre (un point par niveau).
 *
 * @param run      contrôles de la série en cours
 * @param history  pour chaque cible, scores z des séries antérieures retenues, du plus récent au plus ancien
 *                 (séries exclues et séries rejetées non comprises)
 *
 * Règles :
 * - 1-2s (avertissement) : |z| > 2
 * - 1-3s : |z| > 3
 * - 2-2s : même cible, ce point et le précédent > 2 ET du même côté ; ou deux niveaux de la série > 2 ET du même côté
 * - R-4s : dans la série, un niveau > +2 ET et un autre < −2 ET
 * - 4-1s : même cible, ce point et les 3 précédents > 1 ET du même côté
 * - 10x : même cible, ce point et les 9 précédents du même côté de la moyenne
 */
export function evaluateWestgard(run: QcPoint[], history: Map<string, number[]>): QcEvaluation {
  const byTarget = new Map<string, Set<WestgardRule>>(run.map((p) => [p.targetId, new Set<WestgardRule>()]));
  const add = (targetId: string, rule: WestgardRule) => byTarget.get(targetId)!.add(rule);

  for (const p of run) {
    const prev = history.get(p.targetId) ?? [];
    const abs = Math.abs(p.z);
    if (abs > 3) add(p.targetId, '1-3s');
    else if (abs > 2) add(p.targetId, '1-2s');

    if (abs > 2 && prev.length >= 1 && Math.abs(prev[0]) > 2 && side(prev[0]) === side(p.z)) add(p.targetId, '2-2s');

    const last4 = [p.z, ...prev.slice(0, 3)];
    if (last4.length === 4 && last4.every((z) => Math.abs(z) > 1) && last4.every((z) => side(z) === side(p.z))) add(p.targetId, '4-1s');

    const last10 = [p.z, ...prev.slice(0, 9)];
    if (last10.length === 10 && side(p.z) !== 0 && last10.every((z) => side(z) === side(p.z))) add(p.targetId, '10x');
  }

  // Règles inter-niveaux dans la série
  for (const s of [1, -1]) {
    const beyond = run.filter((p) => Math.abs(p.z) > 2 && side(p.z) === s);
    if (beyond.length >= 2) beyond.forEach((p) => add(p.targetId, '2-2s'));
  }
  const high = run.filter((p) => p.z > 2);
  const low = run.filter((p) => p.z < -2);
  if (high.length > 0 && low.length > 0) [...high, ...low].forEach((p) => add(p.targetId, 'R-4s'));

  const statusOf = (rules: Set<WestgardRule>): QcStatus =>
    [...rules].some((r) => !WESTGARD_WARNING_RULES.includes(r)) ? 'REJECTED' : rules.size > 0 ? 'WARNING' : 'ACCEPTED';

  const result = new Map<string, { status: QcStatus; rules: WestgardRule[] }>();
  const all = new Set<WestgardRule>();
  for (const [targetId, rules] of byTarget) {
    // 1-2s n'a plus d'intérêt quand une règle de rejet s'applique au même point
    if (statusOf(rules) === 'REJECTED') rules.delete('1-2s');
    result.set(targetId, { status: statusOf(rules), rules: sortRules([...rules]) });
    rules.forEach((r) => all.add(r));
  }
  const rejected = [...result.values()].some((r) => r.status === 'REJECTED');
  if (rejected) all.delete('1-2s');
  const status: QcStatus = rejected ? 'REJECTED' : all.size > 0 ? 'WARNING' : 'ACCEPTED';
  return { status, rules: sortRules([...all]), byTarget: result };
}

const ORDER: WestgardRule[] = ['1-3s', '2-2s', 'R-4s', '4-1s', '10x', '1-2s'];
function sortRules(rules: WestgardRule[]): WestgardRule[] {
  return [...new Set(rules)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

/** Statistiques descriptives d'une série de valeurs de contrôle (Levey-Jennings). */
export function qcStatistics(values: number[]): { n: number; mean: number | null; sd: number | null; cv: number | null } {
  const n = values.length;
  if (n === 0) return { n, mean: null, sd: null, cv: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, sd: null, cv: null };
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, cv: mean !== 0 ? (sd / Math.abs(mean)) * 100 : null };
}
