import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleCheck, CirclePause, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import {
  formatAgeInterval,
  formatNumericRange,
  RANGE_SEX_LABELS,
  RESULT_TYPE_LABELS,
  updateExamSchema,
  type ExamDetailDto,
  type ExamParameterDto,
  type ReferenceRangeDto,
  type UpdateExamInput,
} from '@lims/shared';
import { CATALOG_TECHNICAL_WRITE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Badge, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/PageHeader';
import { ReasonModal } from '@/components/ui/ReasonModal';
import { examQuery, sampleTypesQuery, sectionsQuery, useDeleteRange, useUpdateExam, useUpdateParameter } from '@/features/catalog';
import { settingsQuery } from '@/features/settings';
import { applyApiFieldErrors, errorMessage, formatDateTime, formatMoney, formatTurnaround } from '@/lib/utils';
import { NotFoundPage } from '../NotFoundPage';
import { ParameterFormModal } from './ParameterFormModal';
import { RangeFormModal } from './RangeFormModal';

export function ExamDetailPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();
  const canWrite = hasRole(...CATALOG_TECHNICAL_WRITE_ROLES);
  const { data: exam, isLoading, isError, error } = useQuery(examQuery(id));
  const settings = useQuery(settingsQuery);
  const updateExam = useUpdateExam();
  const updateParam = useUpdateParameter();
  const deleteRange = useDeleteRange();

  const [editingExam, setEditingExam] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [paramForm, setParamForm] = useState<ExamParameterDto | null | undefined>(undefined);
  const [paramStatus, setParamStatus] = useState<ExamParameterDto | null>(null);
  const [rangeForm, setRangeForm] = useState<{ parameter: ExamParameterDto; range: ReferenceRangeDto | null } | null>(null);
  const [rangeDelete, setRangeDelete] = useState<ReferenceRangeDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (isError) {
    return (error as { status?: number })?.status === 404 ? <NotFoundPage /> : <Alert tone="error">{errorMessage(error)}</Alert>;
  }
  if (!exam) return null;

  const activeParams = exam.parameters.filter((p) => p.isActive);

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/catalogue" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="size-4" /> Catalogue
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-sm font-semibold text-white">{exam.code}</span>
            {exam.isActive ? <Badge tone="success">Actif — commandable</Badge> : <Badge tone="warning">Inactif</Badge>}
          </div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{exam.name}</h1>
          <p className="text-sm text-slate-500">
            {exam.section.name} · {exam.sampleType.name}
            {exam.sampleType.container && ` (${exam.sampleType.container})`}
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={Pencil} onClick={() => setEditingExam(true)}>
              Modifier
            </Button>
            <Button
              variant={exam.isActive ? 'secondary' : 'primary'}
              icon={exam.isActive ? CirclePause : CircleCheck}
              onClick={() => setStatusOpen(true)}
            >
              {exam.isActive ? 'Désactiver' : 'Activer'}
            </Button>
          </div>
        )}
      </div>

      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {!exam.isActive && activeParams.length === 0 && (
        <Alert tone="warning" className="mb-4" title="Examen non commandable">
          Ajoutez au moins un paramètre (et ses valeurs de référence), puis activez l’examen.
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Info label="Tarif" value={formatMoney(exam.price, settings.data?.currency)} />
        <Info label="Délai de rendu" value={formatTurnaround(exam.turnaroundHours)} />
        <Info label="Paramètres actifs" value={String(activeParams.length)} />
        <Info label="Dernière modification" value={formatDateTime(exam.updatedAt)} />
        {exam.patientInstructions && (
          <div className="sm:col-span-4">
            <Info label="Préparation du patient" value={exam.patientInstructions} />
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Paramètres et valeurs de référence</h2>
        {canWrite && (
          <Button size="sm" icon={Plus} onClick={() => setParamForm(null)}>
            Ajouter un paramètre
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {exam.parameters.length === 0 && (
          <Card className="p-6 text-center text-sm text-slate-500">Aucun paramètre défini pour cet examen.</Card>
        )}
        {exam.parameters.map((p) => (
          <Card key={p.id} className={p.isActive ? '' : 'opacity-60'}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">
                  {p.name} <span className="font-mono text-xs text-slate-500">{p.code}</span>
                  {!p.isActive && (
                    <span className="ml-2">
                      <Badge tone="warning">Inactif</Badge>
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {RESULT_TYPE_LABELS[p.resultType]}
                  {p.unit && ` · ${p.unit}`}
                  {p.resultType === 'NUMERIC' && p.decimals !== null && ` · ${p.decimals} décimale(s)`}
                  {p.resultType === 'CHOICE' && ` · ${p.choices.join(' / ')}`}
                </p>
              </div>
              {canWrite && (
                <div className="flex gap-1">
                  {p.isActive && (
                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => setRangeForm({ parameter: p, range: null })}>
                      Valeur de référence
                    </Button>
                  )}
                  <IconAction label="Modifier le paramètre" icon={Pencil} onClick={() => setParamForm(p)} />
                  <IconAction
                    label={p.isActive ? 'Désactiver le paramètre' : 'Réactiver le paramètre'}
                    icon={p.isActive ? CirclePause : CircleCheck}
                    danger={p.isActive}
                    onClick={() => setParamStatus(p)}
                  />
                </div>
              )}
            </div>
            {p.referenceRanges.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-3 text-sm text-amber-700">
                <TriangleAlert className="size-4" aria-hidden /> Aucune valeur de référence : le résultat ne pourra pas être interprété.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Sexe</th>
                      <th className="px-4 py-2">Âge</th>
                      <th className="px-4 py-2">{p.resultType === 'NUMERIC' ? 'Intervalle' : 'Valeur normale'}</th>
                      {p.resultType === 'NUMERIC' && <th className="px-4 py-2">Seuils critiques</th>}
                      <th className="px-4 py-2">Commentaire</th>
                      {canWrite && <th className="px-4 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {p.referenceRanges.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2">{RANGE_SEX_LABELS[r.sex]}</td>
                        <td className="whitespace-nowrap px-4 py-2">{formatAgeInterval(r.ageMinDays, r.ageMaxDays)}</td>
                        <td className="whitespace-nowrap px-4 py-2 font-medium tabular-nums">
                          {p.resultType === 'NUMERIC' ? `${formatNumericRange(r.low, r.high)}${p.unit ? ` ${p.unit}` : ''}` : r.normalText}
                        </td>
                        {p.resultType === 'NUMERIC' && (
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums text-red-700">
                            {r.criticalLow !== null && `< ${r.criticalLow}`}
                            {r.criticalLow !== null && r.criticalHigh !== null && ' · '}
                            {r.criticalHigh !== null && `> ${r.criticalHigh}`}
                            {r.criticalLow === null && r.criticalHigh === null && <span className="text-slate-400">—</span>}
                          </td>
                        )}
                        <td className="max-w-xs px-4 py-2 text-xs text-slate-500">{r.comment ?? ''}</td>
                        {canWrite && (
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <IconAction label="Modifier" icon={Pencil} onClick={() => setRangeForm({ parameter: p, range: r })} />
                              <IconAction label="Supprimer" icon={Trash2} danger onClick={() => setRangeDelete(r)} />
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>

      <EditExamModal open={editingExam} exam={exam} canEditPrice={hasRole('ADMIN')} onClose={() => setEditingExam(false)} onSaved={() => setNotice('Examen mis à jour.')} />

      <ReasonModal
        open={statusOpen}
        title={exam.isActive ? `Désactiver l’examen ${exam.code}` : `Activer l’examen ${exam.code}`}
        description={
          exam.isActive
            ? 'L’examen ne pourra plus être commandé. Les demandes existantes ne sont pas affectées.'
            : 'Confirmez que le paramétrage (paramètres, unités, valeurs de référence) a été vérifié.'
        }
        confirmLabel={exam.isActive ? 'Désactiver' : 'Activer'}
        danger={exam.isActive}
        placeholder={exam.isActive ? 'Ex. : réactif en rupture' : 'Ex. : paramétrage validé par le biologiste responsable'}
        onClose={() => setStatusOpen(false)}
        onConfirm={async (reason) => {
          const saved = await updateExam.mutateAsync({ id: exam.id, body: { isActive: !exam.isActive, reason } });
          setNotice(saved.isActive ? 'Examen activé : il est désormais commandable.' : 'Examen désactivé.');
        }}
      />

      <ParameterFormModal
        open={paramForm !== undefined}
        examId={exam.id}
        parameter={paramForm ?? null}
        onClose={() => setParamForm(undefined)}
        onSaved={(msg) => setNotice(msg)}
      />

      <ReasonModal
        open={!!paramStatus}
        title={`${paramStatus?.isActive ? 'Désactiver' : 'Réactiver'} le paramètre ${paramStatus?.code ?? ''}`}
        confirmLabel={paramStatus?.isActive ? 'Désactiver' : 'Réactiver'}
        danger={paramStatus?.isActive}
        onClose={() => setParamStatus(null)}
        onConfirm={async (reason) => {
          await updateParam.mutateAsync({ id: paramStatus!.id, body: { isActive: !paramStatus!.isActive, reason } });
          setNotice(`Paramètre ${paramStatus!.code} ${paramStatus!.isActive ? 'désactivé' : 'réactivé'}.`);
        }}
      />

      <RangeFormModal
        target={rangeForm}
        onClose={() => setRangeForm(null)}
        onSaved={(msg) => setNotice(msg)}
      />

      <ReasonModal
        open={!!rangeDelete}
        title="Supprimer la valeur de référence"
        description="L’état antérieur est conservé dans la piste d’audit."
        confirmLabel="Supprimer"
        danger
        placeholder="Ex. : saisie erronée"
        onClose={() => setRangeDelete(null)}
        onConfirm={async (reason) => {
          await deleteRange.mutateAsync({ id: rangeDelete!.id, reason });
          setNotice('Valeur de référence supprimée.');
        }}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </Card>
  );
}

const EDIT_FIELDS = ['name', 'shortName', 'sectionId', 'sampleTypeId', 'price', 'turnaroundHours', 'patientInstructions', 'displayOrder'] as const;

function EditExamModal({
  open,
  exam,
  canEditPrice,
  onClose,
  onSaved,
}: {
  open: boolean;
  exam: ExamDetailDto;
  canEditPrice: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const update = useUpdateExam();
  const sections = useQuery(sectionsQuery);
  const samples = useQuery(sampleTypesQuery);
  const settings = useQuery(settingsQuery);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isDirty } } = useForm<UpdateExamInput>({
    resolver: zodResolver(updateExamSchema),
  });

  useEffect(() => {
    if (open) {
      setFormError(null);
      reset({
        name: exam.name,
        shortName: exam.shortName ?? '',
        sectionId: exam.section.id,
        sampleTypeId: exam.sampleType.id,
        price: exam.price,
        turnaroundHours: exam.turnaroundHours,
        patientInstructions: exam.patientInstructions ?? '',
        displayOrder: exam.displayOrder,
      });
    }
  }, [open, exam, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await update.mutateAsync({ id: exam.id, body: values });
      onSaved();
      onClose();
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, EDIT_FIELDS)) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Modifier ${exam.code}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="exam-edit-form" loading={update.isPending} disabled={!isDirty}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="exam-edit-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-3">
        {formError && (
          <Alert tone="error" className="sm:col-span-3">
            {formError}
          </Alert>
        )}
        <TextField label="Libellé" required containerClassName="sm:col-span-2" error={errors.name?.message} {...register('name')} />
        <TextField label="Libellé court" error={errors.shortName?.message} {...register('shortName')} />
        <SelectField label="Section" error={errors.sectionId?.message} {...register('sectionId')}>
          {sections.data?.map((s) => (
            <option key={s.id} value={s.id} disabled={!s.isActive}>
              {s.name}
              {!s.isActive && ' (inactive)'}
            </option>
          ))}
        </SelectField>
        <SelectField label="Type d’échantillon" error={errors.sampleTypeId?.message} {...register('sampleTypeId')}>
          {samples.data?.map((s) => (
            <option key={s.id} value={s.id} disabled={!s.isActive}>
              {s.name}
              {!s.isActive && ' (inactif)'}
            </option>
          ))}
        </SelectField>
        <TextField
          label={`Tarif (${settings.data?.currency ?? 'CDF'})`}
          inputMode="decimal"
          readOnly={!canEditPrice}
          className={canEditPrice ? undefined : 'bg-slate-100 text-slate-500'}
          hint={canEditPrice ? undefined : 'Modifiable par un administrateur uniquement.'}
          error={errors.price?.message}
          {...register('price')}
        />
        <TextField label="Délai de rendu (heures)" type="number" min={1} error={errors.turnaroundHours?.message} {...register('turnaroundHours')} />
        <TextField label="Ordre d’affichage" type="number" min={0} error={errors.displayOrder?.message} {...register('displayOrder')} />
        <TextAreaField
          label="Préparation du patient"
          containerClassName="sm:col-span-3"
          error={errors.patientInstructions?.message}
          {...register('patientInstructions')}
        />
      </form>
    </Modal>
  );
}
