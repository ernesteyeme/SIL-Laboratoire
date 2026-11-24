import { Injectable } from '@nestjs/common';
import type { CancelOrderInput, CreateOrderInput, ListOrdersQuery, OrderDetailDto, OrderListItemDto, Paginated } from '@lims/shared';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { toPage } from '../../core/common/pagination';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, NotFoundError } from '../../core/errors/domain.exception';
import { NumberingService } from '../../core/numbering/numbering.service';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { InvoicesService } from '../billing/invoices.service';
import { computeOrderStatus } from './order-status';
import { sampleUserIds, toOrderDetail, toOrderListItem } from './orders.mapper';
import { OrdersRepository, type OrderDetailRow } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: OrdersRepository,
    private readonly invoices: InvoicesService,
    private readonly numbering: NumberingService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListOrdersQuery): Promise<Paginated<OrderListItemDto>> {
    const [rows, total] = await this.repo.listOrders(query);
    return toPage(rows.map(toOrderListItem), total, query);
  }

  async get(id: string): Promise<OrderDetailDto> {
    return this.toDetail(await this.getOrThrow(id));
  }

  /**
   * Enregistrement d'une demande, en une seule transaction :
   * n° de demande → un échantillon par type d'échantillon → examens (tarif figé) → facture → audit.
   */
  async create(input: CreateOrderInput, actor: RequestUser): Promise<OrderDetailDto> {
    const orderId = await this.prisma.$transaction(
      async (tx) => {
        const settings = await this.lab.settings(tx);

        const patient = await tx.patient.findUnique({ where: { id: input.patientId } });
        if (!patient) throw new NotFoundError('Patient', input.patientId);
        if (!patient.isActive) throw new BusinessRuleError('PATIENT_INACTIVE', 'Ce dossier patient est désactivé.');

        if (input.prescriberId) {
          const prescriber = await tx.prescriber.findUnique({ where: { id: input.prescriberId } });
          if (!prescriber) throw new NotFoundError('Prescripteur', input.prescriberId);
          if (!prescriber.isActive) throw new BusinessRuleError('PRESCRIBER_INACTIVE', 'Ce prescripteur est désactivé.');
        }

        const exams = await tx.exam.findMany({
          where: { id: { in: input.examIds } },
          include: { sampleType: { select: { id: true, isActive: true } } },
        });
        const unavailable = input.examIds.filter((id) => !exams.some((e) => e.id === id && e.isActive));
        if (unavailable.length > 0) {
          throw new BusinessRuleError(
            'EXAM_UNAVAILABLE',
            `${unavailable.length} examen(s) demandé(s) n’existent pas ou ne sont plus commandables. Actualisez la sélection.`,
          );
        }

        const order = await this.repo.createOrder(
          {
            number: await this.numbering.orderNumber(tx, settings.timezone),
            patientId: patient.id,
            prescriberId: input.prescriberId ?? null,
            priority: input.priority,
            clinicalInfo: input.clinicalInfo ?? null,
            createdById: actor.id,
          },
          tx,
        );

        // Un échantillon (un tube, un flacon…) par type d'échantillon.
        const byType = new Map<string, typeof exams>();
        for (const exam of exams) byType.set(exam.sampleTypeId, [...(byType.get(exam.sampleTypeId) ?? []), exam]);

        const lines: { orderItemId: string; label: string; amount: string }[] = [];
        const sampleNumbers: string[] = [];
        for (const [sampleTypeId, group] of byType) {
          const sample = await this.repo.createSample(
            { number: await this.numbering.sampleNumber(tx, settings.timezone), orderId: order.id, sampleTypeId },
            tx,
          );
          sampleNumbers.push(sample.number);
          for (const exam of group) {
            const item = await this.repo.createItem(
              {
                orderId: order.id,
                examId: exam.id,
                examCode: exam.code,
                examName: exam.name,
                unitPrice: exam.price,
                sampleId: sample.id,
              },
              tx,
            );
            lines.push({ orderItemId: item.id, label: `${exam.code} — ${exam.name}`, amount: exam.price.toFixed(2) });
          }
        }

        const invoice = await this.invoices.createForOrder(tx, {
          orderId: order.id,
          patientId: patient.id,
          lines,
          payerName: input.payerName ?? null,
          coveragePercent: input.coveragePercent,
          timeZone: settings.timezone,
        });

        await this.audit.record(tx, {
          action: 'CREATE',
          entity: 'Order',
          entityId: order.id,
          after: {
            number: order.number,
            patientId: patient.id,
            patientCode: patient.code,
            prescriberId: order.prescriberId,
            priority: order.priority,
            clinicalInfo: order.clinicalInfo,
            exams: exams.map((e) => ({ code: e.code, price: e.price.toFixed(2) })),
            samples: sampleNumbers,
            invoice: invoice.number,
          },
        });
        return order.id;
      },
      { timeout: 20_000 },
    );
    return this.get(orderId);
  }

  async cancel(id: string, input: CancelOrderInput, actor: RequestUser): Promise<OrderDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.repo.lock('lab_orders', id, tx);
      const order = await this.getOrThrow(id, tx);
      if (order.status === 'CANCELLED') throw new BusinessRuleError('ORDER_ALREADY_CANCELLED', 'Cette demande est déjà annulée.');
      if (order.samples.some((s) => s.status === 'RECEIVED')) {
        throw new BusinessRuleError(
          'ORDER_ALREADY_RECEIVED',
          'Des échantillons ont déjà été reçus au laboratoire : la demande ne peut plus être annulée.',
        );
      }
      await this.invoices.cancelForOrder(tx, id, input.reason);
      const next = await this.repo.updateOrder(
        id,
        { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id, cancellationReason: input.reason },
        tx,
      );
      await this.audit.record(tx, {
        action: 'DELETE',
        entity: 'Order',
        entityId: id,
        before: { number: order.number, status: order.status },
        after: { number: next.number, status: next.status },
        reason: input.reason,
      });
    });
    return this.get(id);
  }

  /** Recalcule et enregistre le statut de la demande après une opération sur ses échantillons. */
  async refreshStatus(tx: Db, orderId: string): Promise<void> {
    const order = await tx.labOrder.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order || order.status === 'CANCELLED') return;
    const [samples, items] = await Promise.all([
      this.repo.sampleStates(orderId, tx),
      tx.orderItem.findMany({ where: { orderId }, select: { analysisStatus: true } }),
    ]);
    const status = computeOrderStatus(
      samples.map((s) => ({ status: s.status, itemCount: s._count.items })),
      false,
      items.map((i) => i.analysisStatus),
    );
    if (status !== order.status) await this.repo.updateOrder(orderId, { status }, tx);
  }

  private async getOrThrow(id: string, db: Db = this.prisma): Promise<OrderDetailRow> {
    const order = await this.repo.findOrder(id, db);
    if (!order) throw new NotFoundError('Demande', id);
    return order;
  }

  private async toDetail(order: OrderDetailRow): Promise<OrderDetailDto> {
    const [names, settings] = await Promise.all([
      this.lab.userNames([order.createdById, ...sampleUserIds(order.samples)]),
      this.lab.settings(),
    ]);
    return toOrderDetail(order, names, settings.requirePaymentBeforeCollection);
  }
}
