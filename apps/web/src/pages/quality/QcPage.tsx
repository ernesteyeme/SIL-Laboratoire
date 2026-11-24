import { useQuery } from '@tanstack/react-query';
import { Activity, CalendarCheck, CalendarX, LineChart, Lock, Pencil, Plus, Target } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  QC_STATUS_LABELS,
  QC_STATUSES,
  QC_TARGET_SOURCE_LABELS,
  QC_TARGET_SOURCES,
  qcMaterialSchema,
  qcTargetSchema,
  type QcMaterialDto,
  type QcParameterStatusDto,
  type QcStatus,
  type QcTargetDto,
  type QcTargetSource,
} from '@lims/shared';
import { ANALYSIS_ROLES, QC_CONFIG_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { QcStatusBadge } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { examQuery, sectionsQuery, useExams } from '@/features/catalog';
import { qcMaterialsQuery, qcStatusQuery, useQcRuns, useSaveQcMaterial, useSaveQcTarget, type QcRunsFilter } from '@/features/quality';
import { ApiError } from '@/lib/api';
import { cn, errorMessage, formatDate, formatDateTime, zodFieldErrors } from '@/lib/utils';
import { fmt, fmtZ, QcEntryButton, QcRunDetailModal, QcRunEntryModal, RulesList } from './QcRunModals';

type Tab = 'status' | 'runs' | 'materials';

export function QcPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('onglet') as Tab | null) ?? 'status';
  const runId = params.get('serie');
  const [sectionId, setSectionId] = useState('');
  const sections = useQuery(sectionsQuery);
  const setTab = (t: Tab) => setParams(t === 'status' ? {} : { onglet: t });
  const openRun = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('serie', id);
    else next.delete('serie');
    setParams(next);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Contrôle qualité interne"
        description="Séries de contrôle évaluées par les règles de Westgard. Une série rejetée bloque la validation des résultats patients du paramètre jusqu’à une série acceptée."
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <div className="flex gap-1" role="tablist">
          {(
            [
              ['status', 'Paramètres suivis'],
              ['runs', 'Historique des séries'],
              ['materials', 'Lots et cibles'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700')}
            >
              {label}
            </button>
          ))}
        </div>
        {tab !== 'materials' && (
          <SelectField label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} containerClassName="mb-2 w-56">
            <option value="">Toutes les sections</option>
            {(sections.data ?? []).filter((s) => s.isActive).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        )}
      </div>

      {tab === 'status' && <StatusTab sectionId={sectionId || undefined} onOpenRun={openRun} />}
      {tab === 'runs' && <RunsTab key={sectionId} sectionId={sectionId || undefined} onOpenRun={openRun} />}
      {tab === 'materials' && <MaterialsTab />}
      <QcRunDetailModal runId={runId} onClose={() => openRun(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paramètres suivis
// ---------------------------------------------------------------------------

function StatusTab({ sectionId, onOpenRun }: { sectionId?: string; onOpenRun: (id: string) => void }) {
  const { hasRole } = useAuth();
  const canEnter = hasRole(...ANALYSIS_ROLES);
  const { data, isLoading, isError, error } = useQuery(qcStatusQuery(sectionId));
  const [entry, setEntry] = useState<QcParameterStatusDto | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (isError) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!data || data.length === 0) {
    return (
      <Card>
        <EmptyState icon={Target} title="Aucun paramètre sous contrôle qualité">
          Déclarez les lots de contrôle et leurs cibles dans l’onglet « Lots et cibles ».
        </EmptyState>
      </Card>
    );
  }
  const blocking = data.filter((d) => d.blocking);
  const notRun = data.filter((d) => !d.ranToday);

  return (
    <>
      {blocking.length > 0 && (
        <Alert tone="error" className="mb-4" title="Validation bloquée par un CIQ rejeté">
          {blocking.map((b) => b.parameter.name).join(', ')} — documentez l’action corrective puis repassez une série.
        </Alert>
      )}
      {notRun.length > 0 && (
        <Alert tone="warning" className="mb-4">
          Pas encore de CIQ aujourd’hui : {notRun.map((b) => b.parameter.name).join(', ')}.
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map((d) => (
          <Card key={d.parameter.id} className={cn('flex flex-col p-4', d.blocking && 'border-red-300')}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{d.parameter.name}</p>
                <p className="text-xs text-slate-500">
                  <span className="font-mono">{d.parameter.examCode}</span> · {d.parameter.sectionName}
                  {d.parameter.unit && ` · ${d.parameter.unit}`}
                </p>
              </div>
              {d.lastRun ? <QcStatusBadge status={d.lastRun.status} /> : <Badge>Jamais passé</Badge>}
            </div>
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              <p className="flex items-center gap-1.5">
                {d.ranToday ? <CalendarCheck className="size-4 text-emerald-700" aria-hidden /> : <CalendarX className="size-4 text-amber-700" aria-hidden />}
                {d.lastRun ? (
                  <button className="hover:underline" onClick={() => onOpenRun(d.lastRun!.id)}>
                    Dernière série : {formatDateTime(d.lastRun.performedAt)}
                  </button>
                ) : (
                  'Aucune série'
                )}
              </p>
              {d.blocking && (
                <p className="flex items-center gap-1.5 font-medium text-red-700">
                  <Lock className="size-4" aria-hidden /> {d.lastRun?.resolved ? 'Action corrective faite : repassez le contrôle' : 'Action corrective attendue'}
                </p>
              )}
            </div>
            <ul className="mt-3 space-y-1 text-xs">
              {d.targets.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span>
                    {t.level} <span className="text-slate-400">· lot {t.lotNumber}</span>
                    {t.expired && (
                      <Badge tone="danger">
                        périmé
                      </Badge>
                    )}
                  </span>
                  <Link to={`/qualite/ciq/levey-jennings/${t.id}`} className="inline-flex items-center gap-1 tabular-nums text-brand-700 hover:underline">
                    {fmt(t.mean)} ± {fmt(t.sd)} <LineChart className="size-3.5" aria-label="Graphique de Levey-Jennings" />
                  </Link>
                </li>
              ))}
            </ul>
            {canEnter && (
              <div className="mt-auto pt-4">
                {d.blocking && !d.lastRun?.resolved ? (
                  <Button size="sm" variant="danger" onClick={() => onOpenRun(d.lastRun!.id)}>
                    Documenter l’action corrective
                  </Button>
                ) : (
                  <QcEntryButton onClick={() => setEntry(d)} />
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
      <QcRunEntryModal
        item={entry}
        onClose={() => setEntry(null)}
        onCreated={(id) => {
          setEntry(null);
          onOpenRun(id);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Historique des séries
// ---------------------------------------------------------------------------

function RunsTab({ sectionId, onOpenRun }: { sectionId?: string; onOpenRun: (id: string) => void }) {
  const [filter, setFilter] = useState<QcRunsFilter>({ page: 1, pageSize: 25, sectionId });
  const { data, isLoading, isError, error, isFetching } = useQcRuns(filter);
  const set = (patch: Partial<QcRunsFilter>) => setFilter((f) => ({ ...f, ...patch, page: 1 }));

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
        <SelectField label="Statut" value={filter.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as QcStatus | undefined })} containerClassName="w-44">
          <option value="">Tous</option>
          {QC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {QC_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <TextField label="Du" type="date" value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} containerClassName="w-44" />
        <TextField label="Au" type="date" value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} containerClassName="w-44" />
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-700" checked={filter.unresolved === 'true'} onChange={(e) => set({ unresolved: e.target.checked ? 'true' : undefined })} />
          Rejets sans action corrective
        </label>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <div className="p-4">
          <Alert tone="error">{errorMessage(error)}</Alert>
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={Activity} title="Aucune série" />
      ) : (
        <>
          <div className={cn('overflow-x-auto', isFetching && 'opacity-60')}>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Paramètre</th>
                  <th className="px-4 py-3">Niveaux (z)</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Règles</th>
                  <th className="px-4 py-3">Opérateur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((r) => (
                  <tr key={r.id} className={cn('cursor-pointer hover:bg-slate-50', r.excludedAt && 'text-slate-400')} onClick={() => onOpenRun(r.id)}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{formatDateTime(r.performedAt)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.parameter.name}</p>
                      <p className="text-xs text-slate-500">{r.parameter.sectionName}</p>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {r.results.map((x) => (
                        <span key={x.id} className="mr-3 whitespace-nowrap">
                          {x.level.split(' ')[0]} {x.level.split(' ')[1] ?? ''} : {fmt(x.value, r.parameter.decimals)} ({fmtZ(x.z)})
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <QcStatusBadge status={r.status} />
                        {r.excludedAt && <Badge>Exclue</Badge>}
                        {r.status === 'REJECTED' && !r.resolvedAt && !r.excludedAt && <Badge tone="danger">Action attendue</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RulesList rules={r.rules} />
                    </td>
                    <td className="px-4 py-3 text-xs">{r.performedBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={(page) => setFilter((f) => ({ ...f, page }))} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lots et cibles
// ---------------------------------------------------------------------------

function MaterialsTab() {
  const { hasRole } = useAuth();
  const canConfig = hasRole(...QC_CONFIG_ROLES);
  const [includeInactive, setIncludeInactive] = useState(false);
  const { data, isLoading, isError, error } = useQuery(qcMaterialsQuery(includeInactive));
  const [editing, setEditing] = useState<QcMaterialDto | 'new' | null>(null);
  const [targetFor, setTargetFor] = useState<{ material: QcMaterialDto; target: QcTargetDto | null } | null>(null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-700" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Afficher les lots inactifs
        </label>
        {canConfig && (
          <Button icon={Plus} onClick={() => setEditing('new')}>
            Nouveau lot de contrôle
          </Button>
        )}
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <Alert tone="error">{errorMessage(error)}</Alert>
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState icon={Target} title="Aucun lot de contrôle" />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((m) => (
            <Card key={m.id} className={cn('p-4', !m.isActive && 'opacity-60')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                    {m.name} — {m.level}
                    {!m.isActive && <Badge>Inactif</Badge>}
                    {m.expired && <Badge tone="danger">Périmé</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    Lot <span className="font-mono">{m.lotNumber}</span>
                    {m.manufacturer && ` · ${m.manufacturer}`} · péremption {formatDate(m.expiresOn)}
                    {m.section && ` · ${m.section.name}`}
                  </p>
                </div>
                {canConfig && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" icon={Target} onClick={() => setTargetFor({ material: m, target: null })}>
                      Ajouter une cible
                    </Button>
                    <IconAction label="Modifier le lot" icon={Pencil} onClick={() => setEditing(m)} />
                  </div>
                )}
              </div>
              {m.targets.length > 0 && (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="py-1.5 pr-3">Paramètre</th>
                      <th className="py-1.5 pr-3 text-right">Moyenne</th>
                      <th className="py-1.5 pr-3 text-right">ET</th>
                      <th className="py-1.5 pr-3 text-right">CV</th>
                      <th className="py-1.5 pr-3">Origine</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {m.targets.map((t) => (
                      <tr key={t.id} className={cn(!t.isActive && 'text-slate-400')}>
                        <td className="py-1.5 pr-3">
                          {t.parameter.name} <span className="text-xs text-slate-400">({t.parameter.examCode})</span>
                          {!t.isActive && <span className="ml-1 text-xs">· inactive</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(t.mean)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(t.sd)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{t.cvPercent === null ? '—' : `${fmt(t.cvPercent, 1)} %`}</td>
                        <td className="py-1.5 pr-3 text-xs">{QC_TARGET_SOURCE_LABELS[t.source]}</td>
                        <td className="py-1.5 text-right">
                          <span className="inline-flex gap-1">
                            <Link to={`/qualite/ciq/levey-jennings/${t.id}`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" title="Graphique de Levey-Jennings">
                              <LineChart className="size-4" aria-label="Graphique de Levey-Jennings" />
                            </Link>
                            {canConfig && <IconAction label="Modifier la cible" icon={Pencil} onClick={() => setTargetFor({ material: m, target: t })} />}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ))}
        </div>
      )}
      <MaterialModal material={editing} onClose={() => setEditing(null)} />
      <TargetModal ctx={targetFor} onClose={() => setTargetFor(null)} />
    </>
  );
}

function MaterialModal({ material, onClose }: { material: QcMaterialDto | 'new' | null; onClose: () => void }) {
  const save = useSaveQcMaterial();
  const sections = useQuery(sectionsQuery);
  const existing = material && material !== 'new' ? material : null;
  const empty = { name: '', manufacturer: '', lotNumber: '', level: '', expiresOn: '', sectionId: '', isActive: true };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!material) return;
    setForm(
      existing
        ? { name: existing.name, manufacturer: existing.manufacturer ?? '', lotNumber: existing.lotNumber, level: existing.level, expiresOn: existing.expiresOn, sectionId: existing.section?.id ?? '', isActive: existing.isActive }
        : empty,
    );
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = qcMaterialSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ id: existing?.id, body: parsed.data });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])));
      setFormError(errorMessage(err));
    }
  };
  const field = (k: keyof typeof form) => ({ value: String(form[k]), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value })), error: errors[k] });

  return (
    <Modal
      open={!!material}
      onClose={onClose}
      title={existing ? `Lot ${existing.lotNumber}` : 'Nouveau lot de contrôle'}
      description="Un lot par niveau de contrôle. Les cibles (moyenne, écart-type) se déclarent ensuite pour chaque paramètre."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="qc-material-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="qc-material-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <TextField label="Nom du contrôle" required placeholder="Contrôle chimie Lyphochek" containerClassName="sm:col-span-2" {...field('name')} />
        <TextField label="Niveau" required placeholder="Niveau 1 (normal)" {...field('level')} />
        <TextField label="N° de lot" required {...field('lotNumber')} />
        <TextField label="Fabricant" {...field('manufacturer')} />
        <TextField label="Péremption" type="date" required {...field('expiresOn')} />
        <SelectField label="Section" containerClassName="sm:col-span-2" {...field('sectionId')}>
          <option value="">—</option>
          {(sections.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        {existing && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-brand-700" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Lot actif (décocher à la fin du lot)
          </label>
        )}
      </form>
    </Modal>
  );
}

function TargetModal({ ctx, onClose }: { ctx: { material: QcMaterialDto; target: QcTargetDto | null } | null; onClose: () => void }) {
  const save = useSaveQcTarget();
  const exams = useExams({ page: 1, pageSize: 100, status: 'active' });
  const [examId, setExamId] = useState('');
  const exam = useQuery({ ...examQuery(examId), enabled: !!examId });
  const [form, setForm] = useState({ parameterId: '', mean: '', sd: '', source: 'MANUFACTURER' as QcTargetSource, isActive: true, reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const t = ctx?.target ?? null;

  useEffect(() => {
    if (!ctx) return;
    setExamId('');
    setForm(t ? { parameterId: t.parameter.id, mean: String(t.mean), sd: String(t.sd), source: t.source, isActive: t.isActive, reason: '' } : { parameterId: '', mean: '', sd: '', source: 'MANUFACTURER', isActive: true, reason: '' });
    setErrors({});
    setFormError(null);
  }, [ctx, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ctx) return;
    setFormError(null);
    const parsed = qcTargetSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ materialId: ctx.material.id, body: parsed.data });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };
  const numeric = (exam.data?.parameters ?? []).filter((p) => p.resultType === 'NUMERIC' && p.isActive);

  return (
    <Modal
      open={!!ctx}
      onClose={onClose}
      title={t ? `Cible ${t.parameter.name}` : 'Nouvelle cible'}
      description={ctx ? `${ctx.material.name} — ${ctx.material.level} (lot ${ctx.material.lotNumber})` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="qc-target-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="qc-target-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        {!t && (
          <>
            <SelectField label="Examen" value={examId} onChange={(e) => { setExamId(e.target.value); setForm((f) => ({ ...f, parameterId: '' })); }}>
              <option value="">Choisir…</option>
              {(exams.data?.items ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} — {x.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Paramètre (numérique)" required value={form.parameterId} onChange={(e) => setForm((f) => ({ ...f, parameterId: e.target.value }))} error={errors.parameterId} disabled={!examId}>
              <option value="">{examId && numeric.length === 0 ? 'Aucun paramètre numérique' : 'Choisir…'}</option>
              {numeric.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.unit ? ` (${p.unit})` : ''}
                </option>
              ))}
            </SelectField>
          </>
        )}
        <TextField label="Moyenne cible" required inputMode="decimal" value={form.mean} onChange={(e) => setForm((f) => ({ ...f, mean: e.target.value }))} error={errors.mean} />
        <TextField label="Écart-type cible" required inputMode="decimal" value={form.sd} onChange={(e) => setForm((f) => ({ ...f, sd: e.target.value }))} error={errors.sd} />
        <SelectField label="Origine de la cible" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as QcTargetSource }))} containerClassName="sm:col-span-2">
          {QC_TARGET_SOURCES.map((s) => (
            <option key={s} value={s}>
              {QC_TARGET_SOURCE_LABELS[s]}
            </option>
          ))}
        </SelectField>
        {t && (
          <>
            <TextField label="Motif de la modification" hint="Obligatoire si la moyenne ou l’écart-type change (tracé dans l’audit)." containerClassName="sm:col-span-2" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} error={errors.reason} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4 accent-brand-700" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              Cible active
            </label>
          </>
        )}
      </form>
    </Modal>
  );
}
