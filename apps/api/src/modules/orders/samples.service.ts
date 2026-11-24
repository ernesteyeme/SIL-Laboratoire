import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  NON_CONFORMITY_TYPE_LABELS,
  type CollectSampleInput,
  type ListSamplesQuery,
  type NonConformityInput,
  type Paginated,
  type RecollectInput,
  type SampleContextDto,
} from '@lims/shared';
import type { Sample } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, DomainException, NotFoundError } from '../../core/errors/domain.exception';
import { NumberingService } from '../../core/numbering/numbering.service';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { sampleUserIds, toSampleContext } from './orders.mapper';
import { OrdersRepository, type SampleContextRow } from './orders.repository';
import { ResultsService } from '../results/results.service';
import { OrdersService } from './orders.service';

function sampleAuditView(s: Sample) {
  return {
    number: s.number,
    status: s.status,
    collectedAt: s.collectedAt,
    collectedById: s.collectedById,
    receivedAt: s.receivedAt,
    receivedById: s.receivedById,
    hasReservation: s.hasReservation,
    rejectedAt: s.rejectedAt,
    replacesId: s.replacesId,
  };
}

/** Rôles habilités à accepter un échantillon non conforme par dérogation (ISO 15189 §7.2.6). */
const DEROGATION_ROLES = ['BIOLOGISTE', 'ADMIN'] as const;

