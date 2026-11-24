import { computeInvoiceTotals, fromCents, toCents } from '@lims/shared';
import { labPeriods } from '../../core/numbering/numbering.service';
import { computeOrderStatus } from '../orders/order-status';

describe('centimes', () => {
  it('convertit sans erreur d’arrondi', () => {
    expect(toCents('8000.50')).toBe(800050);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('15 000,05')).toBe(1500005);
    expect(fromCents(800050)).toBe('8000.50');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(toCents('0.1') + toCents('0.2'))).toBe('0.30');
    expect(() => toCents('12.345')).toThrow();
  });
});

describe('computeInvoiceTotals', () => {
  it('total − remise = net ; prise en charge partielle', () => {
    const t = computeInvoiceTotals({ lineCents: [800000, 300000], discountCents: 100000, coveragePercent: 80, paidCents: 0 });
    expect(t.netCents).toBe(1000000);
    expect(t.thirdPartyCents).toBe(800000);
    expect(t.patientCents).toBe(200000);
    expect(t.status).toBe('UNPAID');
  });
  it('part tiers + part patient = net, même avec arrondi', () => {
    const t = computeInvoiceTotals({ lineCents: [333], discountCents: 0, coveragePercent: 33, paidCents: 0 });
    expect(t.thirdPartyCents + t.patientCents).toBe(t.netCents);
  });
  it('statuts selon les paiements', () => {
    const base = { lineCents: [500000], discountCents: 0, coveragePercent: 0 };
    expect(computeInvoiceTotals({ ...base, paidCents: 200000 }).status).toBe('PARTIALLY_PAID');
    expect(computeInvoiceTotals({ ...base, paidCents: 500000 }).status).toBe('PAID');
    expect(computeInvoiceTotals({ ...base, paidCents: 0, cancelled: true }).status).toBe('CANCELLED');
  });
  it('prise en charge totale : rien à payer pour le patient', () => {
    const t = computeInvoiceTotals({ lineCents: [500000], discountCents: 0, coveragePercent: 100, paidCents: 0 });
    expect(t.patientCents).toBe(0);
    expect(t.status).toBe('PAID');
  });
  it('remise plafonnée au total', () => {
    expect(computeInvoiceTotals({ lineCents: [1000], discountCents: 5000, coveragePercent: 0, paidCents: 0 }).netCents).toBe(0);
  });
});

describe('computeOrderStatus', () => {
  const s = (status: 'PENDING_COLLECTION' | 'COLLECTED' | 'RECEIVED' | 'REJECTED', itemCount = 1) => ({ status, itemCount });
  it.each([
    [[s('PENDING_COLLECTION'), s('PENDING_COLLECTION')], 'REGISTERED'],
    [[s('COLLECTED'), s('PENDING_COLLECTION')], 'PARTIALLY_COLLECTED'],
    [[s('COLLECTED'), s('RECEIVED')], 'COLLECTED'],
    [[s('RECEIVED'), s('RECEIVED')], 'RECEIVED'],
    [[s('RECEIVED'), s('REJECTED')], 'PARTIALLY_COLLECTED'],
    // Échantillon refusé et remplacé (0 examen) : ignoré.
    [[s('RECEIVED'), s('REJECTED', 0), s('RECEIVED')], 'RECEIVED'],
  ] as const)('%j → %s', (samples, expected) => {
    expect(computeOrderStatus([...samples], false)).toBe(expected);
  });
  it('annulée prime sur tout', () => expect(computeOrderStatus([s('RECEIVED')], true)).toBe('CANCELLED'));
});

describe('labPeriods', () => {
  it('utilise la date locale du laboratoire (pas UTC)', () => {
    // 23 h 30 UTC le 31/12 = 0 h 30 le 01/01 à Kinshasa (UTC+1).
    const d = new Date('2026-12-31T23:30:00Z');
    expect(labPeriods(d, 'Africa/Kinshasa')).toEqual({ year: '2027', yymmdd: '270101', isoDate: '2027-01-01' });
    expect(labPeriods(d, 'UTC')).toEqual({ year: '2026', yymmdd: '261231', isoDate: '2026-12-31' });
  });
});
