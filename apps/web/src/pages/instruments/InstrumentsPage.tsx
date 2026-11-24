import { useQuery } from '@tanstack/react-query';
import { Ban, Cable, Check, Clock, ExternalLink, FileText, Inbox, Plus, RotateCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  INSTRUMENT_MESSAGE_SOURCE_LABELS,
  INSTRUMENT_PROTOCOL_LABELS,
  INSTRUMENT_RESULT_STATUS_LABELS,
  INSTRUMENT_RESULT_STATUSES,
  type InstrumentResultDto,
} from '@lims/shared';
import { INSTRUMENT_CONFIG_ROLES, INSTRUMENT_OPERATE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { InstrumentMessageStatusBadge, InstrumentResultStatusBadge } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ReasonModal } from '@/components/ui/ReasonModal';
import {
  instrumentMessageQuery,
  instrumentsQuery,
  useAcceptResult,
  useDismissResult,
  useInstrumentMessages,
  useInstrumentResults,
  useRetryResult,
  type InstrumentMessagesFilter,
  type InstrumentResultsFilter,
} from '@/features/instruments';
import { cn, errorMessage, formatDateTime } from '@/lib/utils';
import { InstrumentFormModal } from './InstrumentFormModal';

type Tab = 'queue' | 'instruments' | 'messages';

