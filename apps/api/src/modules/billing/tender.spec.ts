import { convertCents, rateToScaled, secondaryCurrencyFor } from '@lims/shared';
import { expectedCash } from './billing.mapper';
import { settleTender } from './tender';

describe('conversion CDF / USD', () => {
  it('convertit au centime près dans les deux sens', () => {
    expect(rateToScaled('2850.5')).toBe(28505000n);
    expect(convertCents(1000, 'USD', 'CDF', '2850')).toBe(2850000); // 10 USD = 28 500 CDF
    expect(convertCents(2850000, 'CDF', 'USD', '2850')).toBe(1000);
    expect(convertCents(780000, 'CDF', 'USD', '2850')).toBe(274); // 7 800 CDF = 2,74 USD (2,7368…)
    expect(convertCents(150, 'USD', 'CDF', '2849.9999')).toBe(427500); // arrondi au centime
  });
  it('pas de dépassement sur de gros montants (calcul entier)', () => {
    expect(convertCents(1_000_000_000_00, 'USD', 'CDF', '2850.1234')).toBe(285_012_340_000_000);
  });
  it('devise secondaire', () => {
    expect(secondaryCurrencyFor('CDF', true)).toBe('USD');
    expect(secondaryCurrencyFor('USD', true)).toBe('CDF');
    expect(secondaryCurrencyFor('CDF', false)).toBeNull();
    expect(secondaryCurrencyFor('EUR', true)).toBeNull();
  });
});

describe('settleTender', () => {
  const base = { baseCurrency: 'CDF', cdfPerUsd: '2850', method: 'CASH' as const };
  it('3 USD pour 7 800 CDF dus : 7 800 imputés, 750 CDF de monnaie', () => {
    expect(settleTender({ ...base, tenderedCents: 300, currency: 'USD', balanceCents: 780000 })).toEqual({
      ok: true,
      convertedCents: 855000,
      appliedCents: 780000,
      changeCents: 75000,
    });
  });
  it('paiement partiel en dollars', () => {
    expect(settleTender({ ...base, tenderedCents: 100, currency: 'USD', balanceCents: 780000 })).toMatchObject({ appliedCents: 285000, changeCents: 0 });
  });
  it('espèces en devise de base avec monnaie', () => {
    expect(settleTender({ ...base, tenderedCents: 1000000, currency: 'CDF', balanceCents: 780000 })).toMatchObject({ appliedCents: 780000, changeCents: 220000 });
  });
  it('excédent refusé hors espèces', () => {
    expect(settleTender({ ...base, method: 'MOBILE_MONEY', tenderedCents: 300, currency: 'USD', balanceCents: 780000 })).toMatchObject({ ok: false, rule: 'AMOUNT_EXCEEDS_BALANCE' });
  });
  it('taux obligatoire pour la devise secondaire', () => {
    expect(settleTender({ ...base, cdfPerUsd: null, tenderedCents: 300, currency: 'USD', balanceCents: 780000 })).toMatchObject({ ok: false, rule: 'RATE_REQUIRED' });
  });
});

describe('espèces attendues', () => {
  const session = {
    baseCurrency: 'CDF',
    secondaryCurrency: 'USD',
    openingFloat: { toFixed: () => '50000.00' },
    openingFloatSecondary: { toFixed: () => '20.00' },
  } as never;
  it('fond + espèces par devise − monnaie rendue en CDF', () => {
    const r = expectedCash(session, {
      byMethod: [
        { method: 'CASH', currency: 'CDF', count: 1, tendered: '10000.00', applied: '7800.00' },
        { method: 'CASH', currency: 'USD', count: 1, tendered: '3.00', applied: '7800.00' },
        { method: 'MOBILE_MONEY', currency: 'CDF', count: 1, tendered: '5000.00', applied: '5000.00' },
      ],
      cancelledCount: 0,
      changeCents: 220000 + 75000,
    });
    expect(r).toEqual({ baseCents: 5000000 + 1000000 - 295000, secondaryCents: 2300 });
  });
});
