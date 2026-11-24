import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, Siren, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  computeAge,
  computeInvoiceTotals,
  createOrderSchema,
  fromCents,
  SEX_LABELS,
  toCents,
  type ExamListItemDto,
  type OrderPriority,
  type PatientDto,
  type PrescriberDto,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Spinner } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { sectionsQuery, useExams } from '@/features/catalog';
import { useCreateOrder } from '@/features/orders';
import { usePatients } from '@/features/patients';
import { usePrescribers } from '@/features/prescribers';
import { settingsQuery } from '@/features/settings';
import { ApiError } from '@/lib/api';
import { cn, errorMessage, formatMoney, formatTurnaround, zodFieldErrors } from '@/lib/utils';
import { PatientFormModal } from '../patients/PatientFormModal';

export function NewOrderPage() {
  const navigate = useNavigate();
  const create = useCreateOrder();
  const settings = useQuery(settingsQuery);
  const currency = settings.data?.currency;

  const [patient, setPatient] = useState<PatientDto | null>(null);
  const [prescriber, setPrescriber] = useState<PrescriberDto | null>(null);
  const [priority, setPriority] = useState<OrderPriority>('ROUTINE');
  const [clinicalInfo, setClinicalInfo] = useState('');
  const [payerName, setPayerName] = useState('');
  const [coverage, setCoverage] = useState('0');
  const [selected, setSelected] = useState<ExamListItemDto[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const cov = Number(coverage) || 0;
    return computeInvoiceTotals({
      lineCents: selected.map((e) => toCents(e.price)),
      discountCents: 0,
      coveragePercent: Math.min(100, Math.max(0, Math.trunc(cov))),
      paidCents: 0,
    });
  }, [selected, coverage]);

  const sampleCount = new Set(selected.map((e) => e.sampleType.id)).size;

  const submit = async () => {
    setFormError(null);
    const parsed = createOrderSchema.safeParse({
      patientId: patient?.id,
      prescriberId: prescriber?.id ?? null,
      priority,
      clinicalInfo,
      examIds: selected.map((e) => e.id),
      payerName,
      coveragePercent: coverage,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      const order = await create.mutateAsync(parsed.data);
      navigate(`/demandes/${order.id}`, { state: { justCreated: true } });
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.length > 0) {
        setErrors(zodFieldErrors(error.fieldErrors.map((f) => ({ path: [f.path], message: f.message }))));
      }
      setFormError(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/demandes" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="size-4" /> Demandes
      </Link>
      <PageHeader title="Nouvelle demande d’examens" description="Patient, prescripteur, examens : la facture et les étiquettes sont générées à l’enregistrement." />

      {formError && (
        <Alert tone="error" className="mb-4">
          {formError}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-6">
          <PatientPicker patient={patient} onChange={setPatient} error={errors.patientId} />
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Demande</h2>
            <PrescriberPicker prescriber={prescriber} onChange={setPrescriber} />
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Priorité</span>
              <div className="flex gap-2">
                {(['ROUTINE', 'URGENT'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium',
                      priority === p ? (p === 'URGENT' ? 'border-red-600 bg-red-600 text-white' : 'border-brand-700 bg-brand-700 text-white') : 'border-slate-300 text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {p === 'URGENT' && <Siren className="size-4" aria-hidden />}
                    {p === 'URGENT' ? 'Urgente' : 'Normale'}
                  </button>
                ))}
              </div>
            </div>
            <TextAreaField
              label="Renseignements cliniques"
              placeholder="Motif, traitement en cours, grossesse…"
              value={clinicalInfo}
              onChange={(e) => setClinicalInfo(e.target.value)}
              error={errors.clinicalInfo}
            />
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <TextField label="Organisme payeur" placeholder="Assurance, employeur, programme…" value={payerName} onChange={(e) => setPayerName(e.target.value)} error={errors.payerName} />
              <TextField label="Prise en charge (%)" type="number" min={0} max={100} value={coverage} onChange={(e) => setCoverage(e.target.value)} error={errors.coveragePercent} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <ExamPicker selected={selected} onChange={setSelected} error={errors.examIds} currency={currency} />
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Récapitulatif</h2>
            {selected.length === 0 ? (
              <p className="text-sm text-slate-500">Aucun examen sélectionné.</p>
            ) : (
              <>
                <ul className="mb-3 divide-y divide-slate-100 text-sm">
                  {selected.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span>
                        <span className="font-mono text-xs font-semibold">{e.code}</span> {e.name}
                        <span className="text-xs text-slate-500"> · {e.sampleType.name} · {formatTurnaround(e.turnaroundHours)}</span>
                      </span>
                      <span className="flex items-center gap-2 tabular-nums">
                        {formatMoney(e.price, currency)}
                        <button type="button" onClick={() => setSelected((s) => s.filter((x) => x.id !== e.id))} className="text-slate-400 hover:text-red-600" aria-label={`Retirer ${e.code}`}>
                          <X className="size-4" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="space-y-1 border-t border-slate-200 pt-3 text-sm">
                  <Row label="Total" value={formatMoney(fromCents(totals.totalCents), currency)} />
                  {totals.thirdPartyCents > 0 && <Row label={`Part ${payerName || 'tiers'}`} value={`− ${formatMoney(fromCents(totals.thirdPartyCents), currency)}`} />}
                  <Row label="À payer par le patient" value={formatMoney(fromCents(totals.patientCents), currency)} strong />
                  <Row label="Échantillons à prélever" value={String(sampleCount)} />
                </dl>
              </>
            )}
            <Button className="mt-4 w-full" onClick={submit} loading={create.isPending} disabled={!patient || selected.length === 0}>
              Enregistrer la demande
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between', strong && 'text-base font-semibold text-slate-900')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function PatientPicker({ patient, onChange, error }: { patient: PatientDto | null; onChange: (p: PatientDto | null) => void; error?: string }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const results = usePatients({ page: 1, pageSize: 8, q: debounced, sex: '', status: 'active' });
  const enabled = debounced.trim().length >= 2;

  return (
    <Card className={cn('p-5', error && 'ring-1 ring-red-300')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Patient</h2>
        <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setCreating(true)}>
          Nouveau patient
        </Button>
      </div>
      {patient ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-brand-600 bg-brand-50 p-3">
          <div>
            <p className="font-medium text-slate-900">{patient.fullName}</p>
            <p className="text-sm text-slate-600">
              <span className="font-mono text-xs">{patient.code}</span> · {SEX_LABELS[patient.sex]}
              {patient.birthDate && ` · ${computeAge(patient.birthDate).label}${patient.birthDateEstimated ? ' (est.)' : ''}`}
              {patient.phone && ` · ${patient.phone}`}
            </p>
          </div>
          <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-700" aria-label="Changer de patient">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <TextField label="Rechercher le patient" placeholder="Nom, code PAT-…, téléphone" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" error={error} autoFocus />
            <Search className="pointer-events-none absolute left-3 top-9 size-4 text-slate-400" aria-hidden />
          </div>
          {enabled && (
            <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
              {results.isFetching && !results.data && (
                <li className="flex items-center gap-2 p-3 text-sm text-slate-500">
                  <Spinner className="size-4" /> Recherche…
                </li>
              )}
              {results.data?.items.length === 0 && <li className="p-3 text-sm text-slate-500">Aucun patient : créez un nouveau dossier.</li>}
              {results.data?.items.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onChange(p)} className="w-full p-3 text-left text-sm hover:bg-slate-50">
                    <span className="font-medium text-slate-900">{p.fullName}</span>
                    <span className="block text-xs text-slate-500">
                      {p.code} · {SEX_LABELS[p.sex]}
                      {p.birthDate && ` · ${computeAge(p.birthDate).label}`}
                      {p.phone && ` · ${p.phone}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <PatientFormModal
        open={creating}
        patient={null}
        onClose={() => setCreating(false)}
        onSaved={(p) => onChange(p)}
        onOpenExisting={(p) => onChange(p)}
      />
    </Card>
  );
}

function PrescriberPicker({ prescriber, onChange }: { prescriber: PrescriberDto | null; onChange: (p: PrescriberDto | null) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const results = usePrescribers({ page: 1, pageSize: 6, q: debounced, status: 'active' });

  if (prescriber) {
    return (
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Prescripteur</span>
        <div className="flex items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm">
          <span>
            {prescriber.displayName}
            {prescriber.facility && <span className="text-slate-500"> · {prescriber.facility}</span>}
          </span>
          <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-700" aria-label="Retirer le prescripteur">
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <TextField label="Prescripteur (facultatif)" placeholder="Rechercher un médecin ou une structure" value={q} onChange={(e) => setQ(e.target.value)} />
      {debounced.trim().length >= 2 && (
        <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
          {results.data?.items.length === 0 && <li className="p-2 text-slate-500">Aucun prescripteur trouvé.</li>}
          {results.data?.items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(p)} className="w-full p-2 text-left hover:bg-slate-50">
                {p.displayName}
                {p.facility && <span className="text-xs text-slate-500"> · {p.facility}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamPicker({
  selected,
  onChange,
  error,
  currency,
}: {
  selected: ExamListItemDto[];
  onChange: (e: ExamListItemDto[]) => void;
  error?: string;
  currency?: string;
}) {
  const [q, setQ] = useState('');
  const [sectionId, setSectionId] = useState('');
  const sections = useQuery(sectionsQuery);
  const exams = useExams({ page: 1, pageSize: 100, status: 'active' });
  const isSelected = (id: string) => selected.some((e) => e.id === id);

  const visible = (exams.data?.items ?? []).filter((e) => {
    if (sectionId && e.section.id !== sectionId) return false;
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return e.code.toLowerCase().includes(needle) || e.name.toLowerCase().includes(needle) || (e.shortName ?? '').toLowerCase().includes(needle);
  });

  const toggle = (exam: ExamListItemDto) => onChange(isSelected(exam.id) ? selected.filter((e) => e.id !== exam.id) : [...selected, exam]);

  return (
    <Card className={cn('p-5', error && 'ring-1 ring-red-300')}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Examens</h2>
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_200px]">
        <TextField label="Rechercher" placeholder="Code ou nom (NFS, glycémie…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Toutes</option>
          {sections.data?.filter((s) => s.isActive).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200">
        {exams.isLoading ? (
          <p className="flex items-center gap-2 p-3 text-sm text-slate-500">
            <Spinner className="size-4" /> Chargement du catalogue…
          </p>
        ) : visible.length === 0 ? (
          <p className="p-3 text-sm text-slate-500">Aucun examen commandable ne correspond.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((e) => (
              <li key={e.id}>
                <label className={cn('flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-slate-50', isSelected(e.id) && 'bg-brand-50')}>
                  <input type="checkbox" className="mt-1 accent-brand-700" checked={isSelected(e.id)} onChange={() => toggle(e)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs font-semibold text-slate-700">{e.code}</span> <span className="font-medium text-slate-900">{e.name}</span>
                    <span className="block text-xs text-slate-500">
                      {e.section.name} · {e.sampleType.name} · résultat en {formatTurnaround(e.turnaroundHours)}
                    </span>
                  </span>
                  <span className="whitespace-nowrap tabular-nums text-slate-700">{formatMoney(e.price, currency)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