export function InstrumentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('onglet') as Tab | null) ?? 'queue';
  const messageId = params.get('message');
  const { data: instruments } = useQuery(instrumentsQuery);
  const pending = (instruments ?? []).reduce((n, i) => n + i.pendingCount, 0);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Automates"
        description="Résultats transmis par les analyseurs. Une valeur d’automate n’écrase jamais une saisie et n’est jamais validée automatiquement : la validation technique et biologique restent humaines."
      />
      <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            ['queue', `À traiter${pending ? ` (${pending})` : ''}`],
            ['instruments', 'Automates'],
            ['messages', 'Journal des messages'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => set({ onglet: id === 'queue' ? null : id })}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'queue' && <QueueTab onOpenMessage={(id) => set({ message: id })} />}
      {tab === 'instruments' && <InstrumentsTab />}
      {tab === 'messages' && <MessagesTab onOpenMessage={(id) => set({ message: id })} />}
      <MessageModal id={messageId} onClose={() => set({ message: null })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// File à traiter
// ---------------------------------------------------------------------------

function QueueTab({ onOpenMessage }: { onOpenMessage: (id: string) => void }) {
  const { hasRole } = useAuth();
  const canOperate = hasRole(...INSTRUMENT_OPERATE_ROLES);
  const { data: instruments } = useQuery(instrumentsQuery);
  const [filter, setFilter] = useState<InstrumentResultsFilter>({ page: 1, pageSize: 25, status: 'TO_REVIEW', q: '' });
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === search ? f : { ...f, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data, isLoading, isError, error, isFetching } = useInstrumentResults(filter);
  const retry = useRetryResult();
  const accept = useAcceptResult();
  const dismiss = useDismissResult();
  const [dismissTarget, setDismissTarget] = useState<InstrumentResultDto | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const run = async (fn: () => Promise<InstrumentResultDto>, done: string) => {
    setNotice(null);
    try {
      const r = await fn();
      const resolved = !['CONFLICT', 'UNMATCHED', 'LOCKED'].includes(r.status);
      setNotice(resolved ? { tone: 'success', text: `${done} : ${INSTRUMENT_RESULT_STATUS_LABELS[r.status].toLowerCase()}.` } : { tone: 'warning', text: `Toujours en attente : ${r.reason ?? INSTRUMENT_RESULT_STATUS_LABELS[r.status]}` });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <>
      {notice && (
        <Alert tone={notice.tone} className="mb-4">
          {notice.text}
        </Alert>
      )}
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-64 flex-1">
            <TextField label="Rechercher" placeholder="N° d’échantillon ou code test" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
          </div>
          <SelectField label="Automate" value={filter.instrumentId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, instrumentId: e.target.value || undefined, page: 1 }))} containerClassName="w-60">
            <option value="">Tous</option>
            {(instruments ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} — {i.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Statut" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as InstrumentResultsFilter['status'], page: 1 }))} containerClassName="w-56">
            <option value="TO_REVIEW">À traiter</option>
            {INSTRUMENT_RESULT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INSTRUMENT_RESULT_STATUS_LABELS[s]}
              </option>
            ))}
          </SelectField>
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : isError ? (
          <div className="p-4">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={Inbox} title={filter.status === 'TO_REVIEW' ? 'Rien à traiter' : 'Aucun résultat'}>
            {filter.status === 'TO_REVIEW' ? 'Tous les résultats reçus ont été intégrés ou traités.' : undefined}
          </EmptyState>
        ) : (
          <>
            <div className={cn('overflow-x-auto', isFetching && 'opacity-60')}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Reçu</th>
                    <th className="px-4 py-3">Échantillon</th>
                    <th className="px-4 py-3">Test → paramètre</th>
                    <th className="px-4 py-3">Valeur reçue</th>
                    <th className="px-4 py-3">Statut et motif</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        {formatDateTime(r.createdAt)}
                        <span className="block text-slate-500">{r.instrument.code}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold">{r.specimenId}</span>
                        {r.kind === 'QC' && <Badge tone="brand">CIQ</Badge>}
                        {r.order && (
                          <Link to={`/resultats/${r.order.id}`} className="block text-xs text-brand-700 hover:underline">
                            {r.order.number}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs">{r.testCode}</span>
                        {r.parameter && <span className="block text-xs text-slate-500">{r.parameter.name}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">
                        {r.rawValue || '—'} <span className="font-normal text-slate-500">{r.unit ?? ''}</span>
                        {r.flags && r.flags !== 'N' && <span className="ml-1 rounded bg-slate-100 px-1 text-xs font-normal">{r.flags}</span>}
                      </td>
                      <td className="max-w-sm px-4 py-3">
                        <InstrumentResultStatusBadge status={r.status} />
                        {r.reason && <p className="mt-1 text-xs text-slate-600">{r.reason}</p>}
                        {r.resolvedBy && (
                          <p className="text-xs text-slate-400">
                            {r.resolvedBy}, {formatDateTime(r.resolvedAt)}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span className="inline-flex gap-1">
                          <IconAction label="Voir le message" icon={FileText} onClick={() => onOpenMessage(r.messageId)} />
                          {canOperate && ['CONFLICT', 'UNMATCHED', 'LOCKED'].includes(r.status) && (
                            <>
                              {r.status === 'CONFLICT' && (
                                <Button size="sm" variant="secondary" icon={Check} onClick={() => void run(() => accept.mutateAsync(r.id), 'Valeur de l’automate retenue')}>
                                  Retenir
                                </Button>
                              )}
                              <IconAction label="Relancer l’appariement" icon={RotateCw} onClick={() => void run(() => retry.mutateAsync(r.id), 'Relance')} />
                              <IconAction label="Écarter" icon={Ban} danger onClick={() => setDismissTarget(r)} />
                            </>
                          )}
                        </span>
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
      <div className="mt-3 space-y-1 text-xs text-slate-500">
        <p>
          <strong>Conflit</strong> : une autre valeur est déjà enregistrée. « Retenir » remplace la saisie par la valeur de l’automate (décision tracée), sinon écartez le résultat.
        </p>
        <p>
          <strong>Non apparié</strong> : code test sans correspondance, échantillon inconnu ou pas encore réceptionné… Corrigez la cause puis relancez.
        </p>
        <p>
          <strong>Examen déjà validé</strong> : le biologiste doit d’abord ouvrir une correction, puis relancez.
        </p>
      </div>
      <ReasonModal
        open={!!dismissTarget}
        title="Écarter le résultat reçu"
        description={dismissTarget ? `${dismissTarget.specimenId} · ${dismissTarget.testCode} = ${dismissTarget.rawValue}. Le résultat reste dans le journal, marqué écarté avec le motif.` : ''}
        confirmLabel="Écarter"
        danger
        onClose={() => setDismissTarget(null)}
        onConfirm={async (reason) => {
          await dismiss.mutateAsync({ id: dismissTarget!.id, reason });
          setNotice({ tone: 'success', text: 'Résultat écarté.' });
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Automates
// ---------------------------------------------------------------------------

function InstrumentsTab() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery(instrumentsQuery);
  const [creating, setCreating] = useState(false);
  if (isLoading) return <LoadingBlock />;
  if (isError) return <Alert tone="error">{errorMessage(error)}</Alert>;
  return (
    <>
      {hasRole(...INSTRUMENT_CONFIG_ROLES) && (
        <div className="mb-4 flex justify-end">
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Déclarer un automate
          </Button>
        </div>
      )}
      {!data || data.length === 0 ? (
        <Card>
          <EmptyState icon={Cable} title="Aucun automate déclaré" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((i) => (
            <Card key={i.id} className={cn('cursor-pointer p-4 hover:border-brand-600/50', !i.isActive && 'opacity-60')}>
              <button className="w-full text-left" onClick={() => navigate(`/automates/${i.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{i.name}</p>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono">{i.code}</span> · {INSTRUMENT_PROTOCOL_LABELS[i.protocol]}
                      {i.section && ` · ${i.section.name}`}
                    </p>
                  </div>
                  {!i.isActive ? <Badge>Inactif</Badge> : i.pendingCount > 0 ? <Badge tone="warning">{i.pendingCount} à traiter</Badge> : <Badge tone="success">À jour</Badge>}
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <p className="flex items-center gap-1.5">
                    <Clock className="size-3.5 text-slate-400" aria-hidden /> Dernier message : {i.lastMessageAt ? formatDateTime(i.lastMessageAt) : 'jamais'}
                  </p>
                  <p>
                    {i.mappings.filter((m) => m.isActive).length} correspondance(s) de tests · {i.qcMaterials.length} contrôle(s) ·{' '}
                    {i.apiKeyPrefix ? <span className="font-mono">{i.apiKeyPrefix}</span> : <span className="text-amber-700">pas de clé de connecteur</span>}
                  </p>
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}
      <InstrumentFormModal open={creating} instrument={null} onClose={() => setCreating(false)} onSaved={(i) => navigate(`/automates/${i.id}`)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Journal des messages
// ---------------------------------------------------------------------------

function MessagesTab({ onOpenMessage }: { onOpenMessage: (id: string) => void }) {
  const { data: instruments } = useQuery(instrumentsQuery);
  const [filter, setFilter] = useState<InstrumentMessagesFilter>({ page: 1, pageSize: 25 });
  const { data, isLoading, isError, error, isFetching } = useInstrumentMessages(filter);
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
        <SelectField label="Automate" value={filter.instrumentId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, instrumentId: e.target.value || undefined, page: 1 }))} containerClassName="w-60">
          <option value="">Tous</option>
          {(instruments ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.code} — {i.name}
            </option>
          ))}
        </SelectField>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <div className="p-4">
          <Alert tone="error">{errorMessage(error)}</Alert>
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FileText} title="Aucun message reçu" />
      ) : (
        <>
          <div className={cn('overflow-x-auto', isFetching && 'opacity-60')}>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Reçu le</th>
                  <th className="px-4 py-3">Automate</th>
                  <th className="px-4 py-3">Origine</th>
                  <th className="px-4 py-3 text-right">Résultats</th>
                  <th className="px-4 py-3">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((m) => (
                  <tr key={m.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpenMessage(m.id)}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{formatDateTime(m.receivedAt)}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold">{m.instrument.code}</span>
                      <span className="block text-xs text-slate-500">{m.instrument.name}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {INSTRUMENT_MESSAGE_SOURCE_LABELS[m.source]}
                      {m.filename && <span className="block text-slate-500">{m.filename}</span>}
                      {m.source === 'UPLOAD' && m.receivedBy && <span className="block text-slate-500">{m.receivedBy}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {m.appliedCount}/{m.resultCount}
                    </td>
                    <td className="px-4 py-3">
                      <InstrumentMessageStatusBadge status={m.status} />
                      {m.error && <p className="mt-1 max-w-xs text-xs text-red-700">{m.error}</p>}
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
  );
}

/** Caractères de contrôle rendus lisibles : <STX>, <ETX>, <CR>… */
export function visibleControls(raw: string): string {
  const names: Record<string, string> = { '\x02': '<STX>', '\x03': '<ETX>', '\x04': '<EOT>', '\x05': '<ENQ>', '\x06': '<ACK>', '\x0b': '<VT>', '\x15': '<NAK>', '\x17': '<ETB>', '\x1c': '<FS>' };
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (c) => names[c] ?? `<${c.charCodeAt(0).toString(16)}>`).replace(/\r\n?/g, '\n');
}

function MessageModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: m, isLoading, isError, error } = useQuery({ ...instrumentMessageQuery(id ?? ''), enabled: !!id });
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={m ? `Message ${m.instrument.code} — ${formatDateTime(m.receivedAt)}` : 'Message'} description={m ? `${INSTRUMENT_MESSAGE_SOURCE_LABELS[m.source]}${m.filename ? ` · ${m.filename}` : ''} · empreinte ${m.sha256.slice(0, 16)}…` : undefined}>
      {isLoading || !m ? (
        isError ? <Alert tone="error">{errorMessage(error)}</Alert> : <LoadingBlock />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <InstrumentMessageStatusBadge status={m.status} />
            <span className="text-slate-500">
              {m.appliedCount} intégré(s) sur {m.resultCount}
            </span>
          </div>
          {m.error && <Alert tone="error">{m.error}</Alert>}
          {m.warnings.length > 0 && (
            <Alert tone="warning">
              <ul className="list-inside list-disc">
                {m.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          {m.results.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-1.5 pr-2">Échantillon</th>
                  <th className="py-1.5 pr-2">Test</th>
                  <th className="py-1.5 pr-2">Valeur</th>
                  <th className="py-1.5">Sort</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {m.results.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="py-1.5 pr-2 font-mono">
                      {r.specimenId}
                      {r.order && (
                        <Link to={`/resultats/${r.order.id}`} className="ml-1 text-brand-700 hover:underline" aria-label={`Ouvrir ${r.order.number}`}>
                          <ExternalLink className="inline size-3" />
                        </Link>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 font-mono">{r.testCode}</td>
                    <td className="py-1.5 pr-2 tabular-nums">
                      {r.rawValue || '—'} {r.unit ?? ''}
                    </td>
                    <td className="py-1.5">
                      <InstrumentResultStatusBadge status={r.status} />
                      {r.reason && <span className="ml-1 text-slate-500">{r.reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Message brut (conservé à l’identique)</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{visibleControls(m.raw)}</pre>
          </details>
        </div>
      )}
    </Modal>
  );
}
