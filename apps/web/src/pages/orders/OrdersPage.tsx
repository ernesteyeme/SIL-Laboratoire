import { ClipboardList, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  computeAge,
  ORDER_PRIORITY_LABELS,
  ORDER_PRIORITIES,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  SEX_LABELS,
  type OrderPriority,
  type OrderStatus,
} from '@lims/shared';
import { REGISTRATION_WRITE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { InvoiceStatusBadge, OrderStatusBadge, PriorityBadge } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useOrders, type OrdersFilter } from '@/features/orders';
import { errorMessage, formatDateTime } from '@/lib/utils';

export function OrdersPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasRole(...REGISTRATION_WRITE_ROLES);
  const [filter, setFilter] = useState<OrdersFilter>({ page: 1, pageSize: 25, q: '', status: '', priority: '', from: '', to: '' });
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === searchInput ? f : { ...f, q: searchInput, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error, isFetching } = useOrders(filter);
  const update = (patch: Partial<OrdersFilter>) => setFilter((f) => ({ ...f, ...patch, page: 1 }));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Demandes d’examens"
        description="Recherche par n° de demande, n° d’échantillon (douchette), code ou nom du patient."
        actions={
          canCreate && (
            <Button icon={Plus} onClick={() => navigate('/demandes/nouvelle')}>
              Nouvelle demande
            </Button>
          )
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_190px_150px_150px_150px]">
          <div className="relative">
            <TextField label="Rechercher" placeholder="DEM-…, 2611220001, PAT-…, nom" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-9" />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
          </div>
          <SelectField label="Statut" value={filter.status} onChange={(e) => update({ status: e.target.value as OrderStatus | '' })}>
            <option value="">Tous</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Priorité" value={filter.priority} onChange={(e) => update({ priority: e.target.value as OrderPriority | '' })}>
            <option value="">Toutes</option>
            {ORDER_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {ORDER_PRIORITY_LABELS[p]}
              </option>
            ))}
          </SelectField>
          <TextField label="Du" type="date" value={filter.from} onChange={(e) => update({ from: e.target.value })} />
          <TextField label="Au" type="date" value={filter.to} onChange={(e) => update({ to: e.target.value })} />
        </div>

        {isLoading ? (
          <LoadingBlock />
        ) : isError ? (
          <div className="p-4">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Aucune demande" />
        ) : (
          <>
            <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Demande</th>
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3">Examens</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Facture</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((o) => (
                    <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/demandes/${o.id}`)}>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link to={`/demandes/${o.id}`} className="font-mono text-xs font-semibold text-brand-800 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {o.number}
                        </Link>
                        <p className="text-xs text-slate-500">{formatDateTime(o.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{o.patient.fullName}</p>
                        <p className="text-xs text-slate-500">
                          {o.patient.code} · {SEX_LABELS[o.patient.sex]}
                          {o.patient.birthDate && ` · ${computeAge(o.patient.birthDate).label}`}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{o.examCodes.join(', ')}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <PriorityBadge priority={o.priority} />
                          <OrderStatusBadge status={o.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3">{o.invoiceStatus && <InvoiceStatusBadge status={o.invoiceStatus} />}</td>
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
