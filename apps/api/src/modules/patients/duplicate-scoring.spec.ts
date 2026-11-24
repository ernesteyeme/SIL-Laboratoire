import { DUPLICATE_THRESHOLD, scoreDuplicate } from './duplicate-scoring';

const candidate = { sex: 'FEMALE' as const, birthDate: '1990-05-20', birthDateEstimated: false };

describe('scoreDuplicate', () => {
  it('signale un nom identique avec même date de naissance', () => {
    const r = scoreDuplicate({ nameScore: 1, phoneMatch: false, externalMatch: false, candidate, input: { sex: 'FEMALE', birthDate: '1990-05-20' } });
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.reasons).toEqual(['Nom identique', 'Même date de naissance']);
  });

  it('signale un nom identique sans date saisie', () => {
    const r = scoreDuplicate({ nameScore: 1, phoneMatch: false, externalMatch: false, candidate, input: { sex: 'FEMALE' } });
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it('écarte un homonyme né une autre année', () => {
    const r = scoreDuplicate({ nameScore: 1, phoneMatch: false, externalMatch: false, candidate, input: { sex: 'FEMALE', birthDate: '1975-01-01' } });
    expect(r.score).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it('écarte un homonyme de sexe différent', () => {
    const r = scoreDuplicate({ nameScore: 1, phoneMatch: false, externalMatch: false, candidate, input: { sex: 'MALE' } });
    expect(r.score).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it('remonte un nom approximatif partageant le téléphone', () => {
    const r = scoreDuplicate({ nameScore: 0.4, phoneMatch: true, externalMatch: false, candidate, input: {} });
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(r.reasons).toContain('Même numéro de téléphone');
  });

  it('remonte toujours un identifiant externe identique', () => {
    const r = scoreDuplicate({ nameScore: 0, phoneMatch: false, externalMatch: true, candidate, input: {} });
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });
});
