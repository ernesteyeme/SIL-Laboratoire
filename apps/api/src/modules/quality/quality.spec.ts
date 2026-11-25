import { evaluateWestgard, qcStatistics, zScore, type QcPoint } from '@lims/shared';
import { Prisma } from '../../generated/prisma/client';
import type { AuditService } from '../../core/audit/audit.service';
import type { LabContextService } from '../../core/common/lab-context.service';
import { zonedPeriod, zonedStartOfDay } from '../../core/common/time';
import type { SectionAccessService } from '../../core/security/section-access.service';
import type { RequestUser } from '../../core/context/request-context';
import { DomainException } from '../../core/errors/domain.exception';
import type { NumberingService } from '../../core/numbering/numbering.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { QcRepository } from './qc.repository';
import { QcService } from './qc.service';
import type { QualityIssuesRepository } from './quality-issues.repository';
import { QualityIssuesService } from './quality-issues.service';

const run = (...z: number[]): QcPoint[] => z.map((v, i) => ({ targetId: `L${i + 1}`, z: v }));
const hist = (entries: Record<string, number[]>) => new Map(Object.entries(entries));

describe('Règles de Westgard', () => {
  it('score z arrondi au millième ; écart-type nul refusé', () => {
    expect(zScore(5.6, 5, 0.25)).toBe(2.4);
    expect(zScore(4.1, 5, 0.3)).toBe(-3);
    expect(() => zScore(1, 1, 0)).toThrow();
  });

  it('série dans ±2 ET : acceptée', () => {
    const e = evaluateWestgard(run(1.2, -0.8), new Map());
    expect(e.status).toBe('ACCEPTED');
    expect(e.rules).toEqual([]);
  });

  it('1-2s seul : avertissement, la série reste utilisable', () => {
    const e = evaluateWestgard(run(2.3, 0.4), new Map());
    expect(e.status).toBe('WARNING');
    expect(e.rules).toEqual(['1-2s']);
    expect(e.byTarget.get('L2')!.status).toBe('ACCEPTED');
  });

  it('1-3s : rejet (erreur aléatoire), sans mention redondante de 1-2s', () => {
    const e = evaluateWestgard(run(3.4, 0.2), new Map());
    expect(e.status).toBe('REJECTED');
    expect(e.rules).toEqual(['1-3s']);
  });

  it('2-2s sur deux séries consécutives du même niveau, et entre deux niveaux de la même série', () => {
    expect(evaluateWestgard(run(2.4), hist({ L1: [2.2] })).rules).toEqual(['2-2s']);
    expect(evaluateWestgard(run(2.4), hist({ L1: [-2.2] })).status).toBe('WARNING');
    const across = evaluateWestgard(run(-2.1, -2.6), new Map());
    expect(across.status).toBe('REJECTED');
    expect(across.rules).toEqual(['2-2s']);
  });

  it('R-4s : un niveau au-delà de +2 ET et l’autre au-delà de −2 ET', () => {
    const e = evaluateWestgard(run(2.2, -2.1), new Map());
    expect(e.status).toBe('REJECTED');
    expect(e.rules).toEqual(['R-4s']);
    expect(e.byTarget.get('L1')!.rules).toEqual(['R-4s']);
  });

  it('4-1s : quatre points consécutifs au-delà de 1 ET du même côté', () => {
    expect(evaluateWestgard(run(1.4), hist({ L1: [1.1, 1.8, 1.2] })).rules).toEqual(['4-1s']);
    expect(evaluateWestgard(run(1.4), hist({ L1: [1.1, 0.8, 1.2] })).status).toBe('ACCEPTED');
  });

  it('10x : dix points consécutifs du même côté de la moyenne ; il faut l’historique complet', () => {
    expect(evaluateWestgard(run(-0.3), hist({ L1: [-0.1, -0.5, -0.2, -0.9, -0.4, -0.3, -0.6, -0.2, -0.1] })).rules).toEqual(['10x']);
    expect(evaluateWestgard(run(-0.3), hist({ L1: [-0.1, -0.5, -0.2, -0.9, -0.4, -0.3, -0.6, -0.2] })).status).toBe('ACCEPTED');
    expect(evaluateWestgard(run(-0.3), hist({ L1: [-0.1, -0.5, -0.2, 0.9, -0.4, -0.3, -0.6, -0.2, -0.1] })).status).toBe('ACCEPTED');
  });

  it('plusieurs règles : rejet, règles triées par gravité', () => {
    const e = evaluateWestgard(run(3.2, 2.5), hist({ L2: [1.5, 1.2, 1.1] }));
    expect(e.status).toBe('REJECTED');
    expect(e.rules).toEqual(['1-3s', '2-2s', '4-1s']);
  });

  it('statistiques observées : moyenne, écart-type (n−1), CV', () => {
    const s = qcStatistics([5, 5.2, 4.8, 5.1, 4.9]);
    expect(s.n).toBe(5);
    expect(s.mean).toBeCloseTo(5);
    expect(s.sd).toBeCloseTo(0.1581, 3);
    expect(s.cv).toBeCloseTo(3.16, 1);
    expect(qcStatistics([4]).sd).toBeNull();
  });
});

