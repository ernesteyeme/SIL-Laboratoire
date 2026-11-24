import {
  formatPrescriberName,
  fromCents,
  toCents,
  type OrderDetailDto,
  type OrderListItemDto,
  type SampleContextDto,
  type SampleDto,
} from '@lims/shared';
import { toPatientSummary } from '../billing/billing.mapper';
import type { OrderDetailRow, OrderListRow, SampleContextRow, SampleRow } from './orders.repository';

const money = (d: { toFixed(dp: number): string }) => d.toFixed(2);

export function toSampleDto(s: SampleRow, names: Map<string, string>): SampleDto {
  return {
    id: s.id,
    number: s.number,
    status: s.status,
    sampleType: s.sampleType,
    examCodes: s.items.map((i) => i.examCode),
    collectedAt: s.collectedAt?.toISOString() ?? null,
    collectedBy: s.collectedById ? (names.get(s.collectedById) ?? null) : null,
    receivedAt: s.receivedAt?.toISOString() ?? null,
    receivedBy: s.receivedById ? (names.get(s.receivedById) ?? null) : null,
    hasReservation: s.hasReservation,
    replacesNumber: s.replaces?.number ?? null,
    replacedByNumber: s.replacedBy?.number ?? null,
    nonConformities: s.nonConformities.map((n) => ({
      id: n.id,
      type: n.type,
      decision: n.decision,
      comment: n.comment,
      recordedAt: n.recordedAt.toISOString(),
      recordedBy: names.get(n.recordedById) ?? null,
    })),
  };
}

/** Identifiants d'utilisateurs à résoudre pour l'affichage d'échantillons. */
export function sampleUserIds(samples: SampleRow[]): (string | null)[] {
  return samples.flatMap((s) => [s.collectedById, s.receivedById, ...s.nonConformities.map((n) => n.recordedById)]);
}

export function toOrderListItem(o: OrderListRow): OrderListItemDto {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    priority: o.priority,
    patient: toPatientSummary(o.patient),
    prescriberName: o.prescriber ? formatPrescriberName(o.prescriber) : null,
    examCodes: o.items.map((i) => i.examCode),
    createdAt: o.createdAt.toISOString(),
    invoiceStatus: o.invoice?.status ?? null,
  };
}

export function toOrderDetail(o: OrderDetailRow, names: Map<string, string>, paymentRequiredBeforeCollection: boolean): OrderDetailDto {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    priority: o.priority,
    patient: toPatientSummary(o.patient),
    prescriberName: o.prescriber ? formatPrescriberName(o.prescriber) : null,
    examCodes: o.items.map((i) => i.examCode),
    createdAt: o.createdAt.toISOString(),
    invoiceStatus: o.invoice?.status ?? null,
    clinicalInfo: o.clinicalInfo,
    createdBy: names.get(o.createdById) ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    cancellationReason: o.cancellationReason,
    items: o.items.map((i) => ({
      id: i.id,
      examId: i.examId,
      examCode: i.examCode,
      examName: i.examName,
      unitPrice: money(i.unitPrice),
      sampleNumber: i.sample.number,
      turnaroundHours: i.exam.turnaroundHours,
      patientInstructions: i.exam.patientInstructions,
    })),
    samples: o.samples.map((s) => toSampleDto(s, names)),
    invoice: o.invoice
      ? {
          id: o.invoice.id,
          number: o.invoice.number,
          status: o.invoice.status,
          patientAmount: money(o.invoice.patientAmount),
          paidAmount: money(o.invoice.paidAmount),
          balance: fromCents(
            o.invoice.status === 'CANCELLED' ? 0 : toCents(money(o.invoice.patientAmount)) - toCents(money(o.invoice.paidAmount)),
          ),
        }
      : null,
    paymentRequiredBeforeCollection,
  };
}

export function toSampleContext(s: SampleContextRow, names: Map<string, string>): SampleContextDto {
  return {
    ...toSampleDto(s, names),
    order: {
      id: s.order.id,
      number: s.order.number,
      priority: s.order.priority,
      status: s.order.status,
      createdAt: s.order.createdAt.toISOString(),
      clinicalInfo: s.order.clinicalInfo,
    },
    patient: toPatientSummary(s.order.patient),
  };
}
