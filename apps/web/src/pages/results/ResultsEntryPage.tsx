import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Cable,
  CheckCheck,
  CheckCircle2,
  FileDown,
  FilePlus2,
  History,
  PencilLine,
  PhoneCall,
  RotateCcw,
  Save,
  ShieldAlert,
  Stethoscope,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  acknowledgeAlertSchema,
  computeAge,
  computeResultFlag,
  formatNumericRange,
  parseNumericInput,
  RESULT_FLAG_LABELS,
  SEX_LABELS,
  type AnalysisItemDto,
  type CriticalAlertDto,
  type ResultDto,
  type ResultFlag,
} from '@lims/shared';
import { ANALYSIS_ROLES, BIOLOGIST_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { AnalysisStatusBadge, OrderStatusBadge, PriorityBadge, ReportKindBadge, ResultFlagMark } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Badge, LoadingBlock } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/PageHeader';
import { ReasonModal } from '@/components/ui/ReasonModal';
import {
  openReportPdf,
  orderResultsQuery,
  useAcknowledgeAlert,
  useAmend,
  useBiologicalValidation,
  useIssuePartialReport,
  useReturnToEntry,
  useSaveResults,
  useTechnicalValidation,
} from '@/features/results';
import { ApiError } from '@/lib/api';
import { cn, errorMessage, formatDate, formatDateTime, zodFieldErrors } from '@/lib/utils';
import { NotFoundPage } from '../NotFoundPage';