describe('Bornes de période en heure locale', () => {
  it('minuit à Kinshasa (UTC+1) = 23 h UTC la veille', () => {
    expect(zonedStartOfDay('2026-11-22', 'Africa/Kinshasa').toISOString()).toBe('2026-11-21T23:00:00.000Z');
    expect(zonedStartOfDay('2026-11-22', 'Africa/Lubumbashi').toISOString()).toBe('2026-11-21T22:00:00.000Z');
  });
  it('la date de fin est incluse dans la période', () => {
    const p = zonedPeriod('2026-11-01', '2026-11-30', 'Africa/Kinshasa');
    expect(p.start.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-30T23:00:00.000Z');
  });
});

// -----------------------------------------------------------------------------
// Services
// -----------------------------------------------------------------------------

const D = (v: number) => new Prisma.Decimal(v);
const tech: RequestUser = { id: 'u-tech', username: 'tech', fullName: 'Tech', roles: ['TECHNICIEN'], mustChangePassword: false };
const caisse: RequestUser = { id: 'u-cai', username: 'cai', fullName: 'Caisse', roles: ['CAISSE'], mustChangePassword: false };
const qualite: RequestUser = { id: 'u-q', username: 'q', fullName: 'Qualité', roles: ['QUALITE'], mustChangePassword: false };

async function expectRule(p: Promise<unknown>, rule: string) {
  await expect(p).rejects.toBeInstanceOf(DomainException);
  await p.catch((e: DomainException) => expect((e.getResponse() as { details: { rule: string } }).details.rule).toBe(rule));
}

const tx = {
  qcRun: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  qualityIssue: { create: jest.fn(), update: jest.fn() },
  sample: { findUnique: jest.fn() },
  labOrder: { findUnique: jest.fn() },
  examParameter: { findMany: jest.fn(), findUnique: jest.fn().mockResolvedValue({ exam: { section: { id: 'sec', name: 'Biochimie' } } }) },
};
const prisma = { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
const lab = {
  settings: jest.fn().mockResolvedValue({ timezone: 'Africa/Kinshasa' }),
  userNames: jest.fn().mockResolvedValue(new Map()),
} as unknown as LabContextService;
const audit = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
const numbering = { qualityIssueNumber: jest.fn().mockResolvedValue('NC-2026-0001') } as unknown as NumberingService;

const parameter = { id: 'p1', code: 'GLY', name: 'Glucose', unit: 'g/L', decimals: 2, resultType: 'NUMERIC', isActive: true, exam: { code: 'GLY', name: 'Glycémie', section: { id: 's', name: 'Biochimie' } } };
const target = (id: string, level: string, mean: number, sd: number, expiresOn = '2027-12-31') => ({
  id,
  materialId: `m-${id}`,
  parameterId: 'p1',
  mean: D(mean),
  sd: D(sd),
  source: 'MANUFACTURER',
  isActive: true,
  updatedAt: new Date(),
  parameter,
  material: { id: `m-${id}`, name: 'Contrôle Chimie', lotNumber: 'LOT42', level, expiresOn: new Date(`${expiresOn}T00:00:00Z`), isActive: true },
});

const qcRepo = {
  lockParameter: jest.fn(),
  findParameter: jest.fn(),
  unresolvedRejected: jest.fn(),
  lastRun: jest.fn(),
  activeTargetsOf: jest.fn(),
  history: jest.fn(),
  latestRunsByParameter: jest.fn(),
} as unknown as jest.Mocked<QcRepository>;
const issuesService = { createFromQcRun: jest.fn() } as unknown as jest.Mocked<QualityIssuesService>;
const sectionAccess = { assertCanAct: jest.fn().mockResolvedValue(undefined) } as unknown as SectionAccessService;
const qc = new QcService(prisma, qcRepo, issuesService, lab, audit, sectionAccess);
// Le détail renvoyé après création n'est pas l'objet de ces tests
jest.spyOn(qc, 'getRun').mockResolvedValue({} as never);

describe('QcService – séries de contrôle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    qcRepo.findParameter.mockResolvedValue(parameter as never);
    qcRepo.unresolvedRejected.mockResolvedValue(null as never);
    qcRepo.lastRun.mockResolvedValue(null as never);
    qcRepo.activeTargetsOf.mockResolvedValue([target('t1', 'Niveau 1', 0.9, 0.05), target('t2', 'Niveau 2', 2.5, 0.1)] as never);
    qcRepo.history.mockResolvedValue(new Map() as never);
    tx.qcRun.create.mockResolvedValue({ id: 'run1' });
  });

  it('série acceptée : scores z et cibles figés, aucune fiche ouverte', async () => {
    await qc.createRun({ parameterId: 'p1', results: [{ targetId: 't1', value: 0.92 }, { targetId: 't2', value: 2.45 }] }, tech);
    expect(tx.qcRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'ACCEPTED',
        violatedRules: [],
        results: { create: [expect.objectContaining({ targetId: 't1', zScore: '0.4', mean: '0.9', sd: '0.05' }), expect.objectContaining({ targetId: 't2', zScore: '-0.5' })] },
      }),
    });
    expect(issuesService.createFromQcRun).not.toHaveBeenCalled();
    expect(qcRepo.lockParameter).toHaveBeenCalledWith('p1', tx);
  });

  it('série rejetée : fiche de non-conformité ouverte automatiquement dans la même transaction', async () => {
    await qc.createRun({ parameterId: 'p1', results: [{ targetId: 't1', value: 1.08 }, { targetId: 't2', value: 2.5 }] }, tech);
    expect(tx.qcRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'REJECTED', violatedRules: ['1-3s'] }) });
    expect(issuesService.createFromQcRun).toHaveBeenCalledWith(tx, expect.objectContaining({ runId: 'run1', rules: ['1-3s'] }), tech);
  });

  it('l’historique du niveau est pris en compte (2-2s sur deux séries)', async () => {
    qcRepo.history.mockResolvedValue(new Map([['t2', [2.3]]]) as never);
    await qc.createRun({ parameterId: 'p1', results: [{ targetId: 't2', value: 2.73 }] }, tech);
    expect(tx.qcRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'REJECTED', violatedRules: ['2-2s'] }) });
  });

  it('nouvelle série refusée tant que l’action corrective d’un rejet n’est pas documentée', async () => {
    qcRepo.unresolvedRejected.mockResolvedValue({ performedAt: new Date() } as never);
    await expectRule(qc.createRun({ parameterId: 'p1', results: [{ targetId: 't1', value: 0.9 }] }, tech), 'QC_ACTION_REQUIRED');
  });

  it('heure de passage antérieure à la dernière série refusée', async () => {
    qcRepo.lastRun.mockResolvedValue({ performedAt: new Date() } as never);
    await expectRule(
      qc.createRun({ parameterId: 'p1', performedAt: new Date(Date.now() - 3600_000).toISOString(), results: [{ targetId: 't1', value: 0.9 }] }, tech),
      'QC_OUT_OF_ORDER',
    );
  });

  it('niveau inconnu ou lot périmé : 400 ciblé sur le niveau', async () => {
    qcRepo.activeTargetsOf.mockResolvedValue([target('t1', 'Niveau 1', 0.9, 0.05, '2020-01-31')] as never);
    const p = qc.createRun({ parameterId: 'p1', results: [{ targetId: 't1', value: 0.9 }, { targetId: 'tX', value: 1 }] }, tech);
    await expect(p).rejects.toBeInstanceOf(DomainException);
    await p.catch((e: DomainException) => {
      const body = e.getResponse() as { details: { path: string; message: string }[] };
      expect(body.details.map((d) => d.path)).toEqual(['results.0.targetId', 'results.1.targetId']);
      expect(body.details[0].message).toMatch(/périmé/);
    });
    expect(tx.qcRun.create).not.toHaveBeenCalled();
  });

  it('garde de validation : bloque si la dernière série d’un paramètre est rejetée', async () => {
    qcRepo.latestRunsByParameter.mockResolvedValue([{ parameterId: 'p1', status: 'REJECTED' }, { parameterId: 'p2', status: 'ACCEPTED' }] as never);
    tx.examParameter.findMany.mockResolvedValue([{ name: 'Glucose' }]);
    await expectRule(qc.assertQcAllowsValidation(tx as never, ['p1', 'p2']), 'QC_REJECTED');
    qcRepo.latestRunsByParameter.mockResolvedValue([{ parameterId: 'p1', status: 'WARNING' }] as never);
    await expect(qc.assertQcAllowsValidation(tx as never, ['p1'])).resolves.toBeUndefined();
  });

  it('action corrective : seulement sur une série rejetée non encore résolue', async () => {
    tx.qcRun.findUnique.mockResolvedValue({ id: 'r', parameterId: 'p1', status: 'ACCEPTED' });
    await expectRule(qc.recordCorrectiveAction('r', { correctiveAction: 'Recalibration effectuée' }, tech), 'QC_NOT_REJECTED');
    tx.qcRun.findUnique.mockResolvedValue({ id: 'r', parameterId: 'p1', status: 'REJECTED', resolvedAt: new Date() });
    await expectRule(qc.recordCorrectiveAction('r', { correctiveAction: 'Recalibration effectuée' }, tech), 'QC_ALREADY_RESOLVED');
  });
});

