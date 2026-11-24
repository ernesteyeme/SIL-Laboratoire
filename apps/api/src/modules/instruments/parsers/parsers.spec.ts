import { astmChecksum, buildAstmOrders, parseAstm, unframeAstm } from './astm';
import { parseCsv, splitCsvLine } from './csv';
import { buildHl7Ack, parseHl7, stripMllp } from './hl7';
import { parseInstrumentMessage } from './index';
import { MessageParseError } from './types';
import { normalizeInstrumentValue } from './values';

const toDate = (p: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null) =>
  p ? new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)) : null;

/** Construit des trames E1381 comme le ferait un automate (n° de trame 1..7, 0..). */
function frame(records: string[]): string {
  return records
    .map((r, i) => {
      const body = `${(i + 1) % 8}${r}\r\x03`;
      return `\x02${body}${astmChecksum(body)}\r\n`;
    })
    .join('');
}

const NFS_RECORDS = [
  'H|\\^&|||XN-1000^00-24^12345|||||||P|LIS2-A2|20261122081500',
  'P|1||PAT-000123||KABILA^Marie||19850701|F',
  'O|1|2611220001^01||^^^WBC\\^^^HGB|R||20261122074500||||N||||||||||||||F',
  'R|1|^^^WBC^1|7.85|10*3/uL||N||F||||20261122081210',
  'R|2|^^^HGB^1|6.4|g/dL||LL||F||||20261122081210',
  'R|3|^^^PLT^1||10*3/uL||||X||||20261122081210',
  'C|1|I|Échantillon lipémique|G',
  'L|1|N',
];

describe('ASTM E1381 / E1394', () => {
  it('somme de contrôle conforme à la norme (exemple : « 1H|\\^&\\r<ETX> »)', () => {
    expect(astmChecksum('1H|\\^&\r\x03')).toMatch(/^[0-9A-F]{2}$/);
    expect(astmChecksum('1H\r\x03')).toBe(((0x31 + 0x48 + 0x0d + 0x03) % 256).toString(16).toUpperCase());
  });

  it('retire les trames, recolle les fragments ETB et signale une somme de contrôle fausse', () => {
    const b1 = '1R|1|^^^GLU|0.9';
    const b2 = '2|g/L||N||F\r';
    const raw = `\x02${b1}\x17${astmChecksum(b1 + '\x17')}\r\n\x02${b2}\x03${astmChecksum(b2 + '\x03')}\r\n`;
    expect(unframeAstm(raw)).toEqual({ text: 'R|1|^^^GLU|0.9|g/L||N||F\r', warnings: [] });
    const broken = `\x02${b2}\x0300\r\n`;
    expect(unframeAstm(broken).warnings[0]).toMatch(/somme de contrôle 00/);
  });

  it('lit un message de numération : échantillon, code test (4e composante), valeur, unité, indicateur, statut, heure', () => {
    const msg = parseAstm(frame(NFS_RECORDS), toDate);
    expect(msg.warnings).toEqual([]);
    expect(msg.results).toHaveLength(3);
    expect(msg.results[1]).toEqual({
      specimenId: '2611220001',
      testCode: 'HGB',
      value: '6.4',
      unit: 'g/dL',
      flags: 'LL',
      resultStatus: 'F',
      measuredAt: new Date('2026-11-22T08:12:10Z'),
    });
    expect(msg.results[2]).toMatchObject({ testCode: 'PLT', value: '', resultStatus: 'X' });
  });

  it('accepte aussi les enregistrements non tramés séparés par CR ou LF', () => {
    const msg = parseAstm(NFS_RECORDS.join('\n'), toDate);
    expect(msg.results.map((r) => r.testCode)).toEqual(['WBC', 'HGB', 'PLT']);
  });

  it('délimiteurs personnalisés lus dans l’en-tête et séquences d’échappement', () => {
    const msg = parseAstm(['H#~@$', 'O#1#QC-N1', 'R#1#@@@CREA#9.9$S$x#mg/L'].join('\r'), toDate);
    expect(msg.results[0]).toMatchObject({ specimenId: 'QC-N1', testCode: 'CREA', value: '9.9@x' });
  });

  it('message sans en-tête ou résultat sans commande : erreur ou avertissement explicites', () => {
    expect(() => parseAstm('R|1|^^^GLU|1', toDate)).toThrow(MessageParseError);
    expect(parseAstm('H|\\^&\rR|1|^^^GLU|1', toDate).warnings[0]).toMatch(/sans commande O/);
  });

  it('liste de travail : P et O par échantillon, urgence en priorité S, tests répétés', () => {
    const astm = buildAstmOrders(
      [{ sampleNumber: '2611220007', priority: 'URGENT', patient: { code: 'PAT-1', lastName: 'MBALA', firstName: 'Ruth', sex: 'FEMALE', birthDate: '1991-03-14' }, collectedAt: null, tests: ['WBC', 'HGB'] }],
      new Date('2026-11-22T10:00:00Z'),
      'Africa/Kinshasa',
    );
    const lines = astm.split('\r');
    // Pas de n° de trame dans les enregistrements ; heure locale de Kinshasa (UTC+1)
    expect(lines[0]).toBe('H|\\^&|||SIL-LIMS^1.0|||||||P|LIS2-A2|20261122110000');
    expect(lines[1]).toBe('P|1||PAT-1||MBALA^Ruth||19910314|F');
    expect(lines[2]).toMatch(/^O\|1\|2611220007\|\|\^\^\^WBC\\\^\^\^HGB\|S\|/);
    expect(lines[3]).toBe('L|1|N');
    // Relu par notre propre analyseur, le message reste cohérent
    expect(parseAstm(astm, toDate).warnings).toEqual([]);
  });
});

