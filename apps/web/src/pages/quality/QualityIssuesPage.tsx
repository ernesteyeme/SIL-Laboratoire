import { useQuery } from '@tanstack/react-query';
import { Ban, CalendarClock, CheckCheck, ClipboardList, Plus, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  closeQualityIssueSchema,
  createQualityIssueSchema,
  planQualityIssueSchema,
  QUALITY_ISSUE_CATEGORIES,
  QUALITY_ISSUE_CATEGORY_LABELS,
  QUALITY_ISSUE_SEVERITIES,
  QUALITY_ISSUE_SEVERITY_LABELS,
  QUALITY_ISSUE_STATUS_LABELS,
  QUALITY_ISSUE_STATUSES,
  type QualityIssueCategory,
  type QualityIssueDto,
  type QualityIssueSeverity,
  type QualityIssueStatus,
} from '@lims/shared';
import { QUALITY_CLOSE_ROLES, QUALITY_MANAGE_ROLES, QUALITY_READ_ALL_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { QualityIssueStatusBadge, SeverityBadge } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ReasonModal } from '@/components/ui/ReasonModal';
import { qualityIssueQuery, useCancelIssue, useCloseIssue, useDeclareIssue, usePlanIssue, useQualityIssues, type IssuesFilter } from '@/features/quality';
import { ApiError } from '@/lib/api';
import { cn, errorMessage, formatDate, formatDateTime, zodFieldErrors } from '@/lib/utils';

