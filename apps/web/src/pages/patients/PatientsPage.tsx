import { Pencil, Plus, RotateCcw, Search, UserRound, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { computeAge, SEX_LABELS, SEXES, type PatientDto, type Sex } from '@lims/shared';
import { REGISTRATION_WRITE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ReasonModal } from '@/components/ui/ReasonModal';
import { usePatients, usePatientStatus, type PatientsFilter } from '@/features/patients';
import { errorMessage, formatDate } from '@/lib/utils';
import { PatientFormModal } from './PatientFormModal';

export function PatientsPage() {
  const { hasRole } = useAuth();
  const canWrite = hasRole(...REGISTRATION_WRITE_ROLES);
  const isAdmin = hasRole('ADMIN');

  const [filter, setFilter] = useState<PatientsFilter>({ page: 1, pageSize: 20, q: '', sex: '', status: 'active' });
  const [searchInput, setSearchInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [formPatient, setFormPatient] = useState<PatientDto | null | undefined>(undefined);
  const [statusTarget, setStatusTarget] = useState<PatientDto | null>(null);
  const status = usePatientStatus();

  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === searchInput ? f : { ...f, q: searchInput, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error, isFetching } = usePatients(filter);

  const showPatient = (p: PatientDto) => {
    setSearchInput(p.code);
    setFilter((f) => ({ ...f, q: p.code, status: 'all', page: 1 }));
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Patients"
        description="Identification des patients. Recherche par nom (ordre libre, sans accents), code, téléphone ou identifiant externe."
        actions={
          canWrite && (
            <Button icon={Plus} onClick={() => setFormPatient(null)}>
              Nouveau patient
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
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <TextField
              label="Rechercher"
              placeholder="Nom, PAT-000123, 0812345678…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
          </div>
          <SelectField label="Sexe" value={filter.sex} onChange={(e) => setFilter((f) => ({ ...f, sex: e.target.value as Sex | '', page: 1 }))}>
            <option value="">Tous</option>
            {SEXES.map((s) => (
              <option key={s} value={s}>
                {SEX_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Statut"
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as PatientsFilter['status'], page: 1 }))}
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
          <EmptyState icon={UserRound} title="Aucun patient trouvé">
            {canWrite ? 'Vérifiez l’orthographe ou créez un nouveau dossier.' : 'Modifiez les critères de recherche.'}
          </EmptyState>
        ) : (
          <>
            <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3">Sexe · Âge</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Enregistré le</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((p) => (
                    <tr key={p.id} className={p.isActive ? '' : 'bg-slate-50/60 text-slate-500'}>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{p.code}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{p.fullName}</p>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                          {p.externalId && <span>Réf. {p.externalId}</span>}
                          {!p.isActive && <Badge tone="danger">Désactivé</Badge>}
                          {!p.isActive && p.deactivationReason && <span title={p.deactivationReason}>· {p.deactivationReason}</span>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {SEX_LABELS[p.sex]}
                        {p.birthDate && (
                          <span className="text-slate-500">
                            {' '}
                            · {computeAge(p.birthDate).label}
                            {p.birthDateEstimated && <span title="Date de naissance estimée"> (est.)</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.phone ?? '—'}
                        {p.city && <span className="block text-xs text-slate-500">{p.city}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(p.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {canWrite && p.isActive && <IconAction label="Modifier" icon={Pencil} onClick={() => setFormPatient(p)} />}
                          {isAdmin && p.isActive && (
                            <IconAction label="Désactiver le dossier" icon={UserX} danger onClick={() => setStatusTarget(p)} />
                          )}
                          {isAdmin && !p.isActive && (
                            <IconAction label="Réactiver le dossier" icon={RotateCcw} onClick={() => setStatusTarget(p)} />
                          )}
                        </div>
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

      <PatientFormModal
        open={formPatient !== undefined}
        patient={formPatient ?? null}
        onClose={() => setFormPatient(undefined)}
        onSaved={(p, created) => {
          setNotice(created ? `Dossier ${p.code} créé pour ${p.fullName}.` : `Dossier ${p.code} mis à jour.`);
          if (created) showPatient(p);
        }}
        onOpenExisting={showPatient}
      />

      <ReasonModal
        open={!!statusTarget}
        title={statusTarget?.isActive ? `Désactiver le dossier ${statusTarget.code}` : `Réactiver le dossier ${statusTarget?.code ?? ''}`}
        description={
          statusTarget?.isActive
            ? 'Le dossier n’apparaîtra plus dans les recherches courantes. Son historique est conservé.'
            : 'Le dossier redeviendra utilisable pour de nouvelles demandes.'
        }
        confirmLabel={statusTarget?.isActive ? 'Désactiver' : 'Réactiver'}
        danger={statusTarget?.isActive}
        placeholder={statusTarget?.isActive ? 'Ex. : doublon du dossier PAT-000123' : 'Ex. : désactivation par erreur'}
        onClose={() => setStatusTarget(null)}
        onConfirm={async (reason) => {
          if (!statusTarget) return;
          const saved = await status.mutateAsync({ id: statusTarget.id, active: !statusTarget.isActive, body: { reason } });
          setNotice(`Dossier ${saved.code} ${saved.isActive ? 'réactivé' : 'désactivé'}.`);
        }}
      />
    </div>
  );
}
