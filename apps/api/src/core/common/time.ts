import { parseIsoDate } from '@lims/shared';

/** Décalage (ms) du fuseau `timeZone` par rapport à UTC à l'instant `date`. */
function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instant UTC correspondant à minuit (heure locale du laboratoire) du jour « AAAA-MM-JJ ». */
export function zonedStartOfDay(isoDate: string, timeZone: string): Date {
  const guess = parseIsoDate(isoDate).getTime();
  let t = guess - offsetMs(new Date(guess), timeZone);
  const corrected = guess - offsetMs(new Date(t), timeZone);
  if (corrected !== t) t = corrected;
  return new Date(t);
}

/** Bornes [début, fin[ d'une période de jours locaux, fin incluse dans la période saisie. */
export function zonedPeriod(from: string, to: string, timeZone: string): { start: Date; end: Date } {
  const endDay = new Date(parseIsoDate(to).getTime() + 86_400_000).toISOString().slice(0, 10);
  return { start: zonedStartOfDay(from, timeZone), end: zonedStartOfDay(endDay, timeZone) };
}

/** « AAAA-MM-JJ » décalé de `days` jours. */
export function addDaysIso(isoDate: string, days: number): string {
  return new Date(parseIsoDate(isoDate).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Date et heure « murales » (sans fuseau, ex. horodatage d'un automate AAAAMMJJHHMMSS)
 * interprétées dans le fuseau du laboratoire. Renvoie null si la date est invalide.
 */
export function zonedDateTime(
  p: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date | null {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  const check = new Date(guess);
  if (
    Number.isNaN(guess) ||
    check.getUTCFullYear() !== p.year ||
    check.getUTCMonth() !== p.month - 1 ||
    check.getUTCDate() !== p.day ||
    (p.hour ?? 0) > 23 ||
    (p.minute ?? 0) > 59 ||
    (p.second ?? 0) > 59
  ) {
    return null;
  }
  let t = guess - offsetMs(new Date(guess), timeZone);
  const corrected = guess - offsetMs(new Date(t), timeZone);
  if (corrected !== t) t = corrected;
  return new Date(t);
}
