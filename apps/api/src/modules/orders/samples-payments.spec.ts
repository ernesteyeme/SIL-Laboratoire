import type { ResultsService } from '../results/results.service';
import type { AuditService } from '../../core/audit/audit.service';
import type { LabContextService } from '../../core/common/lab-context.service';
import type { RequestUser } from '../../core/context/request-context';
import { DomainException } from '../../core/errors/domain.exception';
import type { NumberingService } from '../../core/numbering/numbering.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { BillingRepository } from '../billing/billing.repository';
import type { InvoicesService } from '../billing/invoices.service';
import type { ExchangeRatesService } from '../billing/exchange-rates.service';
import { PaymentsService } from '../billing/payments.service';
import type { OrdersRepository } from './orders.repository';
import type { OrdersService } from './orders.service';
import { SamplesService } from './samples.service';

const tx = {
  tx: true,
  invoice: { findUnique: jest.fn() },
};
const prisma = { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
const audit = { record: jest.fn() } as unknown as AuditService;
const numbering = { sampleNumber: jest.fn().mockResolvedValue('2611220099'), receiptNumber: jest.fn().mockResolvedValue('REC-2026-000001') } as unknown as NumberingService;
const decimal = (v: number) => ({ toFixed: (dp: number) => v.toFixed(dp) });

const user = (roles: RequestUser['roles']): RequestUser => ({ id: 'u1', username: 'x', fullName: 'X', roles, mustChangePassword: false });

async function expectRule(p: Promise<unknown>, rule: string) {
  await expect(p).rejects.toBeInstanceOf(DomainException);
  await p.catch((e: DomainException) => expect((e.getResponse() as { details: { rule: string } }).details.rule).toBe(rule));
}

const patient = {
  id: 'p1', code: 'PAT-000001', lastName: 'Kabila', middleName: null, firstName: 'Marie',
  sex: 'FEMALE', birthDate: null, birthDateEstimated: false, phone: null,
};
const baseOrder = { id: 'o1', number: 'DEM-2026-000001', priority: 'ROUTINE', status: 'REGISTERED', createdAt: new Date(), clinicalInfo: null, patient };

function sample(overrides: Record<string, unknown> = {}) {
  return {
    sampleType: { id: 't1', code: 'ST-EDTA', name: 'Sang total EDTA', container: null, instructions: null },
    collectedAt: null,
    collectedById: null,
    hasReservation: false,
    replaces: null,
    id: 's1',
    number: '2611220001',
    orderId: 'o1',
    sampleTypeId: 't1',
    status: 'PENDING_COLLECTION',
    receivedAt: null,
    receivedById: null,
    replacedBy: null,
    items: [{ examCode: 'NFS' }],
    nonConformities: [],
    order: baseOrder,
    ...overrides,
  };
}

describe('SamplesService – règles', () => {
  const repo = {
    lock: jest.fn(),
    findSampleContext: jest.fn(),
    updateSample: jest.fn((_id: string, d: object) => Promise.resolve({ ...sample(), ...d })),
    createNonConformity: jest.fn().mockResolvedValue({ id: 'nc1', type: 'HEMOLYZED', decision: 'REJECTED', comment: null }),
  } as unknown as jest.Mocked<OrdersRepository>;
  const orders = { refreshStatus: jest.fn() } as unknown as OrdersService;
  const lab = { settings: jest.fn(), userNames: jest.fn().mockResolvedValue(new Map()) } as unknown as jest.Mocked<LabContextService>;
  const results = { initializeForSample: jest.fn(), resetForSample: jest.fn() } as unknown as ResultsService;
  const service = new SamplesService(prisma, repo, orders, numbering, lab, audit, results);

  beforeEach(() => jest.clearAllMocks());

  it('bloque le prélèvement d’une demande non payée si le paramètre l’exige', async () => {
    repo.findSampleContext.mockResolvedValue(sample() as never);
    lab.settings.mockResolvedValue({ requirePaymentBeforeCollection: true } as never);
    tx.invoice.findUnique.mockResolvedValue({ status: 'UNPAID' });
    await expectRule(service.collect('s1', {}, user(['RECEPTION'])), 'PAYMENT_REQUIRED');
  });

  it('dispense les demandes urgentes du paiement préalable', async () => {
    repo.findSampleContext.mockResolvedValue(sample({ order: { ...baseOrder, priority: 'URGENT' } }) as never);
    lab.settings.mockResolvedValue({ requirePaymentBeforeCollection: true } as never);
    tx.invoice.findUnique.mockResolvedValue({ status: 'UNPAID' });
    await service.collect('s1', {}, user(['RECEPTION']));
    expect(repo.updateSample).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'COLLECTED' }), tx);
    expect(orders.refreshStatus).toHaveBeenCalledWith(tx, 'o1');
  });

  it('réserve la dérogation aux biologistes', async () => {
    await expectRule(
      service.recordNonConformity('s1', { type: 'HEMOLYZED', decision: 'ACCEPTED_WITH_RESERVATION', comment: 'Légère hémolyse' }, user(['TECHNICIEN'])),
      'DEROGATION_BIOLOGIST_ONLY',
    );
  });

  it('un refus passe l’échantillon au statut REFUSÉ', async () => {
    repo.findSampleContext.mockResolvedValue(sample({ status: 'COLLECTED' }) as never);
    await service.recordNonConformity('s1', { type: 'HEMOLYZED', decision: 'REJECTED', comment: null }, user(['TECHNICIEN']));
    expect(repo.updateSample).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'REJECTED' }), tx);
  });

  it('refuse de réceptionner un échantillon non prélevé', async () => {
    repo.findSampleContext.mockResolvedValue(sample() as never);
    await expectRule(service.receive('s1', user(['TECHNICIEN'])), 'SAMPLE_NOT_COLLECTED');
  });

  it('refuse toute opération sur une demande annulée', async () => {
    repo.findSampleContext.mockResolvedValue(sample({ order: { ...baseOrder, status: 'CANCELLED' } }) as never);
    await expectRule(service.collect('s1', {}, user(['RECEPTION'])), 'ORDER_CANCELLED');
  });
});