export function ResultsEntryPage() {
  const { orderId = '' } = useParams();
  const [params] = useSearchParams();
  const focusItem = params.get('examen');
  const { hasRole } = useAuth();
  const isBiologist = hasRole(...BIOLOGIST_ROLES);
  const { data, isLoading, isError, error } = useQuery(orderResultsQuery(orderId));
  const partial = useIssuePartialReport();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (isError) return (error as { status?: number })?.status === 404 ? <NotFoundPage /> : <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!data) return null;

  const { order, patient, items, reports } = data;
  const validatedCount = items.filter((i) => i.status === 'VALIDATED').length;
  const canIssuePartial = isBiologist && validatedCount > 0 && validatedCount < items.length && order.status !== 'CANCELLED';
  const openAlerts = items.flatMap((i) => i.alerts.filter((a) => !a.acknowledgedAt));
  const sorted = [...items].sort((a, b) => (a.id === focusItem ? -1 : b.id === focusItem ? 1 : 0));

  const openPdf = async (r: (typeof reports)[number]) => {
    try {
      await openReportPdf(r);
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/paillasses" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="size-4" /> Paillasses
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/demandes/${order.id}`} className="rounded bg-slate-800 px-2 py-0.5 font-mono text-sm font-semibold text-white hover:bg-slate-700">
              {order.number}
            </Link>
            <PriorityBadge priority={order.priority} />
            <OrderStatusBadge status={order.status} />
          </div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{patient.fullName}</h1>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{patient.code}</span> · {SEX_LABELS[patient.sex]}
            {patient.birthDate && ` · ${computeAge(patient.birthDate).label}`}
            {order.prescriberName && ` · ${order.prescriberName}`}
          </p>
          {order.clinicalInfo && (
            <p className="mt-1 flex items-start gap-1 text-sm text-slate-700">
              <Stethoscope className="mt-0.5 size-4 text-slate-400" aria-hidden /> {order.clinicalInfo}
            </p>
          )}
        </div>
        <div className="text-right text-sm text-slate-600">
          <p>
            {validatedCount}/{items.length} examen{items.length > 1 ? 's' : ''} validé{validatedCount > 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {notice && (
        <Alert tone={notice.tone} className="mb-4">
          {notice.text}
        </Alert>
      )}
      {openAlerts.length > 0 && (
        <Alert tone="error" className="mb-4" title="Valeur(s) critique(s) à communiquer au prescripteur">
          {openAlerts.map((a) => `${a.parameterName} ${a.valueText}`).join(' · ')} — la validation biologique est bloquée tant que la communication n’est pas tracée.
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          {sorted.map((item) => (
            <ExamCard key={item.id} item={item} highlighted={item.id === focusItem} onNotice={(text, tone = 'success') => setNotice({ tone, text })} />
          ))}
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Comptes rendus</h2>
              {canIssuePartial && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={FilePlus2}
                  loading={partial.isPending}
                  onClick={async () => {
                    try {
                      const r = await partial.mutateAsync(order.id);
                      setNotice({ tone: 'success', text: `Compte rendu partiel ${r.number} émis.` });
                    } catch (err) {
                      setNotice({ tone: 'error', text: errorMessage(err) });
                    }
                  }}
                >
                  Partiel
                </Button>
              )}
            </div>
            {reports.length === 0 ? (
              <p className="text-sm text-slate-500">
                Le compte rendu définitif est émis automatiquement à la validation biologique du dernier examen.
              </p>
            ) : (
              <ul className="space-y-3">
                {reports.map((r, idx) => (
                  <li key={r.id} className={cn('rounded-md border p-3 text-sm', idx === 0 ? 'border-brand-600/40 bg-brand-50/40' : 'border-slate-200 opacity-80')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{r.number}</span>
                      <ReportKindBadge kind={r.kind} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      v{r.version} · {formatDateTime(r.issuedAt)} · {r.issuedBy ?? '—'}
                    </p>
                    <p className="text-xs text-slate-500">Examens : {r.examCodes.join(', ')}</p>
                    {r.supersedesNumber && <p className="text-xs text-slate-500">Remplace {r.supersedesNumber}</p>}
                    {idx > 0 && <p className="text-xs font-medium text-slate-500">Remplacé par une version ultérieure</p>}
                    <p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={`SHA-256 ${r.sha256}`}>
                      SHA-256 {r.sha256}
                    </p>
                    <Button size="sm" variant="secondary" icon={FileDown} className="mt-2" onClick={() => void openPdf(r)}>
                      Ouvrir le PDF
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4 text-xs text-slate-600">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Légende</h2>
            <ul className="space-y-1">
              <li>
                <ResultFlagMark flag="HIGH" /> / <ResultFlagMark flag="LOW" /> hors intervalle de référence
              </li>
              <li>
                <ResultFlagMark flag="CRITICAL_HIGH" /> / <ResultFlagMark flag="CRITICAL_LOW" /> valeur critique : communication obligatoire
              </li>
              <li>
                <ResultFlagMark flag="ABNORMAL" /> qualitatif différent de la valeur attendue
              </li>
              <li>« &lt;40 », « &gt;1000 » : résultat hors limites de mesure</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carte d'examen
// ---------------------------------------------------------------------------

interface Draft {
  value: string;
  comment: string;
}

function rawValueOf(r: ResultDto): string {
  return r.resultType === 'NUMERIC' ? r.displayValue.replace(/[  ]/g, ' ') : (r.textValue ?? '');
}

function liveFlag(r: ResultDto, raw: string): { flag: ResultFlag | null; invalid: boolean } {
  const value = raw.trim();
  if (value === '') return { flag: null, invalid: false };
  const range = r.reference
    ? { low: r.reference.low, high: r.reference.high, criticalLow: r.reference.criticalLow, criticalHigh: r.reference.criticalHigh, normalText: r.reference.normalText }
    : null;
  if (r.resultType === 'NUMERIC') {
    const parsed = parseNumericInput(value);
    if (!parsed) return { flag: null, invalid: true };
    return { flag: computeResultFlag('NUMERIC', { numeric: parsed }, range), invalid: false };
  }
  if (r.resultType === 'CHOICE' && !r.choices.some((c) => c.toLowerCase() === value.toLowerCase())) return { flag: null, invalid: true };
  return { flag: computeResultFlag(r.resultType, { text: value }, range), invalid: false };
}

function referenceLabel(r: ResultDto): string {
  if (!r.reference) return '—';
  return r.resultType === 'NUMERIC' ? formatNumericRange(r.reference.low, r.reference.high) : (r.reference.normalText ?? '—');
}

function ExamCard({ item, highlighted, onNotice }: { item: AnalysisItemDto; highlighted: boolean; onNotice: (m: string, tone?: 'success' | 'error') => void }) {
  const { hasRole } = useAuth();
  const isAnalyst = hasRole(...ANALYSIS_ROLES);
  const isBiologist = hasRole(...BIOLOGIST_ROLES);
  const editable = isAnalyst && (item.status === 'TO_ENTER' || item.status === 'ENTERED');
  const save = useSaveResults();
  const technical = useTechnicalValidation();
  const biological = useBiologicalValidation();
  const returnM = useReturnToEntry();
  const amend = useAmend();
  const ref = useRef<HTMLDivElement>(null);

  const initial = useMemo(() => Object.fromEntries(item.results.map((r) => [r.id, { value: rawValueOf(r), comment: r.comment ?? '' }])), [item.results]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [bioComment, setBioComment] = useState('');
  const [modal, setModal] = useState<'return' | 'amend' | null>(null);
  const [ackAlert, setAckAlert] = useState<CriticalAlertDto | null>(null);

  useEffect(() => {
    setDrafts(initial);
    setFieldErrors({});
  }, [initial]);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [highlighted]);

  const changed = item.results.filter((r) => drafts[r.id] && (drafts[r.id].value !== initial[r.id].value || drafts[r.id].comment !== initial[r.id].comment));
  const dirty = changed.length > 0;
  const openAlerts = item.alerts.filter((a) => !a.acknowledgedAt);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setError(null);
    try {
      await fn();
      onNotice(success);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])));
      }
      setError(errorMessage(err));
    }
  };

  const submitSave = () =>
    run(async () => {
      setFieldErrors({});
      await save.mutateAsync({
        itemId: item.id,
        body: { results: changed.map((r) => ({ resultId: r.id, value: drafts[r.id].value, comment: drafts[r.id].comment || undefined })) },
      });
    }, `${item.examCode} : résultats enregistrés.`);

  /** Entrée passe au champ suivant (saisie au clavier ou à la douchette sans souris). */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-result-input]') ?? []);
    const next = inputs[inputs.indexOf(e.currentTarget) + 1];
    if (next) next.focus();
    else if (dirty) void submitSave();
  };

  return (
    <div ref={ref} className="scroll-mt-4">
      <Card className={cn('overflow-hidden', highlighted && 'ring-2 ring-brand-600/50', openAlerts.length > 0 && 'border-red-300')}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-brand-800">{item.examCode}</span>
              <span className="font-semibold text-slate-900">{item.examName}</span>
              <AnalysisStatusBadge status={item.status} />
              {item.version > 1 && <Badge tone="danger">Version {item.version}</Badge>}
            </p>
            <p className="text-xs text-slate-500">
              {item.section.name} · échantillon <span className="font-mono">{item.sampleNumber}</span>
              {item.sampleReceivedAt && ` · reçu ${formatDateTime(item.sampleReceivedAt)}`}
              {item.dueAt && ` · échéance ${formatDateTime(item.dueAt)}`}
            </p>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {item.status === 'AWAITING_SAMPLE' && <Alert tone="info">L’échantillon n’a pas encore été reçu au laboratoire : la saisie s’ouvrira à la réception.</Alert>}
          {item.reservations.length > 0 && (
            <Alert tone="warning" title="Échantillon accepté sous réserve (dérogation)">
              {item.reservations.join(' ; ')} — la réserve figurera sur le compte rendu.
            </Alert>
          )}
          {item.alerts.length > 0 && (
            <ul className="space-y-1.5">
              {item.alerts.map((a) => (
                <li
                  key={a.id}
                  className={cn('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm', a.acknowledgedAt ? 'border-slate-200 bg-slate-50' : 'border-red-300 bg-red-50')}
                >
                  <span>
                    <AlertTriangle className={cn('mr-1 inline size-4', a.acknowledgedAt ? 'text-slate-400' : 'text-red-600')} aria-hidden />
                    <strong>{a.parameterName}</strong> {a.valueText} · {RESULT_FLAG_LABELS[a.flag]}
                    {a.acknowledgedAt ? (
                      <span className="block text-xs text-slate-600">
                        Communiqué à {a.notifiedTo} par {a.acknowledgedBy ?? '—'} le {formatDateTime(a.acknowledgedAt)}
                        {a.note && ` — ${a.note}`}
                      </span>
                    ) : (
                      <span className="block text-xs text-red-800">Détecté le {formatDateTime(a.detectedAt)} — communication au prescripteur non tracée</span>
                    )}
                  </span>
                  {!a.acknowledgedAt && isAnalyst && (
                    <Button size="sm" variant="danger" icon={PhoneCall} onClick={() => setAckAlert(a)}>
                      Tracer la communication
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && <Alert tone="error">{error}</Alert>}

          {item.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="py-2 pr-3">Paramètre</th>
                    <th className="py-2 pr-3">Résultat</th>
                    <th className="py-2 pr-3">Unité</th>
                    <th className="py-2 pr-3">Référence</th>
                    <th className="py-2 pr-3">Antériorité</th>
                    <th className="py-2">Commentaire</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {item.results.map((r) => {
                    const draft = drafts[r.id] ?? { value: '', comment: '' };
                    const live = editable ? liveFlag(r, draft.value) : { flag: r.flag, invalid: false };
                    const critical = live.flag === 'CRITICAL_LOW' || live.flag === 'CRITICAL_HIGH';
                    const err = fieldErrors[r.id];
                    return (
                      <tr key={r.id} className={cn(critical && 'bg-red-50/60')}>
                        <td className="py-2 pr-3 align-top">
                          <p className="font-medium text-slate-800">{r.parameterName}</p>
                          <p className="font-mono text-[11px] text-slate-400">{r.parameterCode}</p>
                        </td>
                        <td className="py-2 pr-3 align-top">
                          {editable ? (
                            <div className="flex items-center gap-2">
                              {r.resultType === 'CHOICE' ? (
                                <select
                                  data-result-input
                                  aria-label={r.parameterName}
                                  value={r.choices.find((c) => c.toLowerCase() === draft.value.toLowerCase()) ?? draft.value}
                                  onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...draft, value: e.target.value } }))}
                                  onKeyDown={onKeyDown}
                                  className={cn('w-40 rounded-md border px-2 py-1.5 text-sm', err || live.invalid ? 'border-red-500' : 'border-slate-300')}
                                >
                                  <option value="">—</option>
                                  {r.choices.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  data-result-input
                                  aria-label={r.parameterName}
                                  aria-invalid={!!err || live.invalid}
                                  inputMode={r.resultType === 'NUMERIC' ? 'decimal' : undefined}
                                  value={draft.value}
                                  onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...draft, value: e.target.value } }))}
                                  onKeyDown={onKeyDown}
                                  className={cn(
                                    'rounded-md border px-2 py-1.5 text-sm tabular-nums',
                                    r.resultType === 'TEXT' ? 'w-56' : 'w-28',
                                    err || live.invalid ? 'border-red-500 bg-red-50' : 'border-slate-300',
                                  )}
                                />
                              )}
                              <ResultFlagMark flag={live.flag} />
                            </div>
                          ) : (
                            <span className={cn('flex items-center gap-2 tabular-nums', r.flag && r.flag !== 'NORMAL' && 'font-semibold')}>
                              {r.displayValue || '—'} <ResultFlagMark flag={r.flag} />
                            </span>
                          )}
                          {r.source === 'INSTRUMENT' && (
                            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500" title={`Transmis par ${r.enteredBy ?? 'un automate'}${r.enteredAt ? `, ${formatDateTime(r.enteredAt)}` : ''}`}>
                              <Cable className="size-3" aria-hidden /> {r.enteredBy ?? 'Automate'}
                            </span>
                          )}
                          {(err || live.invalid) && (
                            <p className="mt-0.5 text-xs text-red-700">
                              {err ?? (r.resultType === 'CHOICE' ? `Choisir : ${r.choices.join(', ')}` : 'Nombre attendu (ex. 12,5 ou <40)')}
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-top text-slate-600">{r.unit ?? ''}</td>
                        <td className="py-2 pr-3 align-top text-slate-600" title={[r.reference?.label, r.reference?.comment].filter(Boolean).join(' — ')}>
                          {referenceLabel(r)}
                          {r.reference?.label && <span className="block text-[11px] text-slate-400">{r.reference.label}</span>}
                        </td>
                        <td className="py-2 pr-3 align-top text-slate-600">
                          {r.previous ? (
                            <span className="flex items-center gap-1 whitespace-nowrap">
                              <History className="size-3.5 text-slate-400" aria-hidden />
                              {r.previous.displayValue} <ResultFlagMark flag={r.previous.flag} />
                              <span className="text-[11px] text-slate-400">{formatDate(r.previous.validatedAt)}</span>
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-2 align-top">
                          {editable ? (
                            <input
                              aria-label={`Commentaire ${r.parameterName}`}
                              value={draft.comment}
                              maxLength={500}
                              onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...draft, comment: e.target.value } }))}
                              className="w-full min-w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          ) : (
                            <span className="text-xs text-slate-600">{r.comment ?? ''}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Traçabilité */}
          {(item.technicalValidatedAt || item.validatedAt || item.biologistComment || item.amendments.length > 0) && (
            <div className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {item.technicalValidatedAt && (
                <p>
                  <CheckCircle2 className="mr-1 inline size-3.5 text-brand-700" aria-hidden />
                  Validation technique : {item.technicalValidatedBy ?? '—'}, {formatDateTime(item.technicalValidatedAt)}
                </p>
              )}
              {item.validatedAt && (
                <p>
                  <CheckCheck className="mr-1 inline size-3.5 text-emerald-700" aria-hidden />
                  Validation biologique : {item.validatedBy ?? '—'}, {formatDateTime(item.validatedAt)}
                </p>
              )}
              {item.biologistComment && <p className="text-slate-800">Commentaire du biologiste : {item.biologistComment}</p>}
              {item.amendments.map((a) => (
                <p key={a.fromVersion}>
                  <PencilLine className="mr-1 inline size-3.5 text-red-700" aria-hidden />
                  Version {a.fromVersion} corrigée par {a.amendedBy ?? '—'} le {formatDateTime(a.amendedAt)} : {a.reason}
                </p>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-end justify-end gap-2">
            {editable && (
              <>
                <Button variant="secondary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => void submitSave()}>
                  Enregistrer
                </Button>
                <Button
                  icon={CheckCircle2}
                  disabled={dirty || item.status !== 'ENTERED'}
                  title={dirty ? 'Enregistrez d’abord les modifications' : item.status !== 'ENTERED' ? 'Tous les paramètres doivent être renseignés' : undefined}
                  loading={technical.isPending}
                  onClick={() => void run(() => technical.mutateAsync(item.id), `${item.examCode} : validé techniquement.`)}
                >
                  Valider techniquement
                </Button>
              </>
            )}
            {item.status === 'TECHNICAL_VALIDATED' && isBiologist && (
              <>
                <TextField
                  label="Commentaire d’interprétation (compte rendu)"
                  value={bioComment}
                  maxLength={1000}
                  onChange={(e) => setBioComment(e.target.value)}
                  containerClassName="min-w-72 flex-1"
                />
                <Button variant="secondary" icon={RotateCcw} onClick={() => setModal('return')}>
                  Renvoyer en saisie
                </Button>
                <Button
                  icon={CheckCheck}
                  disabled={openAlerts.length > 0}
                  title={openAlerts.length > 0 ? 'Valeur critique non communiquée' : undefined}
                  loading={biological.isPending}
                  onClick={() =>
                    void run(async () => {
                      await biological.mutateAsync({ itemId: item.id, body: { comment: bioComment || undefined } });
                      setBioComment('');
                    }, `${item.examCode} : validé biologiquement.`)
                  }
                >
                  Valider biologiquement
                </Button>
              </>
            )}
            {item.status === 'TECHNICAL_VALIDATED' && !isBiologist && <p className="text-sm text-slate-500">En attente de validation biologique.</p>}
            {item.status === 'VALIDATED' && isBiologist && (
              <Button variant="secondary" icon={PencilLine} onClick={() => setModal('amend')}>
                Corriger (compte rendu rectificatif)
              </Button>
            )}
          </div>
        </div>
      </Card>

      <ReasonModal
        open={modal === 'return'}
        title={`Renvoyer ${item.examCode} en saisie`}
        description="Les résultats repassent en saisie ; la validation technique est annulée. Le motif est consigné dans la piste d’audit."
        confirmLabel="Renvoyer en saisie"
        onClose={() => setModal(null)}
        onConfirm={async (reason) => {
          await returnM.mutateAsync({ itemId: item.id, reason });
          onNotice(`${item.examCode} renvoyé en saisie.`);
        }}
      />
      <ReasonModal
        open={modal === 'amend'}
        title={`Corriger ${item.examCode} après validation`}
        description="Les valeurs validées sont archivées (version conservée), l’examen repasse en saisie. À la nouvelle validation, un compte rendu rectificatif remplacera le précédent et mentionnera ce motif."
        confirmLabel="Ouvrir la correction"
        danger
        onClose={() => setModal(null)}
        onConfirm={async (reason) => {
          await amend.mutateAsync({ itemId: item.id, reason });
          onNotice(`${item.examCode} : correction ouverte (version ${item.version + 1}).`);
        }}
      />
      <AcknowledgeModal alert={ackAlert} onClose={() => setAckAlert(null)} onDone={(m) => onNotice(m)} />
    </div>
  );
}

function AcknowledgeModal({ alert, onClose, onDone }: { alert: CriticalAlertDto | null; onClose: () => void; onDone: (m: string) => void }) {
  const ack = useAcknowledgeAlert();
  const [notifiedTo, setNotifiedTo] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (alert) {
      setNotifiedTo('');
      setNote('');
      setErrors({});
      setFormError(null);
    }
  }, [alert]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alert) return;
    setFormError(null);
    const parsed = acknowledgeAlertSchema.safeParse({ notifiedTo, note });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    try {
      await ack.mutateAsync({ alertId: alert.id, body: parsed.data });
      onDone(`Communication de ${alert.parameterName} ${alert.valueText} tracée.`);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={!!alert}
      onClose={onClose}
      title="Communication d’un résultat critique"
      description={alert ? `${alert.parameterName} : ${alert.valueText} (${RESULT_FLAG_LABELS[alert.flag]}). Indiquez qui a été prévenu et par quel moyen ; l’heure et votre identité sont enregistrées.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="ack-form" variant="danger" icon={ShieldAlert} loading={ack.isPending}>
            Enregistrer la communication
          </Button>
        </>
      }
    >
      <form id="ack-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="Personne prévenue et moyen"
          required
          placeholder="Ex. Dr Kabongo (prescripteur), par téléphone"
          value={notifiedTo}
          onChange={(e) => setNotifiedTo(e.target.value)}
          error={errors.notifiedTo}
          autoFocus
        />
        <TextAreaField label="Note" placeholder="Consignes reçues, relecture de la valeur…" value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} />
      </form>
    </Modal>
  );
}
