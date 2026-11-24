import { MessageParseError, parseCompactTimestamp, type ParsedMessage, type ParsedResult } from './types';

/** Retire l'enveloppe MLLP (VT … FS CR) si présente. */
export function stripMllp(raw: string): string {
  return raw.replace(/^\x0b/, '').replace(/\x1c\r?$/, '').replace(/\x1c/g, '');
}

/**
 * Message HL7 v2 ORU^R01 → résultats.
 * - Identifiant d'échantillon : SPM-2 (v2.5+), sinon OBR-3 (n° exécutant), sinon OBR-2 (n° demandeur).
 * - OBX-3 code (1re composante), OBX-5 valeur, OBX-6 unité, OBX-8 anomalies, OBX-11 statut, OBX-14 date d'observation.
 */
export function parseHl7(raw: string, toDate: (p: ReturnType<typeof parseCompactTimestamp>) => Date | null): ParsedMessage {
  const text = stripMllp(raw).trim();
  const segments = text.split(/\r\n|\r|\n/).filter((s) => s.trim().length > 0);
  const msh = segments[0];
  if (!msh?.startsWith('MSH')) throw new MessageParseError('Message HL7 sans segment MSH en tête.');
  const fs = msh[3];
  const enc = msh.slice(4, 8);
  const cs = enc[0] ?? '^';
  const mshFields = msh.split(fs);
  // MSH-1 est le séparateur lui-même : MSH-n se trouve à l'indice n-1.
  const msh9 = (mshFields[8] ?? '').split(cs);
  if (msh9[0] !== 'ORU') throw new MessageParseError(`Type de message HL7 ${mshFields[8] ?? '?'} non pris en charge (ORU^R01 attendu).`);

  const warnings: string[] = [];
  const results: ParsedResult[] = [];
  let obrSpecimen: string | null = null;
  let spmSpecimen: string | null = null;
  let obrTime: string | undefined;
  const pending: { idx: number; f: string[] }[] = [];

  const flush = () => {
    const specimen = spmSpecimen || obrSpecimen;
    for (const { idx, f } of pending) {
      if (!specimen) {
        warnings.push(`Segment ${idx + 1} (OBX) sans identifiant d’échantillon (OBR/SPM) : ignoré.`);
        continue;
      }
      const code = (f[3] ?? '').split(cs)[0].trim();
      if (!code) {
        warnings.push(`Segment ${idx + 1} (OBX) sans code d’observation : ignoré.`);
        continue;
      }
      results.push({
        specimenId: specimen,
        testCode: code,
        value: (f[5] ?? '').split(cs)[0].trim(),
        unit: (f[6] ?? '').split(cs)[0].trim() || null,
        flags: (f[8] ?? '').trim() || null,
        resultStatus: (f[11] ?? '').trim().toUpperCase() || null,
        measuredAt: toDate(parseCompactTimestamp(f[14] || obrTime)),
      });
    }
    pending.length = 0;
  };

  segments.forEach((seg, idx) => {
    const f = seg.split(fs);
    const type = f[0];
    if (type === 'OBR') {
      flush();
      obrSpecimen = (f[3] ?? '').split(cs)[0].trim() || (f[2] ?? '').split(cs)[0].trim() || null;
      spmSpecimen = null;
      obrTime = f[7];
    } else if (type === 'SPM') {
      spmSpecimen = (f[2] ?? '').split(cs)[0].trim() || null;
    } else if (type === 'OBX') {
      pending.push({ idx, f });
    }
  });
  flush();

  return {
    results,
    warnings,
    controlId: mshFields[9] ?? null,
    hl7Header: {
      fieldSep: fs,
      encoding: enc,
      sendingApp: mshFields[2] ?? '',
      sendingFacility: mshFields[3] ?? '',
      receivingApp: mshFields[4] ?? '',
      receivingFacility: mshFields[5] ?? '',
      version: mshFields[11] ?? '2.5',
    },
  };
}

/** Accusé de réception HL7 (ACK) : AA = accepté, AE = erreur de traitement, AR = rejeté. */
export function buildHl7Ack(header: NonNullable<ParsedMessage['hl7Header']> | null, controlId: string | null, code: 'AA' | 'AE' | 'AR', text: string, now: Date): string {
  const fs = header?.fieldSep ?? '|';
  const enc = header?.encoding ?? '^~\\&';
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const clean = (v: string) => v.replace(/[|^~\\&\r\n]/g, ' ').slice(0, 80);
  const msh = ['MSH', enc, 'SIL-LIMS', '', header?.sendingApp ?? '', header?.sendingFacility ?? '', ts, '', 'ACK^R01^ACK', `ACK${ts}`, 'P', header?.version || '2.5'].join(fs);
  const msa = ['MSA', code, controlId ?? '', clean(text)].join(fs);
  return `${msh}\r${msa}\r`;
}
