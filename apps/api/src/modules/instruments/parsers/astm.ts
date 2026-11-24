import { MessageParseError, parseCompactTimestamp, type ParsedMessage, type ParsedResult } from './types';

const STX = '\x02';
const ETX = '\x03';
const ETB = '\x17';
const CR = '\r';

/** Somme de contrôle ASTM E1381 : somme des octets du n° de trame jusqu'à ETX/ETB inclus, modulo 256, en 2 hexadécimaux. */
export function astmChecksum(body: string): string {
  let sum = 0;
  for (const ch of Buffer.from(body, 'latin1')) sum = (sum + ch) % 256;
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Retire la couche de transport ASTM E1381 si elle est présente (trames STX n … ETX|ETB CS CR LF).
 * Les trames ETB sont des fragments d'un même enregistrement et sont recollées.
 * Une somme de contrôle fausse est signalée (le connecteur aurait dû la refuser).
 */
export function unframeAstm(raw: string): { text: string; warnings: string[] } {
  if (!raw.includes(STX)) return { text: raw, warnings: [] };
  const warnings: string[] = [];
  let text = '';
  const re = /\x02([0-7])([\s\S]*?)([\x03\x17])([0-9A-Fa-f]{2})?/g;
  let m: RegExpExecArray | null;
  let frames = 0;
  while ((m = re.exec(raw)) !== null) {
    frames++;
    const [, fn, content, end, cs] = m;
    const expected = astmChecksum(fn + content + end);
    if (cs && cs.toUpperCase() !== expected) warnings.push(`Trame ${frames} : somme de contrôle ${cs} au lieu de ${expected}.`);
    text += content;
    if (end === ETX && !content.endsWith(CR)) text += CR;
  }
  if (frames === 0) throw new MessageParseError('Trames ASTM illisibles (aucune trame STX … ETX complète).');
  return { text, warnings };
}

interface Delimiters {
  field: string;
  repeat: string;
  component: string;
  escape: string;
}

function unescape(value: string, d: Delimiters): string {
  if (!value.includes(d.escape)) return value;
  const e = d.escape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value
    .replace(new RegExp(`${e}F${e}`, 'g'), d.field)
    .replace(new RegExp(`${e}S${e}`, 'g'), d.component)
    .replace(new RegExp(`${e}R${e}`, 'g'), d.repeat)
    .replace(new RegExp(`${e}E${e}`, 'g'), d.escape);
}

/**
 * Message ASTM E1394 (LIS2-A2) → résultats.
 * Enregistrements lus : H (délimiteurs), O (n° d'échantillon), R (résultats). P, C, Q, M et L sont ignorés.
 *
 * - O-3 « Specimen ID » : identifiant d'échantillon (1re composante) ; à défaut O-4 « Instrument Specimen ID ».
 * - R-3 « Universal Test ID » ^^^code : 4e composante, sinon la première non vide.
 * - R-4 valeur, R-5 unité, R-7 indicateurs d'anomalie, R-9 statut, R-13 date de fin d'analyse.
 */
export function parseAstm(raw: string, toDate: (p: ReturnType<typeof parseCompactTimestamp>) => Date | null): ParsedMessage {
  const { text, warnings } = unframeAstm(raw);
  const records = text
    .split(/\r\n|\r|\n/)
    .map((r) => r.replace(/^[\x02\x04\x05]+/, '').replace(/[\x03\x17\x04].*$/, ''))
    .filter((r) => r.trim().length > 0);
  const header = records.find((r) => /^\d?H/.test(r));
  if (!header) throw new MessageParseError('Message ASTM sans en-tête (enregistrement H).');
  const h = header.replace(/^\d/, '');
  const d: Delimiters = { field: h[1], repeat: h[2], component: h[3], escape: h[4] };
  if (!d.field || !d.component || new Set([d.field, d.repeat, d.component, d.escape]).size < 4) {
    throw new MessageParseError('En-tête ASTM : délimiteurs invalides (attendu par exemple H|\\^&).');
  }

  const results: ParsedResult[] = [];
  let specimen: string | null = null;
  records.forEach((rec, idx) => {
    const r = rec.replace(/^\d/, '');
    const type = r[0];
    // Découper d'abord (champs puis composantes), décoder les échappements ensuite :
    // un séparateur échappé ne doit jamais redevenir un séparateur.
    const f = r.split(d.field);
    const comp = (fi: number, ci = 0) => unescape((f[fi] ?? '').split(d.component)[ci] ?? '', d).trim();
    const whole = (fi: number) => unescape(f[fi] ?? '', d).trim();
    if (type === 'O') {
      const primary = comp(2);
      const instrumentId = comp(3);
      specimen = primary || instrumentId || null;
      if (!specimen) warnings.push(`Enregistrement ${idx + 1} (O) sans identifiant d’échantillon.`);
    } else if (type === 'R') {
      if (!specimen) {
        warnings.push(`Enregistrement ${idx + 1} (R) sans commande O préalable : ignoré.`);
        return;
      }
      const testParts = (f[2] ?? '').split(d.component).map((x) => unescape(x, d).trim());
      const testCode = testParts[3] || testParts.find((x) => x.length > 0) || '';
      if (!testCode) {
        warnings.push(`Enregistrement ${idx + 1} (R) sans code test : ignoré.`);
        return;
      }
      const value = comp(3);
      results.push({
        specimenId: specimen,
        testCode,
        value,
        unit: comp(4) || null,
        flags: whole(6) || null,
        resultStatus: whole(8).toUpperCase() || null,
        measuredAt: toDate(parseCompactTimestamp(f[12])),
      });
    }
  });
  return { results, warnings, controlId: null };
}

/** Horodatage ASTM AAAAMMJJHHMMSS à l'heure locale du laboratoire (l'horloge des automates est réglée à l'heure locale). */
export function astmTimestamp(d: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

/**
 * Message de commandes ASTM E1394 (liste de travail / réponse à une requête hôte).
 * Les enregistrements ne portent pas de n° de trame : la numérotation relève de la couche E1381 (connecteur).
 */
export function buildAstmOrders(
  orders: { sampleNumber: string; priority: 'ROUTINE' | 'URGENT'; patient: { code: string; lastName: string; firstName: string | null; sex: string; birthDate: string | null }; collectedAt: Date | null; tests: string[] }[],
  now: Date,
  timeZone: string,
): string {
  const ts = (d: Date) => astmTimestamp(d, timeZone);
  const clean = (v: string) => v.replace(/[|\\^&\r\n]/g, ' ');
  const lines = [`H|\\^&|||SIL-LIMS^1.0|||||||P|LIS2-A2|${ts(now)}`];
  orders.forEach((o, i) => {
    const sex = o.patient.sex === 'MALE' ? 'M' : o.patient.sex === 'FEMALE' ? 'F' : 'U';
    lines.push(`P|${i + 1}||${clean(o.patient.code)}||${clean(o.patient.lastName)}^${clean(o.patient.firstName ?? '')}||${(o.patient.birthDate ?? '').replace(/-/g, '')}|${sex}`);
    const tests = o.tests.map((t) => `^^^${clean(t)}`).join('\\');
    lines.push(`O|1|${clean(o.sampleNumber)}||${tests}|${o.priority === 'URGENT' ? 'S' : 'R'}||${o.collectedAt ? ts(o.collectedAt) : ''}||||A||||||||||||||O`);
  });
  lines.push('L|1|N');
  return lines.join(CR) + CR;
}
