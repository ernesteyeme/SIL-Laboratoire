import { CheckCheck, Droplet, Printer, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  NON_CONFORMITY_DECISION_LABELS,
  NON_CONFORMITY_DECISIONS,
  NON_CONFORMITY_TYPE_LABELS,
  NON_CONFORMITY_TYPES,
  nonConformitySchema,
  type NonConformityDecision,
  type NonConformityType,
  type SampleDto,
} from '@lims/shared';
import {
  DEROGATION_ROLES,
  SAMPLE_COLLECT_ROLES,
  SAMPLE_RECEIVE_ROLES,
  SAMPLE_RECOLLECT_ROLES,
} from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { Barcode } from '@/components/Barcode';
import { SampleStatusBadge } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Badge } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { ReasonModal } from '@/components/ui/ReasonModal';
import { openPrint } from '@/features/billing';
import { useCollectSample, useNonConformity, useReceiveSample, useRecollect } from '@/features/orders';
import { cn, errorMessage, formatDateTime, zodFieldErrors } from '@/lib/utils';

interface Props {
  sample: SampleDto;
  orderId: string;
  orderCancelled: boolean;
  /** Après une action réussie : message, et n° du nouvel échantillon en cas de nouveau prélèvement */
  onDone?: (message: string, newSampleNumber?: string) => void;
  /** Mise en avant (échantillon scanné) */
  highlighted?: boolean;
}