describe('PaymentsService – règles', () => {
  const repo = {
    findOpenSession: jest.fn(),
    lock: jest.fn(),
    sumActivePayments: jest.fn(),
    createPayment: jest.fn(),
  } as unknown as jest.Mocked<BillingRepository>;
  const invoices = {
    getOrThrow: jest.fn().mockResolvedValue({
      id: 'i1',
      number: 'FAC-2026-000001',
      status: 'UNPAID',
      lines: [{ amount: decimal(10000) }],
      discountAmount: decimal(0),
      coveragePercent: 0,
    }),
  } as unknown as InvoicesService;
  const lab = { settings: jest.fn().mockResolvedValue({ timezone: 'Africa/Kinshasa' }) } as unknown as LabContextService;
  const rates = { today: jest.fn().mockResolvedValue(null) } as unknown as ExchangeRatesService;
  const service = new PaymentsService(prisma, repo, invoices, numbering, lab, audit, rates);

  beforeEach(() => jest.clearAllMocks());

  it('exige une session de caisse ouverte', async () => {
    repo.findOpenSession.mockResolvedValue(null);
    await expectRule(service.pay('i1', { amount: '100', method: 'CASH', reference: null }, user(['CAISSE'])), 'NO_OPEN_CASH_SESSION');
  });

  const session = { id: 'cs1', number: 'CS-2026-0001', baseCurrency: 'CDF', secondaryCurrency: 'USD' };

  it('refuse une devise non acceptée par la session', async () => {
    repo.findOpenSession.mockResolvedValue(session as never);
    await expectRule(service.pay('i1', { amount: '10', currency: 'EUR', method: 'CASH', reference: null }, user(['CAISSE'])), 'CURRENCY_NOT_ACCEPTED');
  });

  it('exige le taux du jour pour un paiement en devise secondaire', async () => {
    repo.findOpenSession.mockResolvedValue(session as never);
    repo.sumActivePayments.mockResolvedValue('0.00');
    await expectRule(service.pay('i1', { amount: '10', currency: 'USD', method: 'CASH', reference: null }, user(['CAISSE'])), 'RATE_NOT_SET');
  });

  it('refuse un trop-perçu par mobile money (pas de monnaie à rendre)', async () => {
    repo.findOpenSession.mockResolvedValue(session as never);
    repo.sumActivePayments.mockResolvedValue('6000.00');
    await expectRule(
      service.pay('i1', { amount: '4000.01', method: 'MOBILE_MONEY', reference: 'MP1' }, user(['CAISSE'])),
      'AMOUNT_EXCEEDS_BALANCE',
    );
  });

  it('refuse un paiement sur une facture soldée', async () => {
    repo.findOpenSession.mockResolvedValue(session as never);
    repo.sumActivePayments.mockResolvedValue('10000.00');
    await expectRule(service.pay('i1', { amount: '1', method: 'CASH', reference: null }, user(['CAISSE'])), 'ALREADY_PAID');
  });
});