const HL7_VL = [
  'MSH|^~\\&|GeneXpert|CHK|SIL||20261122093000||ORU^R01|MSG00042|P|2.5',
  'PID|1||PAT-000321||MUKENDI^Jean',
  'OBR|1|2611220010|GX-778|HIV-VL^Charge virale VIH|||20261122090000',
  'OBX|1|NM|HIV1VL^HIV-1 Viral Load||1.23E3|copies/mL|<40|H|||F|||20261122092500',
  'OBX|2|ST|HIV1VL-LOG^Log||3.09|log|||||F',
  'SPM|1|2611220010A',
].join('\r');

describe('HL7 v2 ORU^R01', () => {
  it('lit les observations ; SPM-2 prime sur OBR-3 et OBR-2', () => {
    const msg = parseHl7(`\x0b${HL7_VL}\x1c\r`, toDate);
    expect(msg.controlId).toBe('MSG00042');
    expect(msg.results).toEqual([
      { specimenId: '2611220010A', testCode: 'HIV1VL', value: '1.23E3', unit: 'copies/mL', flags: 'H', resultStatus: 'F', measuredAt: new Date('2026-11-22T09:25:00Z') },
      expect.objectContaining({ specimenId: '2611220010A', testCode: 'HIV1VL-LOG', measuredAt: new Date('2026-11-22T09:00:00Z') }),
    ]);
  });

  it('sans SPM : OBR-3 puis OBR-2', () => {
    const msg = parseHl7(HL7_VL.replace(/\rSPM.*$/, ''), toDate);
    expect(msg.results[0].specimenId).toBe('GX-778');
    expect(parseHl7(HL7_VL.replace('|GX-778|', '||').replace(/\rSPM.*$/, ''), toDate).results[0].specimenId).toBe('2611220010');
  });

  it('refuse un autre type de message et un message sans MSH', () => {
    expect(() => parseHl7(HL7_VL.replace('ORU^R01', 'ADT^A01'), toDate)).toThrow(/ADT/);
    expect(() => parseHl7('PID|1', toDate)).toThrow(/MSH/);
  });

  it('ACK : renvoie l’identifiant de contrôle et le code d’acceptation', () => {
    const msg = parseHl7(HL7_VL, toDate);
    const ack = buildHl7Ack(msg.hl7Header!, msg.controlId, 'AA', 'Message intégré', new Date('2026-11-22T10:00:00Z'));
    const [msh, msa] = ack.split('\r');
    expect(msh).toMatch(/^MSH\|\^~\\&\|SIL-LIMS\|\|GeneXpert\|CHK\|20261122100000\|\|ACK\^R01\^ACK\|/);
    expect(msa).toBe('MSA|AA|MSG00042|Message intégré');
    expect(stripMllp('\x0bA\x1c\r')).toBe('A');
  });
});