export function SampleCard({ sample, orderId, orderCancelled, onDone, highlighted }: Props) {
  const { hasRole } = useAuth();
  const receive = useReceiveSample();
  const recollect = useRecollect();
  const [collectOpen, setCollectOpen] = useState(false);
  const [ncOpen, setNcOpen] = useState(false);
  const [recollectOpen, setRecollectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = !orderCancelled;
  const canCollect = active && sample.status === 'PENDING_COLLECTION' && hasRole(...SAMPLE_COLLECT_ROLES);
  const canReceive = active && sample.status === 'COLLECTED' && hasRole(...SAMPLE_RECEIVE_ROLES);
  const canNc = active && (sample.status === 'COLLECTED' || sample.status === 'RECEIVED') && hasRole(...SAMPLE_RECEIVE_ROLES);
  const canRecollect = active && sample.status === 'REJECTED' && !sample.replacedByNumber && hasRole(...SAMPLE_RECOLLECT_ROLES);

  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-4 shadow-xs',
        highlighted ? 'border-brand-600 ring-2 ring-brand-600/20' : 'border-slate-200',
        sample.status === 'REJECTED' && 'bg-red-50/40',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SampleStatusBadge status={sample.status} />
            {sample.hasReservation && (
              <Badge tone="warning">
                <ShieldAlert className="mr-1 size-3" aria-hidden />
                Accepté sous réserve
              </Badge>
            )}
          </div>
          <p className="font-medium text-slate-900">
            {sample.sampleType.name}
            {sample.sampleType.container && <span className="font-normal text-slate-500"> · {sample.sampleType.container}</span>}
          </p>
          <p className="text-sm text-slate-600">
            Examens : <span className="font-mono font-medium">{sample.examCodes.length > 0 ? sample.examCodes.join(', ') : '— (transférés)'}</span>
          </p>
          {sample.sampleType.instructions && sample.status === 'PENDING_COLLECTION' && (
            <p className="text-xs text-slate-500">{sample.sampleType.instructions}</p>
          )}
          <dl className="grid gap-x-6 text-xs text-slate-500 sm:grid-cols-2">
            {sample.collectedAt && (
              <div>
                Prélevé le {formatDateTime(sample.collectedAt)}
                {sample.collectedBy && ` par ${sample.collectedBy}`}
              </div>
            )}
            {sample.receivedAt && (
              <div>
                Reçu le {formatDateTime(sample.receivedAt)}
                {sample.receivedBy && ` par ${sample.receivedBy}`}
              </div>
            )}
            {sample.replacesNumber && <div>Remplace l’échantillon {sample.replacesNumber}</div>}
            {sample.replacedByNumber && <div className="font-medium text-slate-700">Remplacé par l’échantillon {sample.replacedByNumber}</div>}
          </dl>
        </div>
        <div className="shrink-0 text-center">
          <Barcode value={sample.number} height={36} width={1.4} />
        </div>
      </div>

      {sample.nonConformities.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {sample.nonConformities.map((nc) => (
            <li key={nc.id} className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <strong>{NON_CONFORMITY_TYPE_LABELS[nc.type]}</strong> — {NON_CONFORMITY_DECISION_LABELS[nc.decision]}
                {nc.comment && ` : ${nc.comment}`}
                <span className="text-amber-700">
                  {' '}
                  ({formatDateTime(nc.recordedAt)}
                  {nc.recordedBy && `, ${nc.recordedBy}`})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {sample.status !== 'REJECTED' && sample.examCodes.length > 0 && (
          <Button size="sm" variant="secondary" icon={Printer} onClick={() => openPrint(`/impression/etiquettes/${orderId}?echantillon=${sample.id}`)}>
            Étiquette
          </Button>
        )}
        {canCollect && (
          <Button size="sm" icon={Droplet} onClick={() => setCollectOpen(true)}>
            Enregistrer le prélèvement
          </Button>
        )}
        {canReceive && (
          <Button
            size="sm"
            icon={CheckCheck}
            loading={receive.isPending}
            onClick={async () => {
              setError(null);
              try {
                await receive.mutateAsync(sample.id);
                onDone?.(`Échantillon ${sample.number} reçu conforme.`);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Réception conforme
          </Button>
        )}
        {canNc && (
          <Button size="sm" variant="secondary" icon={TriangleAlert} onClick={() => setNcOpen(true)}>
            Non-conformité
          </Button>
        )}
        {canRecollect && (
          <Button size="sm" icon={RefreshCw} onClick={() => setRecollectOpen(true)}>
            Nouveau prélèvement
          </Button>
        )}
      </div>

      <CollectModal open={collectOpen} sample={sample} onClose={() => setCollectOpen(false)} onDone={onDone} />
      <NonConformityModal open={ncOpen} sample={sample} canDerogate={hasRole(...DEROGATION_ROLES)} onClose={() => setNcOpen(false)} onDone={onDone} />
      <ReasonModal
        open={recollectOpen}
        title={`Nouveau prélèvement — ${sample.sampleType.name}`}
        description={`Un nouvel échantillon (nouveau code-barres) sera créé ; les examens ${sample.examCodes.join(', ')} y seront transférés. L’échantillon ${sample.number} reste archivé.`}
        confirmLabel="Créer le nouveau prélèvement"
        placeholder="Ex. : patient rappelé le 23/11 à 8 h"
        onClose={() => setRecollectOpen(false)}
        onConfirm={async (reason) => {
          const created = await recollect.mutateAsync({ id: sample.id, reason });
          onDone?.(`Nouvel échantillon ${created.number} créé : imprimez son étiquette.`, created.number);
        }}
      />
    </div>
  );
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CollectModal({ open, sample, onClose, onDone }: { open: boolean; sample: SampleDto; onClose: () => void; onDone?: (m: string) => void }) {
  const collect = useCollectSample();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(toLocalInput(new Date()));
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      setError('Heure de prélèvement invalide.');
      return;
    }
    try {
      await collect.mutateAsync({ id: sample.id, body: { collectedAt: date } });
      onDone?.(`Prélèvement de l’échantillon ${sample.number} enregistré.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Prélèvement — ${sample.sampleType.name}`}
      description={`Échantillon ${sample.number} · examens ${sample.examCodes.join(', ')}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="collect-form" loading={collect.isPending}>
            Confirmer
          </Button>
        </>
      }
    >
      <form id="collect-form" onSubmit={submit} noValidate className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Alert tone="info">Vérifiez l’identité du patient et collez l’étiquette sur le contenant avant de confirmer.</Alert>
        <TextField label="Date et heure du prélèvement" type="datetime-local" required value={value} max={toLocalInput(new Date())} onChange={(e) => setValue(e.target.value)} />
      </form>
    </Modal>
  );
}

function NonConformityModal({
  open,
  sample,
  canDerogate,
  onClose,
  onDone,
}: {
  open: boolean;
  sample: SampleDto;
  canDerogate: boolean;
  onClose: () => void;
  onDone?: (m: string) => void;
}) {
  const record = useNonConformity();
  const [type, setType] = useState<NonConformityType | ''>('');
  const [decision, setDecision] = useState<NonConformityDecision>('REJECTED');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setType('');
      setDecision('REJECTED');
      setComment('');
      setErrors({});
      setFormError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = nonConformitySchema.safeParse({ type: type || undefined, decision, comment });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    try {
      await record.mutateAsync({ id: sample.id, body: parsed.data });
      onDone?.(
        decision === 'REJECTED'
          ? `Échantillon ${sample.number} refusé. Demandez un nouveau prélèvement.`
          : `Échantillon ${sample.number} accepté sous réserve.`,
      );
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Non-conformité — échantillon ${sample.number}`}
      description={`${sample.sampleType.name} · examens ${sample.examCodes.join(', ')}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="nc-form" variant={decision === 'REJECTED' ? 'danger' : 'primary'} loading={record.isPending}>
            {decision === 'REJECTED' ? 'Refuser l’échantillon' : 'Accepter sous réserve'}
          </Button>
        </>
      }
    >
      <form id="nc-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <SelectField label="Type de non-conformité" required value={type} onChange={(e) => setType(e.target.value as NonConformityType)} error={errors.type}>
          <option value="">— Choisir —</option>
          {NON_CONFORMITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {NON_CONFORMITY_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Décision</legend>
          {NON_CONFORMITY_DECISIONS.map((d) => {
            const disabled = d === 'ACCEPTED_WITH_RESERVATION' && !canDerogate;
            return (
              <label key={d} className={cn('flex items-start gap-2 rounded-md border p-2 text-sm', decision === d ? 'border-brand-600 bg-brand-50' : 'border-slate-200', disabled && 'opacity-50')}>
                <input type="radio" name="decision" className="mt-0.5 accent-brand-700" checked={decision === d} disabled={disabled} onChange={() => setDecision(d)} />
                <span>
                  {NON_CONFORMITY_DECISION_LABELS[d]}
                  {disabled && <span className="block text-xs text-slate-500">Réservé au biologiste.</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
        <TextAreaField
          label={decision === 'ACCEPTED_WITH_RESERVATION' ? 'Réserve (reportée sur le compte rendu)' : 'Commentaire'}
          required={decision === 'ACCEPTED_WITH_RESERVATION' || type === 'OTHER'}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          error={errors.comment}
        />
      </form>
    </Modal>
  );
}
