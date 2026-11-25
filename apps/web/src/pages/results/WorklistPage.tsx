import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, FlaskConical, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ANALYSIS_STATUS_LABELS } from '@lims/shared';
import { AnalysisStatusBadge, PriorityBadge } from '@/components/labels';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/auth/useAuth';
import { sectionsQuery } from '@/features/catalog';
import { useWorklist, type WorklistFilter, type WorklistStatus } from '@/features/results';
import { cn, errorMessage, formatDateTime } from '@/lib/utils';

const TABS: { id: WorklistStatus; label: string; hint: string }[] = [
  { id: 'TO_ENTER', label: 'À saisir', hint: 'Échantillons reçus, résultats à saisir' },
  { id: 'ENTERED', label: 'Validation technique', hint: 'Résultats saisis à contrôler' },
  { id: 'TECHNICAL_VALIDATED', label: 'Validation biologique', hint: 'En attente du biologiste' },
  { id: 'VALIDATED', label: 'Validés (72 h)', hint: 'Validés au cours des trois derniers jours' },
];

/** Paillasses : liste de travail par section, triée par urgence puis ancienneté de réception. */
export function WorklistPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (TABS.find((t) => t.id === params.get('etape'))?.id ?? 'TO_ENTER') as WorklistStatus;
  const sectionId = params.get('section') ?? '';
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState<WorklistFilter>({ page: 1, pageSize: 25, status, sectionId: sectionId || undefined, q: '' });
  const sections = useQuery(sectionsQuery);
  const { allowedSectionIds } = useAuth();

  useEffect(() => {
    setFilter((f) => ({ ...f, status, sectionId: sectionId || undefined, page: 1 }));
  }, [status, sectionId]);
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === searchInput ? f : { ...f, q: searchInput, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error, isFetching } = useWorklist(filter);
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Paillasses" description="Saisie des résultats, validation technique puis biologique. Les urgences et les échantillons les plus anciens apparaissent en premier." />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={status === t.id}
            title={t.hint}
            onClick={() => update({ etape: t.id === 'TO_ENTER' ? '' : t.id })}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              status === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <SelectField label="Paillasse (section)" value={sectionId} onChange={(e) => update({ section: e.target.value })} containerClassName="w-60">
            <option value="">{allowedSectionIds ? 'Toutes mes sections' : 'Toutes les sections'}</option>
            {(sections.data ?? [])
              .filter((s) => s.isActive && (allowedSectionIds === null || allowedSectionIds.includes(s.id)))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </SelectField>
          <div className="relative min-w-72 flex-1">
            <TextField
              label="Rechercher"
              placeholder="N° d’échantillon (douchette), de demande, nom ou code patient"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
              autoFocus
            />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
          </div>
        </div>

        {isLoading ? (
          <LoadingBlock />
        ) : isError ? (
          <div className="p-4">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={FlaskConical} title={`Aucun examen « ${ANALYSIS_STATUS_LABELS[status]} »`}>
            {filter.q || filter.sectionId ? 'Modifiez les filtres.' : 'La paillasse est à jour.'}
          </EmptyState>
        ) : (
          <>
            <div className={cn('overflow-x-auto', isFetching && 'opacity-60')}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Échantillon</th>
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3">Examen</th>
                    <th className="px-4 py-3">Reçu</th>
                    <th className="px-4 py-3">Échéance</th>
                    <th className="px-4 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((i) => (
                    <tr
                      key={i.orderItemId}
                      className={cn('cursor-pointer hover:bg-slate-50', i.priority === 'URGENT' && 'bg-red-50/40')}
                      onClick={() => navigate(`/resultats/${i.orderId}?examen=${i.orderItemId}`)}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-brand-800">{i.sampleNumber}</span>
                        <span className="block text-xs text-slate-500">{i.orderNumber}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{i.patient.fullName}</p>
                        <p className="text-xs text-slate-500">{i.patient.code}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold">{i.examCode}</span>
                          <span>{i.examName}</span>
                          <PriorityBadge priority={i.priority} />
                        </p>
                        <p className="text-xs text-slate-500">{i.sectionName}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatDateTime(i.receivedAt)}</td>
                      <td className={cn('whitespace-nowrap px-4 py-3 text-xs', i.overdue ? 'font-semibold text-red-700' : 'text-slate-600')}>
                        {i.overdue && <Clock className="mr-1 inline size-3.5" aria-label="En retard" />}
                        {formatDateTime(i.dueAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <AnalysisStatusBadge status={i.status} />
                          {i.hasCritical && (
                            <Badge tone="danger">
                              <AlertTriangle className="mr-0.5 inline size-3" aria-hidden />
                              Critique à communiquer
                            </Badge>
                          )}
                          {i.hasReservation && (
                            <Badge tone="warning">
                              <ShieldAlert className="mr-0.5 inline size-3" aria-hidden />
                              Sous réserve
                            </Badge>
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
    </div>
  );
}
