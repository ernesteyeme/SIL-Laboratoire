import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, RotateCcw, Search, Stethoscope, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { createPrescriberSchema, type CreatePrescriberInput, type PrescriberDto } from '@lims/shared';
import { REGISTRATION_WRITE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ReasonModal } from '@/components/ui/ReasonModal';
import { useCreatePrescriber, usePrescribers, useUpdatePrescriber, type PrescribersFilter } from '@/features/prescribers';
import { applyApiFieldErrors, errorMessage } from '@/lib/utils';

export function PrescribersPage() {
  const { hasRole } = useAuth();
  const canWrite = hasRole(...REGISTRATION_WRITE_ROLES);
  const [filter, setFilter] = useState<PrescribersFilter>({ page: 1, pageSize: 20, q: '', status: 'active' });
  const [searchInput, setSearchInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<PrescriberDto | null | undefined>(undefined);
  const [statusTarget, setStatusTarget] = useState<PrescriberDto | null>(null);
  const update = useUpdatePrescriber();

  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === searchInput ? f : { ...f, q: searchInput, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error, isFetching } = usePrescribers(filter);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Prescripteurs"
        description="Médecins et structures demandeurs d’examens."
        actions={
          canWrite && (
            <Button icon={Plus} onClick={() => setFormTarget(null)}>
              Nouveau prescripteur
            </Button>
          )
        }
      />
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_180px]">
          <div className="relative">
            <TextField
              label="Rechercher"
              placeholder="Nom, structure ou n° d’Ordre"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
          </div>
          <SelectField
            label="Statut"
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as PrescribersFilter['status'], page: 1 }))}
          >
            <option value="active">Actifs</option>
            <option value="inactive">Désactivés</option>
            <option value="all">Tous</option>
          </SelectField>
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : isError ? (
          <div className="p-4">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={Stethoscope} title="Aucun prescripteur trouvé" />
        ) : (
          <>
            <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Prescripteur</th>
                    <th className="px-4 py-3">Structure</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">N° d’Ordre</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((p) => (
                    <tr key={p.id} className={p.isActive ? '' : 'bg-slate-50/60 text-slate-500'}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{p.displayName}</p>
                        <p className="text-xs text-slate-500">
                          {p.specialty ?? '—'} {!p.isActive && <Badge tone="danger">Désactivé</Badge>}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.facility ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.phone ?? '—'}
                        {p.email && <span className="block text-xs text-slate-500">{p.email}</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.licenseNumber ?? '—'}</td>
                      <td className="px-4 py-3">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            {p.isActive && <IconAction label="Modifier" icon={Pencil} onClick={() => setFormTarget(p)} />}
                            <IconAction
                              label={p.isActive ? 'Désactiver' : 'Réactiver'}
                              icon={p.isActive ? UserX : RotateCcw}
                              danger={p.isActive}
                              onClick={() => setStatusTarget(p)}
                            />
                          </div>
                        )}
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

      <PrescriberFormModal
        open={formTarget !== undefined}
        prescriber={formTarget ?? null}
        onClose={() => setFormTarget(undefined)}
        onSaved={(p, created) => setNotice(`${p.displayName} ${created ? 'ajouté' : 'mis à jour'}.`)}
      />

      <ReasonModal
        open={!!statusTarget}
        title={`${statusTarget?.isActive ? 'Désactiver' : 'Réactiver'} ${statusTarget?.displayName ?? ''}`}
        confirmLabel={statusTarget?.isActive ? 'Désactiver' : 'Réactiver'}
        danger={statusTarget?.isActive}
        placeholder={statusTarget?.isActive ? 'Ex. : a quitté la structure' : 'Ex. : retour dans la structure'}
        onClose={() => setStatusTarget(null)}
        onConfirm={async (reason) => {
          if (!statusTarget) return;
          const saved = await update.mutateAsync({ id: statusTarget.id, body: { isActive: !statusTarget.isActive, reason } });
          setNotice(`${saved.displayName} ${saved.isActive ? 'réactivé' : 'désactivé'}.`);
        }}
      />
    </div>
  );
}

const FIELDS = ['title', 'lastName', 'firstName', 'specialty', 'facility', 'phone', 'email', 'licenseNumber'] as const;

function PrescriberFormModal({
  open,
  prescriber,
  onClose,
  onSaved,
}: {
  open: boolean;
  prescriber: PrescriberDto | null;
  onClose: () => void;
  onSaved: (p: PrescriberDto, created: boolean) => void;
}) {
  const create = useCreatePrescriber();
  const update = useUpdatePrescriber();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<CreatePrescriberInput>({
    resolver: zodResolver(createPrescriberSchema),
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset({
      title: prescriber?.title ?? 'Dr',
      lastName: prescriber?.lastName ?? '',
      firstName: prescriber?.firstName ?? '',
      specialty: prescriber?.specialty ?? '',
      facility: prescriber?.facility ?? '',
      phone: prescriber?.phone ?? '',
      email: prescriber?.email ?? '',
      licenseNumber: prescriber?.licenseNumber ?? '',
    });
  }, [open, prescriber, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = prescriber
        ? await update.mutateAsync({ id: prescriber.id, body: values })
        : await create.mutateAsync(values);
      onSaved(saved, !prescriber);
      onClose();
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, FIELDS)) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={prescriber ? `Modifier ${prescriber.displayName}` : 'Nouveau prescripteur'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="prescriber-form" loading={create.isPending || update.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="prescriber-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-3">
        {formError && (
          <Alert tone="error" className="sm:col-span-3">
            {formError}
          </Alert>
        )}
        <TextField label="Titre" placeholder="Dr, Pr, Inf." error={errors.title?.message} {...register('title')} />
        <TextField label="Nom" required error={errors.lastName?.message} {...register('lastName')} />
        <TextField label="Prénom" error={errors.firstName?.message} {...register('firstName')} />
        <TextField label="Spécialité" error={errors.specialty?.message} {...register('specialty')} />
        <TextField label="Structure" containerClassName="sm:col-span-2" error={errors.facility?.message} {...register('facility')} />
        <TextField label="Téléphone" type="tel" error={errors.phone?.message} {...register('phone')} />
        <TextField label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
        <TextField label="N° d’Ordre" error={errors.licenseNumber?.message} {...register('licenseNumber')} />
      </form>
    </Modal>
  );
}
