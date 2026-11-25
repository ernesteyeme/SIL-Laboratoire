import { computeResultFlag, parseNumericInput, type RangeSnapshot } from '@lims/shared';
import { Prisma } from '../../generated/prisma/client';
import type { AuditService } from '../../core/audit/audit.service';
import type { LabContextService } from '../../core/common/lab-context.service';
import { isSectionScoped } from '@lims/shared';
import { SectionAccessService } from '../../core/security/section-access.service';
import type { RequestUser } from '../../core/context/request-context';
import { DomainException } from '../../core/errors/domain.exception';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { OrdersService } from '../orders/orders.service';
import type { QcService } from '../quality/qc.service';
import type { ReportsService } from './reports.service';
import type { ResultsRepository } from './results.repository';
import { ResultsService } from './results.service';

const D = (v: number) => new Prisma.Decimal(v);
const range: RangeSnapshot = { low: 12, high: 16, criticalLow: 7, criticalHigh: 20, normalText: null };

describe('Interprétation des résultats', () => {
  it('lit les saisies numériques françaises et les limites de détection', () => {
    expect(parseNumericInput('12,5')).toEqual({ value: 12.5, qualifier: null });
    expect(parseNumericInput(' < 40 ')).toEqual({ value: 40, qualifier: '<' });
    expect(parseNumericInput('1 250 000')).toEqual({ value: 1250000, qualifier: null });
    expect(parseNumericInput('>10000000')).toEqual({ value: 10000000, qualifier: '>' });
    expect(parseNumericInput('douze')).toBeNull();
    expect(parseNumericInput('12,5,3')).toBeNull();
  });

  it('classe bas / normal / élevé / critique', () => {
    const f = (v: number) => computeResultFlag('NUMERIC', { numeric: { value: v, qualifier: null } }, range);
    expect(f(6.5)).toBe('CRITICAL_LOW');
    expect(f(10)).toBe('LOW');
    expect(f(14)).toBe('NORMAL');
    expect(f(17)).toBe('HIGH');
    expect(f(21)).toBe('CRITICAL_HIGH');
  });

  it('interprète « < x » sur le seul seuil bas et « > x » sur le seul seuil haut', () => {
    expect(computeResultFlag('NUMERIC', { numeric: { value: 40, qualifier: '<' } }, { ...range, low: null, high: 1000, criticalLow: null, criticalHigh: null })).toBe('NORMAL');
    expect(computeResultFlag('NUMERIC', { numeric: { value: 5, qualifier: '<' } }, range)).toBe('CRITICAL_LOW');
    expect(computeResultFlag('NUMERIC', { numeric: { value: 18, qualifier: '>' } }, range)).toBe('HIGH');
  });

  it('marque « Anormal » un qualitatif différent de la valeur attendue, sans référence → pas d’interprétation', () => {
    const qual: RangeSnapshot = { low: null, high: null, criticalLow: null, criticalHigh: null, normalText: 'Négatif' };
    expect(computeResultFlag('CHOICE', { text: 'négatif' }, qual)).toBe('NORMAL');
    expect(computeResultFlag('CHOICE', { text: 'Positif' }, qual)).toBe('ABNORMAL');
    expect(computeResultFlag('NUMERIC', { numeric: { value: 3, qualifier: null } }, null)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Service : flux saisie → validation technique → validation biologique
// -----------------------------------------------------------------------------

function result(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1', orderItemId: 'i1', parameterId: 'par1', parameterCode: 'HB', parameterName: 'Hémoglobine', unit: 'g/dL',
    resultType: 'NUMERIC', decimals: 1, choices: [], displayOrder: 1,
    numericValue: null, qualifier: null, textValue: null, flag: null, comment: null, enteredById: null, enteredAt: null,
    hasReference: true, refLow: D(12), refHigh: D(16), refCriticalLow: D(7), refCriticalHigh: D(20),
    refNormalText: null, refComment: null, refLabel: 'Femme, tout âge',
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1', orderId: 'o1', examCode: 'NFS', examName: 'Numération', analysisStatus: 'TO_ENTER', version: 1,
    technicalValidatedAt: null, technicalValidatedById: null, validatedAt: null, validatedById: null, biologistComment: null,
    sample: { number: '2611220001', receivedAt: new Date(), hasReservation: false, nonConformities: [], sampleType: { name: 'Sang EDTA' } },
    exam: { turnaroundHours: 24, section: { id: 'sec', name: 'Hématologie', displayOrder: 1 } },
    results: [result()],
    alerts: [] as unknown[],
    amendments: [],
    order: { id: 'o1', number: 'DEM-2026-000001', status: 'IN_PROGRESS', patientId: 'p1', patient: {} },
    ...overrides,
  };
}

const tx = {
  testResult: { update: jest.fn(), findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
  orderItem: { update: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  criticalAlert: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  resultAmendment: { create: jest.fn() },
};
const prisma = { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
const repo = {
  lockItem: jest.fn(),
  findItemWithOrder: jest.fn(),
  findSampleForInit: jest.fn(),
  previousResults: jest.fn().mockResolvedValue(new Map()),
  latestReport: jest.fn(),
} as unknown as jest.Mocked<ResultsRepository>;
const orders = { refreshStatus: jest.fn() } as unknown as OrdersService;
const reports = { issue: jest.fn().mockResolvedValue('rep1') } as unknown as jest.Mocked<ReportsService>;
const lab = { settings: jest.fn().mockResolvedValue({ timezone: 'Africa/Kinshasa' }), userNames: jest.fn().mockResolvedValue(new Map()) } as unknown as LabContextService;
const audit = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
const qc = { assertQcAllowsValidation: jest.fn() } as unknown as jest.Mocked<QcService>;
const sectionAccess = new SectionAccessService(prisma);
const allowed = new Map<string, string[]>([['u-tech', ['sec']], ['u-bio', ['sec']], ['u-tech-bioch', ['sec-bioch']]]);
jest.spyOn(sectionAccess, 'allowedSections').mockImplementation(async (a) => (isSectionScoped(a.roles) ? new Set(allowed.get(a.id) ?? []) : null));
const service = new ResultsService(prisma, repo, orders, reports, lab, audit, qc, sectionAccess);
const tech: RequestUser = { id: 'u-tech', username: 'tech', fullName: 'Tech', roles: ['TECHNICIEN'] } as RequestUser;
const bio: RequestUser = { id: 'u-bio', username: 'bio', fullName: 'Bio', roles: ['BIOLOGISTE'] } as RequestUser;

async function expectRule(p: Promise<unknown>, rule: string) {
  await expect(p).rejects.toBeInstanceOf(DomainException);
  await p.catch((e: DomainException) => expect((e.getResponse() as { details: { rule: string } }).details.rule).toBe(rule));
}

describe('ResultsService – règles analytiques', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.previousResults.mockResolvedValue(new Map() as never);
  });

  it('refuse une valeur non numérique en indiquant le résultat concerné', async () => {
    repo.findItemWithOrder.mockResolvedValue(item() as never);
    const p = service.save('i1', { results: [{ resultId: 'r1', value: 'douze' }] }, tech);
    await expect(p).rejects.toBeInstanceOf(DomainException);
    await p.catch((e: DomainException) => {
      const body = e.getResponse() as { details: { path: string }[] };
      expect(body.details[0].path).toBe('r1');
    });
    expect(tx.testResult.update).not.toHaveBeenCalled();
  });

  it('interprète la valeur, ouvre une alerte critique et passe l’examen en « Saisi »', async () => {
    repo.findItemWithOrder.mockResolvedValue(item() as never);
    tx.testResult.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(result({ ...data, numericValue: data.numericValue ? D(Number(data.numericValue)) : null })),
    );
    tx.criticalAlert.findFirst.mockResolvedValue(null);
    tx.criticalAlert.create.mockResolvedValue({ id: 'a1' });
    tx.testResult.findMany.mockResolvedValue([result({ numericValue: D(6.2) })]);

    await service.save('i1', { results: [{ resultId: 'r1', value: '6,2' }] }, tech);

    expect(tx.testResult.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ flag: 'CRITICAL_LOW', numericValue: '6.2' }) }));
    expect(tx.criticalAlert.create).toHaveBeenCalledWith({ data: expect.objectContaining({ flag: 'CRITICAL_LOW', valueText: '6,2 g/dL' }) });
    expect(tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { analysisStatus: 'ENTERED' } });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ entity: 'Result' }));
  });

  it('annule l’alerte devenue sans objet quand la valeur est corrigée avant communication', async () => {
    repo.findItemWithOrder.mockResolvedValue(item({ analysisStatus: 'ENTERED', results: [result({ numericValue: D(6.2), flag: 'CRITICAL_LOW' })] }) as never);
    tx.testResult.update.mockResolvedValue(result({ numericValue: D(13), flag: 'NORMAL' }));
    tx.criticalAlert.findFirst.mockResolvedValue({ id: 'a1', valueText: '6,2 g/dL' });
    tx.testResult.findMany.mockResolvedValue([result({ numericValue: D(13) })]);

    await service.save('i1', { results: [{ resultId: 'r1', value: '13' }] }, tech);

    expect(tx.criticalAlert.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { cancelledAt: expect.any(Date) } });
    expect(tx.criticalAlert.create).not.toHaveBeenCalled();
  });

  it('interdit la modification de résultats validés techniquement ou biologiquement', async () => {
    repo.findItemWithOrder.mockResolvedValue(item({ analysisStatus: 'TECHNICAL_VALIDATED' }) as never);
    await expectRule(service.save('i1', { results: [{ resultId: 'r1', value: '13' }] }, tech), 'ITEM_TECHNICALLY_VALIDATED');
    repo.findItemWithOrder.mockResolvedValue(item({ analysisStatus: 'VALIDATED' }) as never);
    await expectRule(service.save('i1', { results: [{ resultId: 'r1', value: '13' }] }, tech), 'ITEM_VALIDATED');
  });

  it('exige des résultats complets pour la validation technique', async () => {
    repo.findItemWithOrder.mockResolvedValue(item() as never);
    await expectRule(service.technicalValidate('i1', tech), 'RESULTS_INCOMPLETE');
  });

  it('impose la validation technique avant la validation biologique', async () => {
    repo.findItemWithOrder.mockResolvedValue(item({ analysisStatus: 'ENTERED' }) as never);
    await expectRule(service.biologicalValidate('i1', {}, bio), 'TECHNICAL_VALIDATION_REQUIRED');
  });

  it('bloque la validation biologique tant qu’une valeur critique n’est pas communiquée', async () => {
    repo.findItemWithOrder.mockResolvedValue(
      item({
        analysisStatus: 'TECHNICAL_VALIDATED',
        results: [result({ numericValue: D(6.2), flag: 'CRITICAL_LOW' })],
        alerts: [{ id: 'a1', acknowledgedAt: null, valueText: '6,2 g/dL', result: { parameterName: 'Hémoglobine' } }],
      }) as never,
    );
    await expectRule(service.biologicalValidate('i1', {}, bio), 'CRITICAL_NOT_COMMUNICATED');
    expect(reports.issue).not.toHaveBeenCalled();
  });

  it('émet automatiquement le compte rendu définitif quand tous les examens sont validés', async () => {
    repo.findItemWithOrder.mockResolvedValue(item({ analysisStatus: 'TECHNICAL_VALIDATED', results: [result({ numericValue: D(13), flag: 'NORMAL' })] }) as never);
    tx.orderItem.findMany.mockResolvedValue([{ analysisStatus: 'VALIDATED' }, { analysisStatus: 'VALIDATED' }]);
    repo.latestReport.mockResolvedValue(null as never);
    await service.biologicalValidate('i1', { comment: 'RAS' }, bio);
    expect(reports.issue).toHaveBeenCalledWith(tx, 'o1', 'FINAL', bio);
  });

  it('émet un rectificatif si un compte rendu définitif existe déjà, rien si d’autres examens restent à valider', async () => {
    repo.findItemWithOrder.mockResolvedValue(item({ analysisStatus: 'TECHNICAL_VALIDATED', version: 2, results: [result({ numericValue: D(13) })] }) as never);
    tx.orderItem.findMany.mockResolvedValue([{ analysisStatus: 'VALIDATED' }]);
    repo.latestReport.mockResolvedValue({ kind: 'FINAL' } as never);
    await service.biologicalValidate('i1', {}, bio);
    expect(reports.issue).toHaveBeenCalledWith(tx, 'o1', 'AMENDED', bio);

    reports.issue.mockClear();
    tx.orderItem.findMany.mockResolvedValue([{ analysisStatus: 'VALIDATED' }, { analysisStatus: 'ENTERED' }]);
    await service.biologicalValidate('i1', {}, bio);
    expect(reports.issue).not.toHaveBeenCalled();
  });

  it('archive les valeurs validées et incrémente la version lors d’une correction', async () => {
    repo.findItemWithOrder.mockResolvedValue(
      item({ analysisStatus: 'VALIDATED', validatedById: 'u-bio', validatedAt: new Date(), results: [result({ numericValue: D(13), flag: 'NORMAL' })] }) as never,
    );
    await service.amend('i1', { reason: 'Erreur de transcription' }, bio);
    expect(tx.resultAmendment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromVersion: 1, reason: 'Erreur de transcription', previousResults: expect.objectContaining({ results: [expect.objectContaining({ value: '13,0' })] }) }),
    });
    expect(tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: expect.objectContaining({ analysisStatus: 'ENTERED', version: 2, validatedAt: null }) });
  });

  it('refuse le rejet d’un échantillon dont des résultats sont saisis', async () => {
    repo.findSampleForInit.mockResolvedValue({ items: [{ id: 'i1', examCode: 'NFS', analysisStatus: 'ENTERED', results: [{ id: 'r1', enteredAt: new Date() }] }] } as never);
    await expectRule(service.resetForSample(tx as never, 's1'), 'SAMPLE_HAS_RESULTS');
  });

  it('fige à la réception la plage du sexe et de l’âge ; sans date de naissance, seulement les plages tout âge', async () => {
    const parameter = {
      id: 'par1', code: 'HB', name: 'Hémoglobine', unit: 'g/dL', resultType: 'NUMERIC', decimals: 1, choices: [], displayOrder: 1,
      referenceRanges: [
        { sex: 'FEMALE', ageMinDays: 0, ageMaxDays: null, low: D(12), high: D(16), criticalLow: D(7), criticalHigh: D(20), normalText: null, comment: null },
        { sex: 'ANY', ageMinDays: 0, ageMaxDays: 365, low: D(10), high: D(14), criticalLow: null, criticalHigh: null, normalText: null, comment: null },
      ],
    };
    const sampleRow = (birthDate: Date | null) => ({
      collectedAt: new Date('2026-11-22T08:00:00Z'),
      receivedAt: new Date('2026-11-22T09:00:00Z'),
      order: { patient: { sex: 'FEMALE', birthDate } },
      items: [{ id: 'i1', analysisStatus: 'AWAITING_SAMPLE', results: [], exam: { parameters: [parameter] } }],
    });

    repo.findSampleForInit.mockResolvedValue(sampleRow(new Date('1990-05-01')) as never);
    await service.initializeForSample(tx as never, 's1');
    expect(tx.testResult.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ hasReference: true, refLow: D(12), refLabel: expect.stringMatching(/^Femme/) })] });
    expect(tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { analysisStatus: 'TO_ENTER' } });

    tx.testResult.createMany.mockClear();
    repo.findSampleForInit.mockResolvedValue(sampleRow(null) as never);
    await service.initializeForSample(tx as never, 's1');
    expect(tx.testResult.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ refLow: D(12) })] });
  });
});

describe('ResultsService – habilitations par service', () => {
  const techBioch: RequestUser = { id: 'u-tech-bioch', username: 'tb', fullName: 'Tech Biochimie', roles: ['TECHNICIEN'] } as RequestUser;

  it('refuse la saisie et les validations hors des services attribués (403)', async () => {
    repo.findItemWithOrder.mockResolvedValue(item() as never);
    for (const p of [
      service.save('i1', { results: [] }, techBioch),
      service.technicalValidate('i1', techBioch),
      service.amend('i1', { reason: 'Erreur de saisie' }, techBioch),
    ]) {
      await expect(p).rejects.toMatchObject({ status: 403 });
      await p.catch((e: DomainException) => expect((e.getResponse() as { details: { rule: string } }).details.rule).toBe('SECTION_NOT_AUTHORIZED'));
    }
  });

  it('un compte de service d’automate (sans rôle) n’est pas limité à un service', async () => {
    const instrument = { id: 'svc', username: 'automate-xn', fullName: 'Automate', roles: [] } as unknown as RequestUser;
    await expect(sectionAccess.allowedSections(instrument)).resolves.toBeNull();
  });
});
