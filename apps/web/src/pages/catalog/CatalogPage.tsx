import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, ChevronRight, FlaskRound, Layers, Pencil, Plus, RotateCcw, Search, TestTubes, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createExamSchema,
  createLabSectionSchema,
  createSampleTypeSchema,
  type CreateExamInput,
  type CreateLabSectionInput,
  type CreateSampleTypeInput,
  type LabSectionDto,
  type SampleTypeDto,
} from '@lims/shared';
import { CATALOG_TECHNICAL_WRITE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ReasonModal } from '@/components/ui/ReasonModal';
import {
  sampleTypesQuery,
  sectionsQuery,
  useCreateExam,
  useCreateSampleType,
  useCreateSection,
  useExams,
  useUpdateSampleType,
  useUpdateSection,
  type ExamsFilter,
} from '@/features/catalog';
import { settingsQuery } from '@/features/settings';
import { applyApiFieldErrors, cn, errorMessage, formatMoney, formatTurnaround } from '@/lib/utils';

type Tab = 'exams' | 'sections' | 'samples';
const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'exams', label: 'Examens', icon: FlaskRound },
  { id: 'sections', label: 'Sections', icon: Layers },
  { id: 'samples', label: 'Types d’échantillon', icon: TestTubes },
];

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('onglet') as Tab | null) ?? 'exams';

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Catalogue des examens" description="Examens proposés, tarifs, paramètres et valeurs de référence." />
      <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setParams(id === 'exams' ? {} : { onglet: id })}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium',
              tab === id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {tab === 'exams' && <ExamsTab />}
      {tab === 'sections' && <SectionsTab />}
      {tab === 'samples' && <SampleTypesTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Examens
// ---------------------------------------------------------------------------

function ExamsTab() {
  const { hasRole } = useAuth();
  const canWrite = hasRole(...CATALOG_TECHNICAL_WRITE_ROLES);
  const [filter, setFilter] = useState<ExamsFilter>({ page: 1, pageSize: 25, q: '', sectionId: undefined, status: 'active' });
  const [searchInput, setSearchInput] = useState('');
  const [creating, setCreating] = useState(false);
  const sections = useQuery(sectionsQuery);
  const settings = useQuery(settingsQuery);
  const { data, isLoading, isError, error, isFetching } = useExams(filter);

  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === searchInput ? f : { ...f, q: searchInput, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_220px_160px_auto] sm:items-end">
        <div className="relative">
          <TextField label="Rechercher" placeholder="Code ou nom" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-9" />
          <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
        </div>
        <SelectField
          label="Section"
          value={filter.sectionId ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, sectionId: e.target.value || undefined, page: 1 }))}
        >
          <option value="">Toutes</option>
          {sections.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Statut"
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as ExamsFilter['status'], page: 1 }))}
        >
          <option value="active">Actifs</option>
          <option value="inactive">Inactifs</option>
          <option value="all">Tous</option>
        </SelectField>
        {canWrite && (
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Nouvel examen
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <div className="p-4">
          <Alert tone="error">{errorMessage(error)}</Alert>
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={BookOpenCheck} title="Aucun examen">
          {filter.status === 'active' ? 'Les examens nouvellement créés sont inactifs : affichez « Inactifs » ou « Tous ».' : null}
        </EmptyState>
      ) : (
        <>
          <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Examen</th>
                  <th className="px-4 py-3">Section</th>
                  <th className="px-4 py-3">Échantillon</th>
                  <th className="px-4 py-3 text-right">Tarif</th>
                  <th className="px-4 py-3">Délai</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-slate-700">{e.code}</td>
                    <td className="px-4 py-3">
                      <Link to={`/catalogue/examens/${e.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                        {e.name}
                      </Link>
                      <div className="mt-0.5 flex gap-1">
                        {!e.isActive && <Badge tone="warning">Inactif</Badge>}
                        <span className="text-xs text-slate-500">
                          {e.activeParameterCount} paramètre{e.activeParameterCount > 1 ? 's' : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{e.section.name}</td>
                    <td className="px-4 py-3 text-slate-600">{e.sampleType.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(e.price, settings.data?.currency)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatTurnaround(e.turnaroundHours)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/catalogue/examens/${e.id}`} className="inline-flex text-slate-400 hover:text-brand-700" aria-label={`Ouvrir ${e.name}`}>
                        <ChevronRight className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={(page) => setFilter((f) => ({ ...f, page }))} />
        </>
      )}
      <CreateExamModal open={creating} onClose={() => setCreating(false)} />
    </Card>
  );
}

const EXAM_FIELDS = ['code', 'name', 'shortName', 'sectionId', 'sampleTypeId', 'price', 'turnaroundHours', 'patientInstructions'] as const;

function CreateExamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateExam();
  const sections = useQuery(sectionsQuery);
  const samples = useQuery(sampleTypesQuery);
  const settings = useQuery(settingsQuery);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<CreateExamInput>({
    resolver: zodResolver(createExamSchema),
  });

  useEffect(() => {
    if (open) {
      setFormError(null);
      reset({ code: '', name: '', shortName: '', sectionId: '', sampleTypeId: '', price: '', turnaroundHours: 24, patientInstructions: '', displayOrder: 0 });
    }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const exam = await create.mutateAsync(values);
      onClose();
      navigate(`/catalogue/examens/${exam.id}`);
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, EXAM_FIELDS)) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Nouvel examen"
      description="L’examen est créé inactif. Ajoutez ses paramètres et valeurs de référence, puis activez-le."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="exam-create-form" loading={create.isPending}>
            Créer et paramétrer
          </Button>
        </>
      }
    >
      <form id="exam-create-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-3">
        {formError && (
          <Alert tone="error" className="sm:col-span-3">
            {formError}
          </Alert>
        )}
        <TextField label="Code" required placeholder="NFS" className="font-mono uppercase" error={errors.code?.message} {...register('code')} />
        <TextField label="Libellé" required containerClassName="sm:col-span-2" error={errors.name?.message} {...register('name')} />
        <TextField label="Libellé court" error={errors.shortName?.message} {...register('shortName')} />
        <SelectField label="Section" required error={errors.sectionId?.message} {...register('sectionId')}>
          <option value="">— Choisir —</option>
          {sections.data?.filter((s) => s.isActive).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Type d’échantillon" required error={errors.sampleTypeId?.message} {...register('sampleTypeId')}>
          <option value="">— Choisir —</option>
          {samples.data?.filter((s) => s.isActive).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label={`Tarif (${settings.data?.currency ?? 'CDF'})`}
          required
          inputMode="decimal"
          error={errors.price?.message}
          {...register('price')}
        />
        <TextField label="Délai de rendu (heures)" required type="number" min={1} error={errors.turnaroundHours?.message} {...register('turnaroundHours')} />
        <TextAreaField
          label="Préparation du patient"
          placeholder="Ex. : à jeun depuis 8 heures"
          containerClassName="sm:col-span-3"
          error={errors.patientInstructions?.message}
          {...register('patientInstructions')}
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sections et types d'échantillon (même mécanique)
// ---------------------------------------------------------------------------

function SectionsTab() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const { data, isLoading, isError, error } = useQuery(sectionsQuery);
  const createM = useCreateSection();
  const updateM = useUpdateSection();
  const [editing, setEditing] = useState<LabSectionDto | null | undefined>(undefined);
  const [statusTarget, setStatusTarget] = useState<LabSectionDto | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (isError) return <Alert tone="error">{errorMessage(error)}</Alert>;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <p className="text-sm text-slate-500">Les sections organisent les paillasses et les listes de travail.</p>
        {isAdmin && (
          <Button icon={Plus} onClick={() => setEditing(null)}>
            Nouvelle section
          </Button>
        )}
      </div>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Ordre</th>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3">Nom</th>
            <th className="px-4 py-3">Examens actifs</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data?.map((s) => (
            <tr key={s.id} className={s.isActive ? '' : 'text-slate-400'}>
              <td className="px-4 py-3 tabular-nums">{s.displayOrder}</td>
              <td className="px-4 py-3 font-mono text-xs font-semibold">{s.code}</td>
              <td className="px-4 py-3">
                {s.name} {!s.isActive && <Badge tone="warning">Inactive</Badge>}
              </td>
              <td className="px-4 py-3 tabular-nums">{s.activeExamCount}</td>
              <td className="px-4 py-3">
                {isAdmin && (
                  <div className="flex justify-end gap-1">
                    <IconAction label="Modifier" icon={Pencil} onClick={() => setEditing(s)} />
                    <IconAction
                      label={s.isActive ? 'Désactiver' : 'Réactiver'}
                      icon={s.isActive ? X : RotateCcw}
                      danger={s.isActive}
                      disabled={s.isActive && s.activeExamCount > 0}
                      onClick={() => setStatusTarget(s)}
                    />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SimpleCatalogModal<CreateLabSectionInput>
        open={editing !== undefined}
        title={editing ? `Modifier la section ${editing.code}` : 'Nouvelle section'}
        schema={createLabSectionSchema}
        defaults={{ code: editing?.code ?? '', name: editing?.name ?? '', displayOrder: editing?.displayOrder ?? 0 }}
        codeLocked={!!editing}
        fields={[
          { name: 'code', label: 'Code' },
          { name: 'name', label: 'Nom' },
          { name: 'displayOrder', label: 'Ordre d’affichage', type: 'number' },
        ]}
        onClose={() => setEditing(undefined)}
        onSubmit={(v) =>
          editing ? updateM.mutateAsync({ id: editing.id, body: { name: v.name, displayOrder: v.displayOrder } }) : createM.mutateAsync(v)
        }
      />
      <ReasonModal
        open={!!statusTarget}
        title={`${statusTarget?.isActive ? 'Désactiver' : 'Réactiver'} la section ${statusTarget?.name ?? ''}`}
        confirmLabel={statusTarget?.isActive ? 'Désactiver' : 'Réactiver'}
        danger={statusTarget?.isActive}
        onClose={() => setStatusTarget(null)}
        onConfirm={(reason) => updateM.mutateAsync({ id: statusTarget!.id, body: { isActive: !statusTarget!.isActive, reason } })}
      />
    </Card>
  );
}

function SampleTypesTab() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const { data, isLoading, isError, error } = useQuery(sampleTypesQuery);
  const createM = useCreateSampleType();
  const updateM = useUpdateSampleType();
  const [editing, setEditing] = useState<SampleTypeDto | null | undefined>(undefined);
  const [statusTarget, setStatusTarget] = useState<SampleTypeDto | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (isError) return <Alert tone="error">{errorMessage(error)}</Alert>;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <p className="text-sm text-slate-500">Nature de l’échantillon, contenant et consignes de prélèvement.</p>
        {isAdmin && (
          <Button icon={Plus} onClick={() => setEditing(null)}>
            Nouveau type
          </Button>
        )}
      </div>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3">Nom</th>
            <th className="px-4 py-3">Contenant</th>
            <th className="px-4 py-3">Consignes</th>
            <th className="px-4 py-3">Examens</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data?.map((s) => (
            <tr key={s.id} className={s.isActive ? '' : 'text-slate-400'}>
              <td className="px-4 py-3 font-mono text-xs font-semibold">{s.code}</td>
              <td className="px-4 py-3">
                {s.name} {!s.isActive && <Badge tone="warning">Inactif</Badge>}
              </td>
              <td className="px-4 py-3 text-slate-600">{s.container ?? '—'}</td>
              <td className="max-w-sm px-4 py-3 text-xs text-slate-500">{s.instructions ?? '—'}</td>
              <td className="px-4 py-3 tabular-nums">{s.activeExamCount}</td>
              <td className="px-4 py-3">
                {isAdmin && (
                  <div className="flex justify-end gap-1">
                    <IconAction label="Modifier" icon={Pencil} onClick={() => setEditing(s)} />
                    <IconAction
                      label={s.isActive ? 'Désactiver' : 'Réactiver'}
                      icon={s.isActive ? X : RotateCcw}
                      danger={s.isActive}
                      disabled={s.isActive && s.activeExamCount > 0}
                      onClick={() => setStatusTarget(s)}
                    />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SimpleCatalogModal<CreateSampleTypeInput>
        open={editing !== undefined}
        title={editing ? `Modifier ${editing.code}` : 'Nouveau type d’échantillon'}
        schema={createSampleTypeSchema}
        defaults={{ code: editing?.code ?? '', name: editing?.name ?? '', container: editing?.container ?? '', instructions: editing?.instructions ?? '' }}
        codeLocked={!!editing}
        fields={[
          { name: 'code', label: 'Code' },
          { name: 'name', label: 'Nom' },
          { name: 'container', label: 'Contenant' },
          { name: 'instructions', label: 'Consignes de prélèvement', type: 'textarea' },
        ]}
        onClose={() => setEditing(undefined)}
        onSubmit={(v) =>
          editing
            ? updateM.mutateAsync({ id: editing.id, body: { name: v.name, container: v.container, instructions: v.instructions } })
            : createM.mutateAsync(v)
        }
      />
      <ReasonModal
        open={!!statusTarget}
        title={`${statusTarget?.isActive ? 'Désactiver' : 'Réactiver'} ${statusTarget?.name ?? ''}`}
        confirmLabel={statusTarget?.isActive ? 'Désactiver' : 'Réactiver'}
        danger={statusTarget?.isActive}
        onClose={() => setStatusTarget(null)}
        onConfirm={(reason) => updateM.mutateAsync({ id: statusTarget!.id, body: { isActive: !statusTarget!.isActive, reason } })}
      />
    </Card>
  );
}

interface SimpleField<T> {
  name: keyof T & string;
  label: string;
  type?: 'text' | 'number' | 'textarea';
}

function SimpleCatalogModal<T extends { code: string; name: string }>({
  open,
  title,
  schema,
  defaults,
  fields,
  codeLocked,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  schema: Parameters<typeof zodResolver>[0];
  defaults: T;
  fields: SimpleField<T>[];
  codeLocked: boolean;
  onClose: () => void;
  onSubmit: (values: T) => Promise<unknown>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(schema) });
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = form;

  useEffect(() => {
    if (open) {
      reset(defaults as Record<string, unknown>);
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values as T);
      onClose();
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, fields.map((f) => f.name))) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="simple-catalog-form" loading={isSubmitting}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="simple-catalog-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        {fields.map((f) => {
          const error = errors[f.name]?.message as string | undefined;
          if (f.type === 'textarea') return <TextAreaField key={f.name} label={f.label} error={error} {...register(f.name)} />;
          return (
            <TextField
              key={f.name}
              label={f.label}
              type={f.type ?? 'text'}
              required={f.name === 'code' || f.name === 'name'}
              readOnly={f.name === 'code' && codeLocked}
              className={f.name === 'code' ? cn('font-mono uppercase', codeLocked && 'bg-slate-100 text-slate-500') : undefined}
              error={error}
              {...register(f.name)}
            />
          );
        })}
      </form>
    </Modal>
  );
}
