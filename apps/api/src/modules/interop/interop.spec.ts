import { randomBytes } from 'node:crypto';
import {
  aggregateDhis2,
  ageInMonthsAt,
  ageInYearsAt,
  classifyAgainstThreshold,
  dataValueSetToCsv,
  dhis2MappingSchema,
  formatVlsmDate,
  formatVlsmDateTime,
  formatVlsmViralLoad,
  interopEndpointSchema,
  monthPeriodBounds,
  previousMonthPeriod,
  type Dhis2MappingRule,
  type Dhis2ResultRow,
} from '@lims/shared';
import { Prisma } from '../../generated/prisma/client';
import { authorizationHeader, buildUrl, type ConnectionProfile } from './interop-http';
import { parseDhis2ImportSummary, parseDhis2SystemInfo, parseVlsmLogin, parseVlsmSave } from './protocols';
import { payloadSha256 } from './runs.service';
import { openSecret, sealSecret } from './secret-box';
import { buildVlsmRecord, vlsmUniqueId } from './vlsm-export.service';
import type { VlsmItemRow } from './interop.repository';

describe('Périodes et âges', () => {
  it('bornes d’un mois DHIS2, années bissextiles comprises', () => {
    expect(monthPeriodBounds('202402')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthPeriodBounds('202611')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(() => monthPeriodBounds('202613')).toThrow();
    expect(previousMonthPeriod('2026-01-15')).toBe('202512');
    expect(previousMonthPeriod('2026-11-24')).toBe('202610');
  });

  it('âge révolu en années et en mois', () => {
    expect(ageInYearsAt('2011-11-25', '2026-11-24')).toBe(14);
    expect(ageInYearsAt('2011-11-24', '2026-11-24')).toBe(15);
    expect(ageInMonthsAt('2026-05-30', '2026-11-24')).toBe(5);
    expect(ageInMonthsAt('2026-05-24', '2026-11-24')).toBe(6);
  });
});

describe('Seuil de charge virale', () => {
  it('tient compte des limites de détection', () => {
    expect(classifyAgainstThreshold(40, '<', 1000)).toBe('BELOW');
    expect(classifyAgainstThreshold(999, null, 1000)).toBe('BELOW');
    expect(classifyAgainstThreshold(1000, null, 1000)).toBe('AT_OR_ABOVE');
    expect(classifyAgainstThreshold(10_000_000, '>', 1000)).toBe('AT_OR_ABOVE');
    expect(classifyAgainstThreshold(2000, '<', 1000)).toBe('UNKNOWN');
    expect(classifyAgainstThreshold(500, '>', 1000)).toBe('UNKNOWN');
  });
});

describe('Agrégation DHIS2 (canevas CV : < 1000, adultes ≥ 15 ans / enfants < 15 ans, sexe)', () => {
  const P = 'param-cv';
  const row = (v: number | null, q: string | null, sex: 'MALE' | 'FEMALE' | 'UNKNOWN', birth: string | null, text: string | null = null): Dhis2ResultRow => ({
    parameterId: P,
    numericValue: v,
    qualifier: q,
    textValue: text,
    sex,
    birthDate: birth,
    orderDate: '2026-11-10',
  });
  const rule = (id: string, over: Partial<Dhis2MappingRule>): Dhis2MappingRule => ({ id, parameterId: P, measure: 'VALIDATED_COUNT', threshold: null, textMatch: null, sex: 'ANY', ageMinYears: null, ageMaxYears: null, ...over });
  const rows = [
    row(40, '<', 'FEMALE', '1990-01-01'),
    row(150, null, 'MALE', '1985-06-01'),
    row(25000, null, 'FEMALE', '2015-03-01'),
    row(1000, null, 'MALE', '2012-12-01'),
    row(2000, '<', 'FEMALE', '1970-01-01'),
    row(300, null, 'UNKNOWN', null),
    row(null, null, 'FEMALE', '1990-01-01', 'Non détecté'),
    { ...row(50, null, 'MALE', '1980-01-01'), parameterId: 'autre' },
  ];

  it('compte les résultats par règle et signale les exclusions', () => {
    const rules = [
      rule('total', {}),
      rule('supp', { measure: 'NUMERIC_BELOW', threshold: 1000 }),
      rule('nonsupp', { measure: 'NUMERIC_AT_OR_ABOVE', threshold: 1000 }),
      rule('adultF<1000', { measure: 'NUMERIC_BELOW', threshold: 1000, sex: 'FEMALE', ageMinYears: 15 }),
      rule('enfants', { ageMaxYears: 15 }),
      rule('nd', { measure: 'TEXT_EQUALS', textMatch: 'non detecte' }),
    ];
    const c = aggregateDhis2(rules, rows);
    expect(c.get('total')).toEqual({ count: 7, excludedNoAge: 0, excludedAmbiguous: 0 });
    expect(c.get('supp')).toEqual({ count: 3, excludedNoAge: 0, excludedAmbiguous: 1 });
    expect(c.get('nonsupp')).toEqual({ count: 2, excludedNoAge: 0, excludedAmbiguous: 1 });
    expect(c.get('adultF<1000')!.count).toBe(1);
    expect(c.get('enfants')).toEqual({ count: 2, excludedNoAge: 1, excludedAmbiguous: 0 });
    expect(c.get('nd')!.count).toBe(1);
  });

  it('valide les règles de correspondance', () => {
    const base = { label: 'CV < 1000', parameterId: '6f1c2f8e-4b7a-4c1e-9a55-2b1f3c4d5e6f', dataElement: 'aBcDeFgHiJ1' };
    expect(dhis2MappingSchema.safeParse({ ...base, measure: 'NUMERIC_BELOW' }).success).toBe(false);
    expect(dhis2MappingSchema.safeParse({ ...base, measure: 'NUMERIC_BELOW', threshold: 1000 }).success).toBe(true);
    expect(dhis2MappingSchema.safeParse({ ...base, measure: 'VALIDATED_COUNT', dataElement: '1bad' }).success).toBe(false);
    expect(dhis2MappingSchema.safeParse({ ...base, measure: 'VALIDATED_COUNT', ageMinYears: 15, ageMaxYears: 15 }).success).toBe(false);
  });

  it('exporte au format CSV d’import DHIS2', () => {
    const csv = dataValueSetToCsv({ period: '202610', orgUnit: 'OrgUnit0001', dataValues: [{ dataElement: 'DataElem001', categoryOptionCombo: 'CatCombo001', value: '12' }, { dataElement: 'DataElem002', value: '0' }] });
    expect(csv.split('\r\n')[0]).toBe('dataelement,period,orgunit,categoryoptioncombo,attributeoptioncombo,value,storedby,lastupdated,comment,followup');
    expect(csv.split('\r\n')[1]).toBe('DataElem001,202610,OrgUnit0001,CatCombo001,,12,,,,false');
    expect(csv.split('\r\n')[2]).toBe('DataElem002,202610,OrgUnit0001,,,0,,,,false');
  });
});

describe('Réponses DHIS2', () => {
  it('lit un WebMessage DHIS2 ≥ 2.38', () => {
    const o = parseDhis2ImportSummary(200, {
      httpStatus: 'OK',
      status: 'OK',
      response: { responseType: 'ImportSummary', status: 'SUCCESS', importCount: { imported: 3, updated: 2, ignored: 0, deleted: 0 }, conflicts: [] },
    });
    expect(o).toMatchObject({ status: 'SUCCESS', imported: 3, updated: 2, ignored: 0 });
  });

  it('signale les conflits (WARNING) et les rejets (409 → ERROR)', () => {
    const warn = parseDhis2ImportSummary(200, {
      responseType: 'ImportSummary',
      status: 'SUCCESS',
      importCount: { imported: 1, updated: 0, ignored: 1, deleted: 0 },
      conflicts: [{ object: 'XyZ12345678', value: 'Data element not found or not accessible', errorCode: 'E7610' }],
    });
    expect(warn.status).toBe('WARNING');
    expect(warn.conflicts[0]).toEqual({ object: 'XyZ12345678', value: 'Data element not found or not accessible', errorCode: 'E7610' });
    const err = parseDhis2ImportSummary(409, { status: 'ERROR', message: 'One more conflicts encountered', response: { responseType: 'ImportSummary', status: 'ERROR', importCount: { imported: 0, updated: 0, ignored: 2, deleted: 0 }, conflicts: [] } });
    expect(err.status).toBe('ERROR');
    expect(parseDhis2ImportSummary(401, null)).toMatchObject({ status: 'ERROR', message: expect.stringContaining('401') });
    expect(parseDhis2SystemInfo({ version: '2.40.4', systemName: 'DHIS2 RDC' })).toBe('DHIS2 2.40.4 — DHIS2 RDC');
  });
});

describe('Réponses VLSM / InteLIS', () => {
  it('connexion : jeton, refus, panne', () => {
    expect(parseVlsmLogin(200, { status: 1, data: { api_token: 'abc' } })).toEqual({ ok: true, token: 'abc' });
    expect(parseVlsmLogin(200, { status: 2, message: 'Invalid' })).toMatchObject({ ok: false });
    expect(parseVlsmLogin(200, { status: 'failed', message: 'Missing userName' })).toEqual({ ok: false, message: 'Missing userName' });
  });

  it('enregistrement : un résultat par demande, jeton renouvelé', () => {
    const o = parseVlsmSave(200, {
      status: 'success',
      token_updated: true,
      new_token: 'xyz',
      data: [
        { status: 'success', sampleCode: 'VL21001', uniqueId: 'u1', appSampleCode: 'A1', action: 'inserted' },
        { status: 'failed', uniqueId: 'u2', appSampleCode: 'A2', message: 'Facility not found' },
      ],
    });
    expect(o.globalError).toBeNull();
    expect(o.rotatedToken).toBe('xyz');
    expect(o.records).toEqual([
      { appSampleCode: 'A1', uniqueId: 'u1', ok: true, sampleCode: 'VL21001', message: 'inserted' },
      { appSampleCode: 'A2', uniqueId: 'u2', ok: false, sampleCode: null, message: 'Facility not found' },
    ]);
    expect(parseVlsmSave(401, { status: 'failed', error: 'Bearer token expired' }).globalError).toBe('Bearer token expired');
  });
});

describe('Secrets et authentification', () => {
  const key = randomBytes(32);

  it('chiffre en AES-256-GCM, lié au code de la connexion', () => {
    const sealed = sealSecret(key, 'district', 'interop:DHIS2-NAT');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('district');
    expect(openSecret(key, sealed, 'interop:DHIS2-NAT')).toBe('district');
    expect(() => openSecret(key, sealed, 'interop:AUTRE')).toThrow();
    expect(() => openSecret(randomBytes(32), sealed, 'interop:DHIS2-NAT')).toThrow();
    expect(sealSecret(key, 'district', 'interop:X')).not.toBe(sealSecret(key, 'district', 'interop:X'));
  });

  it('en-têtes selon le système et le transport', () => {
    const base: ConnectionProfile = { system: 'DHIS2', transport: 'DIRECT', baseUrl: 'https://d', authMode: 'BASIC', username: 'admin', secret: 'district', timeoutSeconds: 30 };
    expect(authorizationHeader(base)).toBe(`Basic ${Buffer.from('admin:district').toString('base64')}`);
    expect(authorizationHeader({ ...base, authMode: 'TOKEN', secret: 'd2pat_x' })).toBe('ApiToken d2pat_x');
    expect(authorizationHeader({ ...base, transport: 'OPENHIM', username: 'lims-client', secret: 'pw' })).toBe(`Basic ${Buffer.from('lims-client:pw').toString('base64')}`);
    expect(authorizationHeader({ ...base, system: 'VLSM', authMode: 'TOKEN', secret: 'tok' })).toBe('Bearer tok');
    expect(authorizationHeader({ ...base, system: 'VLSM' }, 'session')).toBe('Bearer session');
    expect(buildUrl('https://him:5000/dhis2/', '/api/dataValueSets', { dryRun: 'true' })).toBe('https://him:5000/dhis2/api/dataValueSets?dryRun=true');
  });

  it('valide une connexion OpenHIM (client obligatoire, pas de jeton)', () => {
    const vlsm = { code: 'vlsm-kin', name: 'VLSM Kinshasa', system: 'VLSM', transport: 'OPENHIM', baseUrl: 'https://him.pnls.cd:5000/vlsm/', authMode: 'TOKEN', secret: 's', settings: { labId: 3, facilityId: 12, reasonForVLTesting: '1', defaultSpecimenType: 2 } };
    expect(interopEndpointSchema.safeParse(vlsm).success).toBe(false);
    const ok = interopEndpointSchema.safeParse({ ...vlsm, authMode: 'BASIC', username: 'lims' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.code).toBe('VLSM-KIN');
      expect(ok.data.baseUrl).toBe('https://him.pnls.cd:5000/vlsm');
    }
  });

  it('empreinte déterministe de la charge utile', () => {
    expect(payloadSha256({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(payloadSha256({ a: [{ x: 1, y: 2 }], b: 1 }));
  });
});

describe('Enregistrement VLSM', () => {
  const settings = { labId: 16, facilityId: 3, provinceId: null, reasonForVLTesting: '1', defaultSpecimenType: 2, specimenTypes: [{ sampleTypeId: 'st-dbs', vlsmSpecimenType: 5 }] };
  const item = (over: Partial<VlsmItemRow['order']['patient']> = {}, value: { n: number | null; q?: string | null; t?: string | null } = { n: 40, q: '<' }): VlsmItemRow => ({
    id: '0b6f7a8e-1c2d-4e3f-9a8b-7c6d5e4f3a2b',
    version: 1,
    validatedAt: new Date('2026-11-20T10:00:00Z'),
    technicalValidatedAt: new Date('2026-11-20T08:30:00Z'),
    biologistComment: null,
    examName: 'Charge virale VIH-1',
    order: {
      id: 'o1',
      number: 'D2611200001',
      createdAt: new Date('2026-11-18T07:00:00Z'),
      status: 'VALIDATED',
      patient: { code: 'PAT-000001', lastName: 'MBUYI', middleName: null, firstName: 'Grâce', sex: 'FEMALE', birthDate: new Date('1990-03-12T00:00:00Z'), externalId: 'TARV-0457', phone: null, ...over },
      prescriber: null,
    },
    sample: { number: '2611180003', sampleTypeId: 'st-dbs', collectedAt: new Date('2026-11-18T07:15:00Z'), receivedAt: new Date('2026-11-18T09:00:00Z') },
    results: [{ parameterId: 'p-cv', numericValue: value.n === null ? null : new Prisma.Decimal(value.n), qualifier: value.q ?? null, textValue: value.t ?? null, enteredAt: new Date('2026-11-20T08:00:00Z') }],
  });
  const vl = { parameterId: 'p-cv', testType: 'VL' as const, eidPositive: null, eidNegative: null, eidIndeterminate: null };

  it('format VL : dates VLSM, statut accepté, type d’échantillon mappé', () => {
    const b = buildVlsmRecord(item(), vl, settings, 'Africa/Kinshasa');
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.record).toMatchObject({
      uniqueId: vlsmUniqueId('0b6f7a8e-1c2d-4e3f-9a8b-7c6d5e4f3a2b'),
      appSampleCode: '2611180003',
      labId: '16',
      facilityId: '3',
      patientArtNo: 'TARV-0457',
      patientGender: 'female',
      patientDob: '12-Mar-1990',
      ageInYears: '36',
      sampleCollectionDate: '18-Nov-2026 08:15',
      specimenType: '5',
      vlResult: '<40',
      resultStatus: '7',
    });
    expect(String(b.record.uniqueId)).toHaveLength(32);
  });

  it('bloque un envoi sans N° TARV, et traduit « Non détecté »', () => {
    const blocked = buildVlsmRecord(item({ externalId: null }), vl, settings, 'Africa/Kinshasa');
    expect(blocked).toMatchObject({ ok: false, blocker: expect.stringContaining('TARV') });
    const nd = buildVlsmRecord(item({}, { n: null, t: 'Non détecté' }), vl, settings, 'Africa/Kinshasa');
    expect(nd.ok && nd.record.vlResult).toBe('Target Not Detected');
    expect(formatVlsmViralLoad(12500, null, null)).toBe('12500');
    expect(formatVlsmDate('2021-09-01')).toBe('01-Sep-2021');
    expect(formatVlsmDateTime(new Date('2021-09-01T09:36:00Z'), 'Africa/Kinshasa')).toBe('01-Sep-2021 10:36');
  });

  it('format EID : positif / négatif selon la correspondance', () => {
    const eid = { parameterId: 'p-cv', testType: 'EID' as const, eidPositive: 'Positif', eidNegative: 'Négatif', eidIndeterminate: null };
    const child = { birthDate: new Date('2026-05-02T00:00:00Z') };
    const neg = buildVlsmRecord(item(child, { n: null, t: 'negatif' }), eid, settings, 'Africa/Kinshasa');
    expect(neg.ok && neg.record).toMatchObject({ result: 'negative', childId: 'TARV-0457', childAge: '6', childGender: 'female' });
    const unknown = buildVlsmRecord(item(child, { n: null, t: 'Invalide' }), eid, settings, 'Africa/Kinshasa');
    expect(unknown.ok).toBe(false);
  });
});