describe('QualityIssuesService – cycle de vie', () => {
  const issueRepo = { lock: jest.fn(), find: jest.fn(), list: jest.fn() } as unknown as jest.Mocked<QualityIssuesRepository>;
  const service = new QualityIssuesService(prisma, issueRepo, numbering, lab, audit);
  const row = (o: Record<string, unknown> = {}) => ({
    id: 'i1',
    number: 'NC-2026-0001',
    status: 'OPEN',
    declaredById: 'u-cai',
    qcRunId: null,
    actionDueDate: null,
    detectedAt: new Date(),
    declaredAt: new Date(),
    order: null,
    sample: null,
    ...o,
  });

  beforeEach(() => jest.clearAllMocks());

  it('un rôle sans accès global ne voit que ses propres déclarations', async () => {
    issueRepo.list.mockResolvedValue([[], 0] as never);
    await service.list({ page: 1, pageSize: 20 }, caisse);
    expect(issueRepo.list).toHaveBeenCalledWith(expect.anything(), 'u-cai', expect.any(Date));
    await service.list({ page: 1, pageSize: 20 }, qualite);
    expect(issueRepo.list).toHaveBeenLastCalledWith(expect.anything(), null, expect.any(Date));
    issueRepo.find.mockResolvedValue(row({ declaredById: 'someone-else' }) as never);
    await expect(service.get('i1', caisse)).rejects.toMatchObject({ status: 404 });
  });

  it('déclaration : n° d’échantillon inconnu → 400 ciblé', async () => {
    tx.sample.findUnique.mockResolvedValue(null);
    const p = service.create(
      { title: 'Tube mal étiqueté', category: 'PRE_ANALYTICAL', severity: 'MINOR', description: 'Étiquette illisible à la réception', detectedAt: new Date().toISOString(), sampleNumber: '2611229999' },
      caisse,
    );
    await expect(p).rejects.toBeInstanceOf(DomainException);
    await p.catch((e: DomainException) => expect((e.getResponse() as { details: { path: string }[] }).details[0].path).toBe('sampleNumber'));
  });

  it('plan d’action : échéance passée refusée', async () => {
    issueRepo.find.mockResolvedValue(row() as never);
    await expectRule(service.plan('i1', { rootCause: 'Formation', correctiveAction: 'Former', actionOwner: 'Chef', actionDueDate: '2020-01-01' }, qualite), 'ACTION_DUE_IN_PAST');
  });

  it('clôture : impossible sans plan d’action, ni tant que l’action corrective du CIQ manque', async () => {
    issueRepo.find.mockResolvedValue(row() as never);
    await expectRule(service.close('i1', { effectivenessCheck: 'Aucune récidive sur 30 jours' }, qualite), 'ISSUE_NOT_IN_PROGRESS');
    issueRepo.find.mockResolvedValue(row({ status: 'IN_PROGRESS', qcRunId: 'run1' }) as never);
    tx.qcRun.findUnique.mockResolvedValue({ resolvedAt: null, excludedAt: null });
    await expectRule(service.close('i1', { effectivenessCheck: 'Aucune récidive sur 30 jours' }, qualite), 'QC_ACTION_PENDING');
  });

  it('une fiche issue d’un CIQ rejeté ne peut pas être annulée', async () => {
    issueRepo.find.mockResolvedValue(row({ qcRunId: 'run1' }) as never);
    await expectRule(service.cancel('i1', { reason: 'Erreur de déclaration' }, qualite), 'QC_ISSUE_NOT_CANCELLABLE');
  });
});