@Injectable()
export class SamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: OrdersRepository,
    private readonly orders: OrdersService,
    private readonly numbering: NumberingService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
    private readonly results: ResultsService,
  ) {}

  async list(query: ListSamplesQuery): Promise<Paginated<SampleContextDto>> {
    const [rows, total] = await this.repo.listSamples(query);
    const names = await this.lab.userNames(sampleUserIds(rows));
    return toPage(rows.map((r) => toSampleContext(r, names)), total, query);
  }

  /** Lecture par code-barres (douchette) ou par identifiant. */
  async getByNumber(number: string): Promise<SampleContextDto> {
    const sample = await this.repo.findSampleContext({ number: number.trim() });
    if (!sample) throw new NotFoundError('Échantillon', number);
    return this.toContext(sample);
  }

  async collect(id: string, input: CollectSampleInput, actor: RequestUser): Promise<SampleContextDto> {
    await this.prisma.$transaction(async (tx) => {
      const sample = await this.lockAndLoad(id, tx);
      this.assertOrderActive(sample);
      if (sample.status !== 'PENDING_COLLECTION') {
        throw new BusinessRuleError('SAMPLE_NOT_PENDING', 'Cet échantillon a déjà été prélevé.');
      }
      const settings = await this.lab.settings(tx);
      if (settings.requirePaymentBeforeCollection && sample.order.priority !== 'URGENT') {
        const invoice = await tx.invoice.findUnique({ where: { orderId: sample.orderId }, select: { status: true } });
        if (invoice && invoice.status !== 'PAID') {
          throw new BusinessRuleError(
            'PAYMENT_REQUIRED',
            'Le paiement doit être réglé avant le prélèvement (paramètre du laboratoire). Les demandes urgentes en sont dispensées.',
          );
        }
      }
      const next = await this.repo.updateSample(
        id,
        { status: 'COLLECTED', collectedAt: input.collectedAt ?? new Date(), collectedById: actor.id },
        tx,
      );
      await this.orders.refreshStatus(tx, sample.orderId);
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Sample',
        entityId: id,
        before: sampleAuditView(sample),
        after: sampleAuditView(next),
        reason: 'Prélèvement',
      });
    });
    return this.getById(id);
  }

  async receive(id: string, actor: RequestUser): Promise<SampleContextDto> {
    await this.prisma.$transaction(async (tx) => {
      const sample = await this.lockAndLoad(id, tx);
      this.assertOrderActive(sample);
      if (sample.status === 'PENDING_COLLECTION') {
        throw new BusinessRuleError('SAMPLE_NOT_COLLECTED', 'Cet échantillon n’a pas encore été enregistré comme prélevé.');
      }
      if (sample.status !== 'COLLECTED') {
        throw new BusinessRuleError('SAMPLE_ALREADY_PROCESSED', 'Cet échantillon a déjà été reçu ou refusé.');
      }
      const next = await this.repo.updateSample(id, { status: 'RECEIVED', receivedAt: new Date(), receivedById: actor.id }, tx);
      await this.results.initializeForSample(tx, id);
      await this.orders.refreshStatus(tx, sample.orderId);
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Sample',
        entityId: id,
        before: sampleAuditView(sample),
        after: sampleAuditView(next),
        reason: 'Réception conforme au laboratoire',
      });
    });
    return this.getById(id);
  }

  /**
   * Non-conformité pré-analytique :
   *  - REFUS : l'échantillon est refusé, un nouveau prélèvement devra être demandé ;
   *  - DÉROGATION (biologiste) : l'échantillon est accepté avec une réserve à reporter sur le compte rendu.
   */
  async recordNonConformity(id: string, input: NonConformityInput, actor: RequestUser): Promise<SampleContextDto> {
    if (input.decision === 'ACCEPTED_WITH_RESERVATION' && !actor.roles.some((r) => (DEROGATION_ROLES as readonly string[]).includes(r))) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.ACCESS_DENIED,
        'Seul un biologiste peut accepter un échantillon non conforme par dérogation.',
        { rule: 'DEROGATION_BIOLOGIST_ONLY' },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const sample = await this.lockAndLoad(id, tx);
      this.assertOrderActive(sample);
      if (sample.status !== 'COLLECTED' && sample.status !== 'RECEIVED') {
        throw new BusinessRuleError(
          'SAMPLE_NOT_AT_LAB',
          sample.status === 'REJECTED' ? 'Cet échantillon est déjà refusé.' : 'Cet échantillon n’a pas encore été prélevé.',
        );
      }
      const nc = await this.repo.createNonConformity(
        { sampleId: id, type: input.type, decision: input.decision, comment: input.comment ?? null, recordedById: actor.id },
        tx,
      );
      const now = new Date();
      const next = await this.repo.updateSample(
        id,
        input.decision === 'REJECTED'
          ? { status: 'REJECTED', rejectedAt: now }
          : {
              status: 'RECEIVED',
              hasReservation: true,
              receivedAt: sample.receivedAt ?? now,
              receivedById: sample.receivedById ?? actor.id,
            },
        tx,
      );
      if (input.decision === 'REJECTED') await this.results.resetForSample(tx, id);
      else await this.results.initializeForSample(tx, id);
      await this.orders.refreshStatus(tx, sample.orderId);
      const label = NON_CONFORMITY_TYPE_LABELS[input.type];
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'NonConformity',
        entityId: nc.id,
        after: { sample: sample.number, type: nc.type, decision: nc.decision, comment: nc.comment },
        reason: label,
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Sample',
        entityId: id,
        before: sampleAuditView(sample),
        after: sampleAuditView(next),
        reason: input.decision === 'REJECTED' ? `Refus : ${label}` : `Dérogation : ${label} — ${input.comment}`,
      });
    });
    return this.getById(id);
  }

  /** Nouveau prélèvement après refus : nouvel échantillon (nouveau code-barres), les examens y sont transférés. */
  async recollect(id: string, input: RecollectInput): Promise<SampleContextDto> {
    const newId = await this.prisma.$transaction(async (tx) => {
      const sample = await this.lockAndLoad(id, tx);
      this.assertOrderActive(sample);
      if (sample.status !== 'REJECTED') {
        throw new BusinessRuleError('SAMPLE_NOT_REJECTED', 'Seul un échantillon refusé peut faire l’objet d’un nouveau prélèvement.');
      }
      if (sample.replacedBy) {
        throw new BusinessRuleError('ALREADY_RECOLLECTED', `Un nouveau prélèvement existe déjà (${sample.replacedBy.number}).`);
      }
      const settings = await this.lab.settings(tx);
      const replacement = await this.repo.createSample(
        {
          number: await this.numbering.sampleNumber(tx, settings.timezone),
          orderId: sample.orderId,
          sampleTypeId: sample.sampleTypeId,
          replacesId: sample.id,
        },
        tx,
      );
      await this.repo.moveItems(sample.id, replacement.id, tx);
      await this.orders.refreshStatus(tx, sample.orderId);
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'Sample',
        entityId: replacement.id,
        after: { ...sampleAuditView(replacement), replaces: sample.number, exams: sample.items.map((i) => i.examCode) },
        reason: `Nouveau prélèvement en remplacement de ${sample.number} : ${input.reason}`,
      });
      return replacement.id;
    });
    return this.getById(newId);
  }

  private async getById(id: string): Promise<SampleContextDto> {
    const sample = await this.repo.findSampleContext({ id });
    if (!sample) throw new NotFoundError('Échantillon', id);
    return this.toContext(sample);
  }

  private async lockAndLoad(id: string, tx: Db): Promise<SampleContextRow> {
    await this.repo.lock('samples', id, tx);
    const sample = await this.repo.findSampleContext({ id }, tx);
    if (!sample) throw new NotFoundError('Échantillon', id);
    return sample;
  }

  private assertOrderActive(sample: SampleContextRow): void {
    if (sample.order.status === 'CANCELLED') {
      throw new BusinessRuleError('ORDER_CANCELLED', `La demande ${sample.order.number} est annulée.`);
    }
  }

  private async toContext(sample: SampleContextRow): Promise<SampleContextDto> {
    return toSampleContext(sample, await this.lab.userNames(sampleUserIds([sample])));
  }
}