/** « AAAA-MM-JJTHH:MM » local pour un champ datetime-local. */
function localDateTimeValue(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function QualityIssuesPage() {
  const { hasRole } = useAuth();
  const readAll = hasRole(...QUALITY_READ_ALL_ROLES);
  const [params, setParams] = useSearchParams();
  const openId = params.get('fiche');
  const [declareOpen, setDeclareOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<IssuesFilter>({ page: 1, pageSize: 20, q: '' });
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === search ? f : { ...f, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);
  const set = (patch: Partial<IssuesFilter>) => setFilter((f) => ({ ...f, ...patch, page: 1 }));
  const { data, isLoading, isError, error, isFetching } = useQualityIssues(filter);
  const open = (id: string | null) => setParams(id ? { fiche: id } : {});

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Non-conformités"
        description={
          readAll
            ? 'Fiches de non-conformité : déclaration, analyse des causes, actions correctives, vérification d’efficacité.'
            : 'Signalez toute anomalie (échantillon, résultat, équipement, réclamation…). Vous voyez ici vos déclarations et leur suivi.'
        }
        actions={
          <Button icon={Plus} onClick={() => setDeclareOpen(true)}>
            Déclarer une non-conformité
          </Button>
        }
      />
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-64 flex-1">
            <TextField label="Rechercher" placeholder="N° de fiche, intitulé, n° de demande ou d’échantillon" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
          </div>
          <SelectField label="Statut" value={filter.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as QualityIssueStatus | undefined })} containerClassName="w-48">
            <option value="">Tous</option>
            {QUALITY_ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {QUALITY_ISSUE_STATUS_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Catégorie" value={filter.category ?? ''} onChange={(e) => set({ category: (e.target.value || undefined) as QualityIssueCategory | undefined })} containerClassName="w-48">
            <option value="">Toutes</option>
            {QUALITY_ISSUE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {QUALITY_ISSUE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Gravité" value={filter.severity ?? ''} onChange={(e) => set({ severity: (e.target.value || undefined) as QualityIssueSeverity | undefined })} containerClassName="w-36">
            <option value="">Toutes</option>
            {QUALITY_ISSUE_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {QUALITY_ISSUE_SEVERITY_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-700" checked={filter.overdue === 'true'} onChange={(e) => set({ overdue: e.target.checked ? 'true' : undefined })} />
            Actions en retard
          </label>
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : isError ? (
          <div className="p-4">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={ShieldAlert} title="Aucune fiche" />
        ) : (
          <>
            <div className={cn('overflow-x-auto', isFetching && 'opacity-60')}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Fiche</th>
                    <th className="px-4 py-3">Intitulé</th>
                    <th className="px-4 py-3">Gravité</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Échéance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((i) => (
                    <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => open(i.id)}>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-brand-800">{i.number}</span>
                        <span className="block text-xs text-slate-500">{formatDateTime(i.declaredAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{i.title}</p>
                        <p className="text-xs text-slate-500">
                          {QUALITY_ISSUE_CATEGORY_LABELS[i.category]} · {i.declaredBy ?? '—'}
                          {i.qcRunId && ' · CIQ'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <SeverityBadge severity={i.severity} />
                      </td>
                      <td className="px-4 py-3">
                        <QualityIssueStatusBadge status={i.status} />
                      </td>
                      <td className={cn('whitespace-nowrap px-4 py-3 text-xs', i.overdue ? 'font-semibold text-red-700' : 'text-slate-600')}>
                        {i.overdue && <CalendarClock className="mr-1 inline size-3.5" aria-label="En retard" />}
                        {i.actionDueDate ? formatDate(i.actionDueDate) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={(page) => setFilter((f) => ({ ...f, page }))} />
          </>
        )}
      </Card>
      <DeclareModal
        open={declareOpen}
        onClose={() => setDeclareOpen(false)}
        onDone={(i) => {
          setNotice(`Fiche ${i.number} enregistrée.`);
          open(i.id);
        }}
      />
      <IssueModal id={openId} onClose={() => open(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Déclaration
// ---------------------------------------------------------------------------

function DeclareModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (i: QualityIssueDto) => void }) {
  const declare = useDeclareIssue();
  const empty = { title: '', category: 'PRE_ANALYTICAL' as QualityIssueCategory, severity: 'MINOR' as QualityIssueSeverity, description: '', detectedAt: '', immediateAction: '', orderNumber: '', sampleNumber: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ ...empty, detectedAt: localDateTimeValue() });
      setErrors({});
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = createQualityIssueSchema.safeParse({ ...form, detectedAt: form.detectedAt ? new Date(form.detectedAt).toISOString() : '' });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      const created = await declare.mutateAsync(parsed.data);
      onClose();
      onDone(created);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])));
      setFormError(errorMessage(err));
    }
  };
  const bind = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
    error: errors[k],
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Déclarer une non-conformité"
      description="Décrivez les faits constatés. Le responsable qualité analysera les causes et définira les actions."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="declare-form" loading={declare.isPending}>
            Enregistrer la déclaration
          </Button>
        </>
      }
    >
      <form id="declare-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <TextField label="Intitulé" required containerClassName="sm:col-span-2" placeholder="Ex. tube hémolysé non signalé" {...bind('title')} />
        <SelectField label="Catégorie" {...bind('category')}>
          {QUALITY_ISSUE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {QUALITY_ISSUE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Gravité" {...bind('severity')}>
          {QUALITY_ISSUE_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {QUALITY_ISSUE_SEVERITY_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Description des faits" required containerClassName="sm:col-span-2" rows={4} {...bind('description')} />
        <TextField label="Constatée le" type="datetime-local" required {...bind('detectedAt')} />
        <div />
        <TextField label="N° de demande (facultatif)" placeholder="DEM-2026-000123" {...bind('orderNumber')} />
        <TextField label="N° d’échantillon (facultatif)" placeholder="2611220001" {...bind('sampleNumber')} />
        <TextAreaField label="Action immédiate réalisée" hint="Ce qui a été fait sur le moment (isolement, nouveau prélèvement, information du prescripteur…)." containerClassName="sm:col-span-2" {...bind('immediateAction')} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Fiche
// ---------------------------------------------------------------------------

function IssueModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: issue, isLoading, isError, error } = useQuery({ ...qualityIssueQuery(id ?? ''), enabled: !!id });
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={issue ? `${issue.number} — ${issue.title}` : 'Fiche de non-conformité'}>
      {isLoading || !issue ? isError ? <Alert tone="error">{errorMessage(error)}</Alert> : <LoadingBlock /> : <IssueDetail issue={issue} />}
    </Modal>
  );
}

function Section({ title, children, done }: { title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className={cn('rounded-md border p-3', done ? 'border-slate-200' : 'border-dashed border-slate-300')}>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function IssueDetail({ issue }: { issue: QualityIssueDto }) {
  const { hasRole } = useAuth();
  const canManage = hasRole(...QUALITY_MANAGE_ROLES);
  const canClose = hasRole(...QUALITY_CLOSE_ROLES);
  const active = issue.status === 'OPEN' || issue.status === 'IN_PROGRESS';
  const [planning, setPlanning] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancel = useCancelIssue();

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <QualityIssueStatusBadge status={issue.status} />
        <SeverityBadge severity={issue.severity} />
        <Badge>{QUALITY_ISSUE_CATEGORY_LABELS[issue.category]}</Badge>
        {issue.overdue && <Badge tone="danger">Action en retard</Badge>}
      </div>

      <Section title="Déclaration" done>
        <p className="whitespace-pre-line text-slate-800">{issue.description}</p>
        <p className="mt-1 text-xs text-slate-500">
          Constatée le {formatDateTime(issue.detectedAt)} · déclarée par {issue.declaredBy ?? '—'} le {formatDateTime(issue.declaredAt)}
        </p>
        {(issue.order || issue.sample || issue.qcRunId) && (
          <p className="mt-1 flex flex-wrap gap-3 text-xs">
            {issue.order && (
              <Link to={`/demandes/${issue.order.id}`} className="font-mono text-brand-700 hover:underline">
                {issue.order.number}
              </Link>
            )}
            {issue.sample && <span className="font-mono">Échantillon {issue.sample.number}</span>}
            {issue.qcRunId && (
              <Link to={`/qualite/ciq?serie=${issue.qcRunId}`} className="text-brand-700 hover:underline">
                Série de CIQ à l’origine
              </Link>
            )}
          </p>
        )}
        {issue.immediateAction && <p className="mt-2 text-slate-700">Action immédiate : {issue.immediateAction}</p>}
      </Section>

      <Section title="Analyse des causes et plan d’action" done={!!issue.correctiveAction}>
        {issue.correctiveAction && !planning ? (
          <div className="space-y-1">
            <p>
              <span className="text-slate-500">Cause : </span>
              {issue.rootCause}
            </p>
            <p>
              <span className="text-slate-500">Action corrective : </span>
              {issue.correctiveAction}
            </p>
            <p>
              <span className="text-slate-500">Responsable : </span>
              {issue.actionOwner} · <span className="text-slate-500">échéance </span>
              <span className={cn(issue.overdue && 'font-semibold text-red-700')}>{formatDate(issue.actionDueDate)}</span>
            </p>
            <p className="text-xs text-slate-500">
              Analyse par {issue.analyzedBy ?? '—'} le {formatDateTime(issue.analyzedAt)}
            </p>
            {active && canManage && (
              <Button size="sm" variant="ghost" onClick={() => setPlanning(true)}>
                Mettre à jour le plan
              </Button>
            )}
          </div>
        ) : active && canManage ? (
          <PlanForm issue={issue} onDone={() => setPlanning(false)} />
        ) : (
          <p className="text-slate-500">En attente d’analyse par le biologiste ou le responsable qualité.</p>
        )}
      </Section>

      <Section title="Vérification de l’efficacité et clôture" done={issue.status === 'CLOSED' || issue.status === 'CANCELLED'}>
        {issue.status === 'CLOSED' ? (
          <>
            <p>{issue.effectivenessCheck}</p>
            <p className="text-xs text-slate-500">
              Clôturée par {issue.closedBy ?? '—'} le {formatDateTime(issue.closedAt)}
            </p>
          </>
        ) : issue.status === 'CANCELLED' ? (
          <>
            <p>Annulée : {issue.cancelledReason}</p>
            <p className="text-xs text-slate-500">
              par {issue.closedBy ?? '—'} le {formatDateTime(issue.closedAt)}
            </p>
          </>
        ) : issue.status === 'IN_PROGRESS' && canClose ? (
          <CloseForm issue={issue} />
        ) : (
          <p className="text-slate-500">Clôture par le responsable qualité après réalisation de l’action et vérification de son efficacité.</p>
        )}
      </Section>

      {active && canClose && !issue.qcRunId && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" icon={Ban} onClick={() => setCancelOpen(true)}>
            Annuler (non fondée)
          </Button>
        </div>
      )}
      <ReasonModal
        open={cancelOpen}
        title={`Annuler ${issue.number}`}
        description="À utiliser seulement pour une déclaration non fondée. La fiche reste consultable avec le motif."
        confirmLabel="Annuler la fiche"
        danger
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          await cancel.mutateAsync({ id: issue.id, body: { reason } });
        }}
      />
    </div>
  );
}

function PlanForm({ issue, onDone }: { issue: QualityIssueDto; onDone: () => void }) {
  const plan = usePlanIssue();
  const [form, setForm] = useState({
    rootCause: issue.rootCause ?? '',
    correctiveAction: issue.correctiveAction ?? '',
    actionOwner: issue.actionOwner ?? '',
    actionDueDate: issue.actionDueDate ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const bind = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
    error: errors[k],
  });

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setFormError(null);
        const parsed = planQualityIssueSchema.safeParse(form);
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error.issues));
          return;
        }
        setErrors({});
        try {
          await plan.mutateAsync({ id: issue.id, body: parsed.data });
          onDone();
        } catch (err) {
          setFormError(errorMessage(err));
        }
      }}
    >
      {formError && (
        <Alert tone="error" className="sm:col-span-2">
          {formError}
        </Alert>
      )}
      <TextAreaField label="Analyse des causes" required containerClassName="sm:col-span-2" placeholder="Pourquoi ? (5 pourquoi, Ishikawa…)" {...bind('rootCause')} />
      <TextAreaField label="Action corrective" required containerClassName="sm:col-span-2" placeholder="Ce qui sera fait pour éviter la récidive" {...bind('correctiveAction')} />
      <TextField label="Responsable de l’action" required {...bind('actionOwner')} />
      <TextField label="Échéance" type="date" required {...bind('actionDueDate')} />
      <div className="sm:col-span-2">
        <Button type="submit" icon={ClipboardList} loading={plan.isPending}>
          Enregistrer le plan d’action
        </Button>
      </div>
    </form>
  );
}

function CloseForm({ issue }: { issue: QualityIssueDto }) {
  const close = useCloseIssue();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const parsed = closeQualityIssueSchema.safeParse({ effectivenessCheck: text });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.');
          return;
        }
        try {
          await close.mutateAsync({ id: issue.id, body: parsed.data });
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <TextAreaField label="Vérification de l’efficacité" required placeholder="Comment l’efficacité de l’action a été constatée (absence de récidive, audit, indicateur…)" value={text} onChange={(e) => setText(e.target.value)} error={error ?? undefined} />
      <Button type="submit" icon={CheckCheck} loading={close.isPending}>
        Clôturer la fiche
      </Button>
    </form>
  );
}
