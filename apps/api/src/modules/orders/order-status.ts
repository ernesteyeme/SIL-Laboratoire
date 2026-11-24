import type { AnalysisStatus, OrderStatus, SampleStatus } from '@lims/shared';

export interface SampleState {
  status: SampleStatus;
  /** Nombre d'examens rattachés : un échantillon refusé et remplacé n'en porte plus. */
  itemCount: number;
}

/**
 * Statut d'une demande :
 *  - tous les examens validés biologiquement → Validée ; au moins un → Validée partiellement ;
 *  - sinon, déduit des échantillons « courants » (ceux qui portent des examens) :
 *    un échantillon refusé non remplacé empêche la demande d'être complète.
 */
export function computeOrderStatus(samples: SampleState[], cancelled: boolean, itemStatuses: AnalysisStatus[] = []): OrderStatus {
  if (cancelled) return 'CANCELLED';
  if (itemStatuses.length > 0 && itemStatuses.every((s) => s === 'VALIDATED')) return 'VALIDATED';
  if (itemStatuses.some((s) => s === 'VALIDATED')) return 'PARTIALLY_VALIDATED';
  const current = samples.filter((s) => s.itemCount > 0);
  if (current.length === 0) return 'REGISTERED';
  if (current.every((s) => s.status === 'RECEIVED')) return 'RECEIVED';
  const collected = (s: SampleState) => s.status === 'COLLECTED' || s.status === 'RECEIVED';
  if (current.every(collected)) return 'COLLECTED';
  if (current.some(collected)) return 'PARTIALLY_COLLECTED';
  return 'REGISTERED';
}
