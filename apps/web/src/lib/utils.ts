import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFormatter.format(new Date(iso)) : '—';
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFormatter.format(new Date(iso)) : '—';
}

/** Message lisible pour n'importe quelle erreur (avec l'identifiant de requête pour le support). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId && error.status >= 500 ? `${error.message} (réf. ${error.requestId})` : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Une erreur inattendue est survenue.';
}

/**
 * Reporte les erreurs de validation renvoyées par l'API sur les champs du formulaire.
 * Renvoie true si au moins une erreur a pu être rattachée à un champ.
 */
export function applyApiFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly string[]): boolean {
  if (!(error instanceof ApiError)) return false;
  let applied = false;
  for (const issue of error.fieldErrors) {
    const field = issue.path.split('.')[0];
    if (fields.includes(field)) {
      setError(field as Path<T>, { type: 'server', message: issue.message });
      applied = true;
    }
  }
  return applied;
}

/** Génère un mot de passe temporaire conforme à la politique (majuscule, minuscule, chiffre, spécial). */
export function generateTemporaryPassword(length = 14): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '#@$%&*!?-_'];
  const all = sets.join('');
  const random = (max: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  };
  const chars = sets.map((s) => s[random(s.length)]);
  while (chars.length < length) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Montant (chaîne décimale renvoyée par l'API) formaté dans la devise du laboratoire. */
export function formatMoney(amount: string | number, currency = 'CDF'): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString('fr-FR')} ${currency}`;
  }
}

/** Délai de rendu : « 4 h », « 1 j », « 1 j 6 h », « 7 j ». */
export function formatTurnaround(hours: number): string {
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days} j` : `${days} j ${rest} h`;
}

/**
 * Convertit les erreurs Zod (client) en messages par champ.
 * `rename` permet de rattacher un chemin du schéma à un autre champ du formulaire.
 */
export function zodFieldErrors(
  issues: { path: (string | number)[]; message: string }[],
  rename: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    const field = rename[key] ?? key;
    out[field] ??= issue.message;
  }
  return out;
}
