import type { ReactNode } from 'react';
import { CircleCheck, OctagonX, TriangleAlert } from 'lucide-react';
import {
  ANALYSIS_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  RESULT_FLAG_LABELS,
  RESULT_FLAG_MARKS,
  REPORT_KIND_LABELS,
  QC_STATUS_LABELS,
  INSTRUMENT_MESSAGE_STATUS_LABELS,
  INSTRUMENT_RESULT_STATUS_LABELS,
  type InstrumentMessageStatus,
  type InstrumentResultStatus,
  QUALITY_ISSUE_SEVERITY_LABELS,
  QUALITY_ISSUE_STATUS_LABELS,
  INTEROP_RUN_STATUS_LABELS,
  type InteropRunStatus,
  type QcStatus,
  type QualityIssueSeverity,
  type QualityIssueStatus,
  type AnalysisStatus,
  type ReportKind,
  type ResultFlag,
  ORDER_STATUS_LABELS,
  SAMPLE_STATUS_LABELS,
  type InvoiceStatus,
  type OrderPriority,
  type OrderStatus,
  type SampleStatus,
} from '@lims/shared';
import { Badge } from '@/components/ui/feedback';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const ORDER_TONES: Record<OrderStatus, Tone> = {
  REGISTERED: 'neutral',
  PARTIALLY_COLLECTED: 'warning',
  COLLECTED: 'info',
  RECEIVED: 'info',
  PARTIALLY_VALIDATED: 'warning',
  VALIDATED: 'success',
  CANCELLED: 'danger',
};
const ANALYSIS_TONES: Record<AnalysisStatus, Tone> = {
  AWAITING_SAMPLE: 'neutral',
  TO_ENTER: 'warning',
  ENTERED: 'info',
  TECHNICAL_VALIDATED: 'brand',
  VALIDATED: 'success',
};
const SAMPLE_TONES: Record<SampleStatus, Tone> = {
  PENDING_COLLECTION: 'neutral',
  COLLECTED: 'info',
  RECEIVED: 'success',
  REJECTED: 'danger',
};
const INVOICE_TONES: Record<InvoiceStatus, Tone> = {
  UNPAID: 'warning',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
  CANCELLED: 'danger',
};

export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={ORDER_TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
export const SampleStatusBadge = ({ status }: { status: SampleStatus }) => <Badge tone={SAMPLE_TONES[status]}>{SAMPLE_STATUS_LABELS[status]}</Badge>;
export const InvoiceStatusBadge = ({ status }: { status: InvoiceStatus }) => <Badge tone={INVOICE_TONES[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>;

export const AnalysisStatusBadge = ({ status }: { status: AnalysisStatus }) => (
  <Badge tone={ANALYSIS_TONES[status]}>{ANALYSIS_STATUS_LABELS[status]}</Badge>
);
export const ReportKindBadge = ({ kind }: { kind: ReportKind }) => (
  <Badge tone={kind === 'FINAL' ? 'success' : kind === 'AMENDED' ? 'danger' : 'warning'}>{REPORT_KIND_LABELS[kind]}</Badge>
);

/** Interprétation d'un résultat : flèches ↑ ↓ (critique ↑↑ ↓↓) ou * pour un qualitatif anormal. */
export function ResultFlagMark({ flag }: { flag: ResultFlag | null }): ReactNode {
  if (!flag || flag === 'NORMAL') return null;
  const critical = flag === 'CRITICAL_LOW' || flag === 'CRITICAL_HIGH';
  return (
    <span
      title={RESULT_FLAG_LABELS[flag]}
      className={critical ? 'rounded bg-red-600 px-1 text-xs font-bold text-white' : 'text-xs font-bold text-amber-700'}
    >
      {RESULT_FLAG_MARKS[flag]}
      <span className="sr-only"> {RESULT_FLAG_LABELS[flag]}</span>
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: OrderPriority }): ReactNode {
  return priority === 'URGENT' ? <Badge tone="danger">URGENT</Badge> : null;
}

/** Statut d'un CIQ : couleur + pictogramme + libellé (jamais la couleur seule). */
export function QcStatusBadge({ status }: { status: QcStatus }) {
  const Icon = status === 'ACCEPTED' ? CircleCheck : status === 'WARNING' ? TriangleAlert : OctagonX;
  return (
    <Badge tone={status === 'ACCEPTED' ? 'success' : status === 'WARNING' ? 'warning' : 'danger'}>
      <Icon className="mr-1 size-3" aria-hidden />
      {QC_STATUS_LABELS[status]}
    </Badge>
  );
}

const ISSUE_TONES: Record<QualityIssueStatus, Tone> = { OPEN: 'warning', IN_PROGRESS: 'info', CLOSED: 'success', CANCELLED: 'neutral' };
export const QualityIssueStatusBadge = ({ status }: { status: QualityIssueStatus }) => (
  <Badge tone={ISSUE_TONES[status]}>{QUALITY_ISSUE_STATUS_LABELS[status]}</Badge>
);
const SEVERITY_TONES: Record<QualityIssueSeverity, Tone> = { MINOR: 'neutral', MAJOR: 'warning', CRITICAL: 'danger' };
export const SeverityBadge = ({ severity }: { severity: QualityIssueSeverity }) => (
  <Badge tone={SEVERITY_TONES[severity]}>{QUALITY_ISSUE_SEVERITY_LABELS[severity]}</Badge>
);

const INSTRUMENT_RESULT_TONES: Record<InstrumentResultStatus, Tone> = {
  APPLIED: 'success',
  QC_APPLIED: 'success',
  CONFLICT: 'danger',
  UNMATCHED: 'warning',
  LOCKED: 'info',
  NOT_PERFORMED: 'neutral',
  DISMISSED: 'neutral',
};
export const InstrumentResultStatusBadge = ({ status }: { status: InstrumentResultStatus }) => (
  <Badge tone={INSTRUMENT_RESULT_TONES[status]}>{INSTRUMENT_RESULT_STATUS_LABELS[status]}</Badge>
);
const MESSAGE_TONES: Record<InstrumentMessageStatus, Tone> = { PROCESSED: 'success', PARTIAL: 'warning', FAILED: 'danger' };
export const InstrumentMessageStatusBadge = ({ status }: { status: InstrumentMessageStatus }) => (
  <Badge tone={MESSAGE_TONES[status]}>{INSTRUMENT_MESSAGE_STATUS_LABELS[status]}</Badge>
);

const RUN_TONES: Record<InteropRunStatus, 'success' | 'warning' | 'danger'> = { SUCCESS: 'success', WARNING: 'warning', ERROR: 'danger' };
export const InteropRunStatusBadge = ({ status }: { status: InteropRunStatus }) => <Badge tone={RUN_TONES[status]}>{INTEROP_RUN_STATUS_LABELS[status]}</Badge>;
