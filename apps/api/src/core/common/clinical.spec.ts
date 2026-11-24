import {
  ageToDays,
  computeAge,
  createPatientSchema,
  daysToAge,
  formatAgeInterval,
  interpretNumeric,
  moneySchema,
  nameSearchKey,
  phoneKey,
  rangesConflict,
  referenceRangeSchema,
  resolveReferenceRange,
} from '@lims/shared';

describe('computeAge', () => {
  it('calcule les années révolues', () => {
    expect(computeAge('1990-05-20', '2026-05-19').years).toBe(35);
    expect(computeAge('1990-05-20', '2026-05-20').years).toBe(36);
    expect(computeAge('1990-05-20', '2026-11-22').label).toBe('36 ans');
  });
  it('affiche en mois avant 2 ans et en jours le premier mois', () => {
    expect(computeAge('2025-03-10', '2026-11-22').label).toBe('20 mois');
    expect(computeAge('2026-11-10', '2026-11-22').label).toBe('12 jours');
    expect(computeAge('2026-11-22', '2026-11-22').label).toBe('0 jour');
  });
  it('gère les années bissextiles', () => {
    expect(computeAge('2024-02-29', '2025-02-28').years).toBe(0);
    expect(computeAge('2024-02-29', '2025-03-01').years).toBe(1);
  });
});

describe('normalisation', () => {
  it('rend la clé de nom indépendante de l’ordre, de la casse et des accents', () => {
    expect(nameSearchKey('KABILA', 'Mbuyi', 'Marie-Hélène')).toBe(nameSearchKey('marie helene', 'MBUYI', 'Kabila'));
  });
  it('normalise les téléphones congolais quel que soit le format', () => {
    expect(phoneKey('+243 81 234 5678')).toBe('812345678');
    expect(phoneKey('0812345678')).toBe('812345678');
    expect(phoneKey('00243812345678')).toBe('812345678');
    expect(phoneKey('123')).toBeNull();
  });
});

describe('âges des valeurs de référence', () => {
  it('convertit aller-retour sans perte', () => {
    for (const [v, u] of [[18, 'YEARS'], [6, 'MONTHS'], [28, 'DAYS']] as const) {
      expect(daysToAge(ageToDays(v, u))).toEqual({ value: v, unit: u });
    }
  });
  it('formate les tranches', () => {
    expect(formatAgeInterval(0, null)).toBe('Tous âges');
    expect(formatAgeInterval(ageToDays(18, 'YEARS'), null)).toBe('≥ 18 ans');
    expect(formatAgeInterval(0, ageToDays(1, 'MONTHS'))).toBe('< 1 mois');
  });
});

describe('resolveReferenceRange', () => {
  const adult = ageToDays(18, 'YEARS');
  const ranges = [
    { id: 'any-all', sex: 'ANY' as const, ageMinDays: 0, ageMaxDays: null },
    { id: 'm-adult', sex: 'MALE' as const, ageMinDays: adult, ageMaxDays: null },
    { id: 'f-adult', sex: 'FEMALE' as const, ageMinDays: adult, ageMaxDays: null },
    { id: 'child', sex: 'ANY' as const, ageMinDays: 0, ageMaxDays: adult },
  ];
  it('préfère le sexe spécifique puis la tranche la plus étroite', () => {
    expect(resolveReferenceRange(ranges, 'MALE', ageToDays(40, 'YEARS'))?.id).toBe('m-adult');
    expect(resolveReferenceRange(ranges, 'FEMALE', ageToDays(40, 'YEARS'))?.id).toBe('f-adult');
    expect(resolveReferenceRange(ranges, 'MALE', ageToDays(5, 'YEARS'))?.id).toBe('child');
  });
  it('n’applique que les plages « Tous » si le sexe est inconnu', () => {
    expect(resolveReferenceRange(ranges, 'UNKNOWN', ageToDays(40, 'YEARS'))?.id).toBe('any-all');
  });
  it('borne supérieure exclue', () => {
    expect(resolveReferenceRange([ranges[3]], 'MALE', adult)).toBeNull();
  });
});

describe('rangesConflict', () => {
  it('signale un chevauchement de même sexe, pas entre « Tous » et un sexe précis', () => {
    expect(rangesConflict({ sex: 'MALE', ageMinDays: 0, ageMaxDays: 100 }, { sex: 'MALE', ageMinDays: 50, ageMaxDays: null })).toBe(true);
    expect(rangesConflict({ sex: 'MALE', ageMinDays: 0, ageMaxDays: 100 }, { sex: 'MALE', ageMinDays: 100, ageMaxDays: null })).toBe(false);
    expect(rangesConflict({ sex: 'ANY', ageMinDays: 0, ageMaxDays: null }, { sex: 'MALE', ageMinDays: 0, ageMaxDays: null })).toBe(false);
  });
});

describe('interpretNumeric', () => {
  const b = { low: 12, high: 16, criticalLow: 7, criticalHigh: 20 };
  it.each([
    [6.9, 'CRITICAL_LOW'],
    [11.9, 'LOW'],
    [12, 'NORMAL'],
    [16, 'NORMAL'],
    [16.1, 'HIGH'],
    [21, 'CRITICAL_HIGH'],
  ])('%p → %p', (v, flag) => expect(interpretNumeric(v, b)).toBe(flag));
});

describe('schémas', () => {
  it('normalise les montants', () => {
    expect(moneySchema.parse('15 000,50')).toBe('15000.50');
    expect(moneySchema.parse(2500)).toBe('2500');
    expect(moneySchema.safeParse('-1').success).toBe(false);
    expect(moneySchema.safeParse('12.345').success).toBe(false);
  });
  it('valide la cohérence des bornes de référence', () => {
    const base = { ageMaxDays: null, criticalLow: null, criticalHigh: null };
    expect(referenceRangeSchema.safeParse({ ...base, low: '16', high: '12' }).success).toBe(false);
    expect(referenceRangeSchema.safeParse({ ...base, low: '', high: '' }).success).toBe(false);
    const ok = referenceRangeSchema.parse({ ...base, low: '12,5', high: '16' });
    expect(ok.low).toBe(12.5);
    expect(ok.sex).toBe('ANY');
  });
  it('refuse une date de naissance future et accepte une date vide', () => {
    expect(createPatientSchema.safeParse({ lastName: 'X', sex: 'MALE', birthDate: '2999-01-01' }).success).toBe(false);
    expect(createPatientSchema.parse({ lastName: 'X', sex: 'MALE', birthDate: '' }).birthDate).toBeNull();
  });
});
