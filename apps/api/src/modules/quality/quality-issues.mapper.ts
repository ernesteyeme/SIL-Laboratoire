import type { QualityIssueDto } from '@lims/shared';
import { dateToIso } from '../../core/common/values';
import type { IssueRow } from './quality-issues.repository';

export function issueUserIds(i: IssueRow): (string | null)[] {
  return [i.declaredById, i.analyzedById, i.closedById];
}

export function toIssueDto(i: IssueRow, names: Map<string, string>, todayIso: string): QualityIssueDto {
  const due = dateToIso(i.actionDueDate);
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return {
    id: i.id,
    number: i.number,
    title: i.title,
    category: i.category,
    severity: i.severity,
    status: i.status,
    description: i.description,
    detectedAt: i.detectedAt.toISOString(),
    declaredAt: i.declaredAt.toISOString(),
    declaredBy: name(i.declaredById),
    immediateAction: i.immediateAction,
    order: i.order,
    sample: i.sample,
    qcRunId: i.qcRunId,
    rootCause: i.rootCause,
    correctiveAction: i.correctiveAction,
    actionOwner: i.actionOwner,
    actionDueDate: due,
    analyzedBy: name(i.analyzedById),
    analyzedAt: i.analyzedAt?.toISOString() ?? null,
    effectivenessCheck: i.effectivenessCheck,
    closedBy: name(i.closedById),
    closedAt: i.closedAt?.toISOString() ?? null,
    cancelledReason: i.cancelledReason,
    overdue: i.status === 'IN_PROGRESS' && !!due && due < todayIso,
  };
}
