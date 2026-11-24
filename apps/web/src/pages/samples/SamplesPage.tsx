import { useQueryClient } from '@tanstack/react-query';
import { ScanBarcode, TestTubes } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { computeAge, SEX_LABELS, type SampleContextDto, type SampleStatus } from '@lims/shared';
import { SAMPLE_RECEIVE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { PriorityBadge } from '@/components/labels';
import { SampleCard } from '@/components/samples/SampleCard';
import { TextField } from '@/components/ui/Field';
import { Alert, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { fetchSampleByNumber, useSamples } from '@/features/orders';
import { cn, errorMessage, formatDateTime } from '@/lib/utils';

const TABS: { status: SampleStatus; label: string; hint: string }[] = [
  { status: 'PENDING_COLLECTION', label: 'À prélever', hint: 'Demandes enregistrées en attente de prélèvement.' },
  { status: 'COLLECTED', label: 'À réceptionner', hint: 'Échantillons prélevés, en attente de contrôle à l’arrivée au laboratoire.' },
  { status: 'REJECTED', label: 'Refusés à reprélever', hint: 'Échantillons non conformes sans nouveau prélèvement.' },
];

export function SamplesPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<SampleStatus>(hasRole(...SAMPLE_RECEIVE_ROLES) ? 'COLLECTED' : 'PENDING_COLLECTION');
  const [page, setPage] = useState(1);
  const [scan, setScan] = useState('');
  const [current, setCurrent] = useState<SampleContextDto | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const list = useSamples({ page, pageSize: 20, status: tab });

  useEffect(() => scanRef.current?.focus(), []);

  const load = async (number: string) => {
    setScanError(null);
    setNotice(null);
    try {
      setCurrent(await fetchSampleByNumber(number));
    } catch (error) {
      setCurrent(null);
      setScanError(errorMessage(error));
    }
  };

  // Après une action sur l'échantillon affiché : le recharger et revenir au champ de scan.
  const afterAction = async (message: string, newSampleNumber?: string) => {
    setNotice(message);
    if (current) {
      try {
        const fresh = await fetchSampleByNumber(newSampleNumber ?? current.number);
        setCurrent(fresh);
      } catch {
        setCurrent(null);
      }
    }
    void qc.invalidateQueries({ queryKey: ['samples'] });
    scanRef.current?.focus();
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Échantillons" description="Scannez le code-barres de l’étiquette (douchette) ou choisissez un échantillon dans les listes." />

      <Card className="mb-6 p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (scan.trim()) void load(scan);
            setScan('');
          }}
          className="flex items-end gap-3"
        >
          <div className="relative flex-1">
            <TextField
              ref={scanRef}
              label="N° d’échantillon"
              placeholder="Scannez ou saisissez puis Entrée"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              className="pl-10 font-mono text-lg"
              autoComplete="off"
              inputMode="numeric"
            />
            <ScanBarcode className="pointer-events-none absolute bottom-2.5 left-3 size-5 text-slate-400" aria-hidden />
          </div>
        </form>
        {scanError && (
          <Alert tone="error" className="mt-3">
            {scanError}
          </Alert>
        )}
        {notice && (
          <Alert tone="success" className="mt-3">
            {notice}
          </Alert>
        )}
        {current && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-base font-semibold text-slate-900">{current.patient.fullName}</span>
              <span className="text-slate-500">
                {current.patient.code} · {SEX_LABELS[current.patient.sex]}
                {current.patient.birthDate && ` · ${computeAge(current.patient.birthDate).label}`}
              </span>
              <Link to={`/demandes/${current.order.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                {current.order.number}
              </Link>
              <PriorityBadge priority={current.order.priority} />
            </div>
            {current.order.clinicalInfo && <p className="text-xs text-slate-500">Renseignements : {current.order.clinicalInfo}</p>}
            <SampleCard sample={current} orderId={current.order.id} orderCancelled={current.order.status === 'CANCELLED'} onDone={afterAction} highlighted />
          </div>
        )}
      </Card>

      <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            aria-selected={tab === t.status}
            onClick={() => {
              setTab(t.status);
              setPage(1);
            }}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === t.status ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
            {tab === t.status && list.data && <span className="ml-2 rounded-full bg-slate-100 px-2 text-xs">{list.data.total}</span>}
          </button>
        ))}
      </div>
      <p className="mb-3 text-sm text-slate-500">{TABS.find((t) => t.status === tab)?.hint}</p>

      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.isError ? (
          <div className="p-4">
            <Alert tone="error">{errorMessage(list.error)}</Alert>
          </div>
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState icon={TestTubes} title="Aucun échantillon dans cette liste" />
        ) : (
          <>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Échantillon</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Type · examens</th>
                  <th className="px-4 py-3">{tab === 'PENDING_COLLECTION' ? 'Demande du' : tab === 'COLLECTED' ? 'Prélevé le' : 'Non-conformité'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.items.map((s) => (
                  <tr key={s.id} className={cn('cursor-pointer hover:bg-slate-50', current?.id === s.id && 'bg-brand-50')} onClick={() => setCurrent(s)}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="font-mono font-semibold text-slate-800">{s.number}</span>
                      <div className="mt-0.5">
                        <PriorityBadge priority={s.order.priority} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{s.patient.fullName}</p>
                      <p className="text-xs text-slate-500">
                        {s.patient.code} · {s.order.number}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {s.sampleType.name}
                      <span className="block font-mono text-xs text-slate-500">{s.examCodes.join(', ')}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {tab === 'PENDING_COLLECTION' && formatDateTime(s.order.createdAt)}
                      {tab === 'COLLECTED' && formatDateTime(s.collectedAt)}
                      {tab === 'REJECTED' && (s.nonConformities.at(-1)?.comment ?? formatDateTime(s.nonConformities.at(-1)?.recordedAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
