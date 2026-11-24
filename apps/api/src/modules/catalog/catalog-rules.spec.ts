import type { ReferenceRangeInput } from '@lims/shared';
import type { AuditService } from '../../core/audit/audit.service';
import type { RequestUser } from '../../core/context/request-context';
import { DomainException } from '../../core/errors/domain.exception';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { CatalogRepository } from './catalog.repository';
import { ExamsService } from './exams.service';
import { ParametersService } from './parameters.service';

const tx = { tx: true };
const prisma = { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;

function decimal(v: number) {
  return { toFixed: (dp: number) => v.toFixed(dp), toNumber: () => v };
}

function exam(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    code: 'GLY',
    name: 'Glycémie',
    shortName: null,
    sectionId: 's1',
    sampleTypeId: 't1',
    price: decimal(5000),
    turnaroundHours: 4,
    patientInstructions: null,
    displayOrder: 0,
    isActive: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    section: { id: 's1', code: 'BIOCH', name: 'Biochimie' },
    sampleType: { id: 't1', code: 'SER', name: 'Sérum', container: null },
    _count: { parameters: 0 },
    parameters: [],
    ...overrides,
  };
}

async function expectRule(p: Promise<unknown>, rule: string) {
  await expect(p).rejects.toBeInstanceOf(DomainException);
  await p.catch((e: DomainException) => expect((e.getResponse() as { details: { rule: string } }).details.rule).toBe(rule));
}

const biologist: RequestUser = { id: 'u1', username: 'bio', fullName: 'Bio', roles: ['BIOLOGISTE'], mustChangePassword: false };

describe('ExamsService – règles', () => {
  const repo = {
    lock: jest.fn(),
    findExam: jest.fn(),
    updateExam: jest.fn((_id: string, data: Record<string, unknown>) =>
      Promise.resolve(exam({ ...data, price: decimal(Number(data.price ?? 5000)) })),
    ),
    countActiveParameters: jest.fn(),
    findSection: jest.fn().mockResolvedValue({ id: 's1', name: 'Biochimie', isActive: true }),
    findSampleType: jest.fn().mockResolvedValue({ id: 't1', name: 'Sérum', isActive: true }),
  } as unknown as jest.Mocked<CatalogRepository>;
  const service = new ExamsService(prisma, repo, audit);

  beforeEach(() => jest.clearAllMocks());

  it('refuse l’activation d’un examen sans paramètre actif', async () => {
    repo.findExam.mockResolvedValue(exam() as never);
    repo.countActiveParameters.mockResolvedValue(0);
    await expectRule(service.update('e1', { isActive: true, reason: 'Mise en service' }, biologist), 'EXAM_WITHOUT_PARAMETERS');
  });

  it('refuse à un biologiste la modification du tarif', async () => {
    repo.findExam.mockResolvedValue(exam() as never);
    await expectRule(service.update('e1', { price: '7500' }, biologist), 'PRICE_CHANGE_ADMIN_ONLY');
  });

  it('autorise au biologiste un tarif inchangé (formulaire complet renvoyé)', async () => {
    repo.findExam.mockResolvedValue(exam() as never);
    await service.update('e1', { price: '5000', name: 'Glycémie à jeun' }, biologist);
    expect(repo.updateExam).toHaveBeenCalled();
  });

  it('refuse l’activation si la section est désactivée', async () => {
    repo.findExam.mockResolvedValue(exam() as never);
    repo.findSection.mockResolvedValueOnce({ id: 's1', name: 'Biochimie', isActive: false } as never);
    await expectRule(service.update('e1', { isActive: true, reason: 'Mise en service' }, biologist), 'SECTION_INACTIVE');
  });
});

describe('ParametersService – valeurs de référence', () => {
  const numericParam = {
    id: 'p1',
    examId: 'e1',
    code: 'HB',
    resultType: 'NUMERIC',
    choices: [],
    exam: { id: 'e1', isActive: true, code: 'NFS' },
    referenceRanges: [{ id: 'r1', sex: 'MALE', ageMinDays: 6575, ageMaxDays: null }],
  };
  const choiceParam = { ...numericParam, id: 'p2', resultType: 'CHOICE', choices: ['Positif', 'Négatif'], referenceRanges: [] };
  const repo = {
    lock: jest.fn(),
    findParameter: jest.fn(),
    createRange: jest.fn((d: Record<string, unknown>) =>
      Promise.resolve({
        id: 'new',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...d,
        ...Object.fromEntries(
          ['low', 'high', 'criticalLow', 'criticalHigh'].map((k) => [k, d[k] == null ? null : decimal(d[k] as number)]),
        ),
      }),
    ),
    countActiveParameters: jest.fn(),
  } as unknown as jest.Mocked<CatalogRepository>;
  const service = new ParametersService(prisma, repo, audit);

  const range = (o: Partial<ReferenceRangeInput>): ReferenceRangeInput => ({
    sex: 'ANY',
    ageMinDays: 0,
    ageMaxDays: null,
    low: null,
    high: null,
    criticalLow: null,
    criticalHigh: null,
    normalText: null,
    comment: null,
    ...o,
  });

  beforeEach(() => jest.clearAllMocks());

  it('refuse un chevauchement de tranche d’âge pour le même sexe', async () => {
    repo.findParameter.mockResolvedValue(numericParam as never);
    await expectRule(service.createRange('p1', range({ sex: 'MALE', ageMinDays: 10000, low: 13, high: 17 })), 'RANGE_OVERLAP');
  });

  it('accepte une plage féminine sur la même tranche', async () => {
    repo.findParameter.mockResolvedValue(numericParam as never);
    await service.createRange('p1', range({ sex: 'FEMALE', ageMinDays: 6575, low: 12, high: 16 }));
    expect(repo.createRange).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'CREATE', entity: 'ReferenceRange' }));
  });

  it('refuse une valeur normale absente de la liste de choix', async () => {
    repo.findParameter.mockResolvedValue(choiceParam as never);
    await expectRule(service.createRange('p2', range({ normalText: 'Douteux' })), 'NORMAL_TEXT_NOT_IN_CHOICES');
  });

  it('refuse des bornes numériques sur un paramètre à choix', async () => {
    repo.findParameter.mockResolvedValue(choiceParam as never);
    await expectRule(service.createRange('p2', range({ low: 1, normalText: 'Négatif' })), 'NUMERIC_ON_TEXT');
  });

  it('exige un motif pour modifier une valeur de référence', async () => {
    await expectRule(service.updateRange('r1', range({ low: 1 })), 'REASON_REQUIRED');
  });

  it('refuse de désactiver le dernier paramètre actif d’un examen actif', async () => {
    repo.findParameter.mockResolvedValue({ ...numericParam, isActive: true } as never);
    repo.countActiveParameters.mockResolvedValue(0);
    await expectRule(service.update('p1', { isActive: false, reason: 'Paramètre obsolète' }), 'LAST_ACTIVE_PARAMETER');
  });
});