describe('CSV', () => {
  const config = { delimiter: ';' as const, hasHeader: true, specimenColumn: 'Echantillon', testColumn: 'Test', valueColumn: 'Resultat', unitColumn: 'Unite', flagsColumn: null, measuredAtColumn: 'Date' };

  it('guillemets et délimiteur à l’intérieur d’un champ', () => {
    expect(splitCsvLine('a;"b;c";"d ""e"""', ';')).toEqual(['a', 'b;c', 'd "e"']);
  });

  it('en-tête insensible à la casse, date française, lignes incomplètes signalées', () => {
    const raw = '﻿echantillon;TEST;Resultat;Unite;Date\n2611220001;GLU;0,95;g/L;22/11/2026 08:30\n;CREA;9;mg/L;\n2611220002;CREA;12,1;mg/L;2026-11-22 08:31:05\n';
    const msg = parseCsv(raw, config, toDate);
    expect(msg.results).toHaveLength(2);
    expect(msg.results[0]).toMatchObject({ specimenId: '2611220001', testCode: 'GLU', value: '0,95', unit: 'g/L', measuredAt: new Date('2026-11-22T08:30:00Z') });
    expect(msg.results[1].measuredAt).toEqual(new Date('2026-11-22T08:31:05Z'));
    expect(msg.warnings[0]).toMatch(/Ligne 3/);
  });

  it('colonne absente → erreur ; sans en-tête → numéros de colonne', () => {
    expect(() => parseCsv('a;b;c\n1;2;3', config, toDate)).toThrow(/Echantillon/);
    const msg = parseCsv('2611220001,HGB,13.2', { ...config, delimiter: ',', hasHeader: false, specimenColumn: '1', testColumn: '2', valueColumn: '3', unitColumn: null, measuredAtColumn: null }, toDate);
    expect(msg.results[0]).toMatchObject({ specimenId: '2611220001', testCode: 'HGB', value: '13.2' });
  });
});

describe('Normalisation des valeurs', () => {
  const num = { resultType: 'NUMERIC' as const, choices: [], decimals: 1 };
  const id = { factor: 1, valueMap: {} };

  it('notation scientifique, qualificatifs, virgule', () => {
    expect(normalizeInstrumentValue('1.23E3', 'F', num, id)).toEqual({ ok: true, value: '1230' });
    expect(normalizeInstrumentValue('<4.0e1', null, num, id)).toEqual({ ok: true, value: '<40' });
    expect(normalizeInstrumentValue('12,5', null, num, id)).toEqual({ ok: true, value: '12.5' });
  });

  it('table de correspondance avant conversion (charge virale « Target Not Detected »)', () => {
    expect(normalizeInstrumentValue('target not detected', 'F', num, { factor: 1, valueMap: { 'Target Not Detected': '<40' } })).toEqual({ ok: true, value: '<40' });
  });

  it('facteur de conversion d’unité sans artefact flottant', () => {
    expect(normalizeInstrumentValue('5.1', null, num, { factor: 0.18016, valueMap: {} })).toEqual({ ok: true, value: '0.9188' });
    expect(normalizeInstrumentValue('0.1', null, num, { factor: 3, valueMap: {} })).toEqual({ ok: true, value: '0.3' });
  });

  it('non réalisé (X), vide, non numérique, choix inconnu', () => {
    expect(normalizeInstrumentValue('', 'X', num, id)).toMatchObject({ ok: false, notPerformed: true });
    expect(normalizeInstrumentValue('  ', 'F', num, id)).toMatchObject({ ok: false, notPerformed: true });
    expect(normalizeInstrumentValue('ERR', 'F', num, id)).toMatchObject({ ok: false, notPerformed: false });
    const choice = { resultType: 'CHOICE' as const, choices: ['Positif', 'Négatif'], decimals: null };
    expect(normalizeInstrumentValue('POS', 'F', choice, { factor: 1, valueMap: { POS: 'Positif' } })).toEqual({ ok: true, value: 'Positif' });
    expect(normalizeInstrumentValue('Indéterminé', 'F', choice, id)).toMatchObject({ ok: false, notPerformed: false });
  });
});

describe('Aiguillage par protocole et heure de l’automate', () => {
  it('l’horodatage AAAAMMJJHHMMSS est interprété dans le fuseau du laboratoire (Kinshasa = UTC+1)', () => {
    const msg = parseInstrumentMessage(NFS_RECORDS.join('\r'), 'ASTM', null, 'Africa/Kinshasa');
    expect(msg.results[0].measuredAt?.toISOString()).toBe('2026-11-22T07:12:10.000Z');
  });
  it('CSV sans configuration → erreur', () => {
    expect(() => parseInstrumentMessage('a;b', 'CSV', null, 'Africa/Kinshasa')).toThrow(/Configuration CSV/);
  });
});
