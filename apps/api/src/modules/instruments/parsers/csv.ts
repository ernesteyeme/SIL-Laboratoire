import type { CsvConfig } from '@lims/shared';
import { MessageParseError, type ParsedMessage, type ParsedResult } from './types';

/** Découpe une ligne CSV en respectant les guillemets ("a;b" reste un champ, "" = guillemet). */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** « 2026-11-22 08:15:00 », « 2026-11-22T08:15 », « 22/11/2026 08:15[:00] » → composantes. */
function parseCsvDate(v: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3], hour: +(m[4] ?? 0), minute: +(m[5] ?? 0), second: +(m[6] ?? 0) };
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return { year: +m[3], month: +m[2], day: +m[1], hour: +(m[4] ?? 0), minute: +(m[5] ?? 0), second: +(m[6] ?? 0) };
  return null;
}

export function parseCsv(raw: string, config: CsvConfig, toDate: (p: ReturnType<typeof parseCsvDate>) => Date | null): ParsedMessage {
  const lines = raw.replace(/^﻿/, '').split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new MessageParseError('Fichier CSV vide.');
  const warnings: string[] = [];
  let header: string[] = [];
  let start = 0;
  if (config.hasHeader) {
    header = splitCsvLine(lines[0], config.delimiter).map((h) => h.toLowerCase());
    start = 1;
  }
  const indexOf = (col: string | null | undefined, required: boolean): number | null => {
    if (!col) return null;
    if (!config.hasHeader) return Number(col) - 1;
    const i = header.indexOf(col.trim().toLowerCase());
    if (i === -1 && required) throw new MessageParseError(`Colonne « ${col} » absente de l’en-tête du fichier.`);
    return i === -1 ? null : i;
  };
  const iSpecimen = indexOf(config.specimenColumn, true)!;
  const iTest = indexOf(config.testColumn, true)!;
  const iValue = indexOf(config.valueColumn, true)!;
  const iUnit = indexOf(config.unitColumn, false);
  const iFlags = indexOf(config.flagsColumn, false);
  const iDate = indexOf(config.measuredAtColumn, false);

  const results: ParsedResult[] = [];
  for (let n = start; n < lines.length; n++) {
    const cells = splitCsvLine(lines[n], config.delimiter);
    const specimenId = cells[iSpecimen] ?? '';
    const testCode = cells[iTest] ?? '';
    if (!specimenId || !testCode) {
      warnings.push(`Ligne ${n + 1} : échantillon ou code test manquant, ignorée.`);
      continue;
    }
    const rawDate = iDate !== null ? (cells[iDate] ?? '') : '';
    const measuredAt = rawDate ? toDate(parseCsvDate(rawDate)) : null;
    if (rawDate && !measuredAt) warnings.push(`Ligne ${n + 1} : date « ${rawDate} » illisible.`);
    results.push({
      specimenId,
      testCode,
      value: cells[iValue] ?? '',
      unit: iUnit !== null ? cells[iUnit] || null : null,
      flags: iFlags !== null ? cells[iFlags] || null : null,
      resultStatus: null,
      measuredAt,
    });
  }
  return { results, warnings, controlId: null };
}
