import { useQuery } from '@tanstack/react-query';
import { Download, FlaskConical, KeyRound, Network, Pencil, Plug, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DHIS2_MEASURE_LABELS,
  INTEROP_RUN_KIND_LABELS,
  INTEROP_RUN_KINDS,
  INTEROP_RUN_STATUS_LABELS,
  INTEROP_RUN_STATUSES,
  INTEROP_SYSTEM_LABELS,
  INTEROP_TRANSPORT_LABELS,
  previousMonthPeriod,
  VLSM_MAX_BATCH,
  type Dhis2MappingDto,
  type InteropEndpointDto,
  type InteropRunDetailDto,
  type InteropRunKind,
  type InteropRunStatus,
  type InteropSystem,
  type VlsmMappingDto,
} from '@lims/shared';
import { INTEROP_CONFIG_ROLES, INTEROP_MAPPING_ROLES, INTEROP_SEND_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { InteropRunStatusBadge } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import {
  dhis2MappingsQuery,
  dhis2PreviewQuery,
  downloadDhis2Csv,
  interopEndpointsQuery,
  interopOverviewQuery,
  interopRunQuery,
  useDeleteDhis2Mapping,
  useDeleteVlsmMapping,
  useInteropRuns,
  useSendDhis2,
  useSendVlsm,
  useTestEndpoint,
  vlsmMappingsQuery,
  vlsmPendingQuery,
  type InteropRunsFilter,
} from '@/features/interop';
import { cn, errorMessage, formatDateTime } from '@/lib/utils';
import { EndpointFormModal } from './EndpointFormModal';
import { Dhis2MappingModal, VlsmMappingModal } from './MappingModals';

type Tab = 'connections' | 'dhis2' | 'vlsm' | 'runs';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const periodToMonth = (p: string) => `${p.slice(0, 4)}-${p.slice(4, 6)}`;
const monthToPeriod = (m: string) => m.replace('-', '');
const periodLabel = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(4, 6)) - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function InteropPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('onglet') as Tab | null) ?? 'connections';
  const runId = params.get('echange');
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };
  const overview = useQuery(interopOverviewQuery);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Interopérabilité"
        description="Rapports mensuels agrégés vers DHIS2, résultats individuels de charge virale et d’EID vers VLSM / InteLIS, en direct ou au travers d’un canal OpenHIM. Chaque échange est journalisé avec son empreinte SHA-256."
      />
      {overview.data && !overview.data.encryptionReady && (
        <Alert tone="warning" title="Clé de chiffrement absente" className="mb-4">
          La variable INTEROP_SECRET_KEY n’est pas configurée sur le serveur : aucune connexion ne peut enregistrer ni utiliser de mot de passe ou de jeton.
        </Alert>
      )}
      <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            ['connections', 'Connexions'],
            ['dhis2', 'Rapport DHIS2'],
            ['vlsm', 'Envoi VLSM'],
            ['runs', 'Journal des échanges'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => set({ onglet: id === 'connections' ? null : id })}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'dhis2' && <Dhis2Tab onOpenRun={(id) => set({ echange: id })} />}
      {tab === 'vlsm' && <VlsmTab onOpenRun={(id) => set({ echange: id })} />}
      {tab === 'runs' && <RunsTab onOpenRun={(id) => set({ echange: id })} />}
      <RunModal id={runId} onClose={() => set({ echange: null })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connexions
// ---------------------------------------------------------------------------

function ConnectionsTab() {
  const { hasRole } = useAuth();
  const canConfig = hasRole(...INTEROP_CONFIG_ROLES);
  const { data, isLoading, isError, error } = useQuery(interopEndpointsQuery);
  const test = useTestEndpoint();
  const [editing, setEditing] = useState<InteropEndpointDto | 'new' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const runTest = async (e: InteropEndpointDto) => {
    setNotice(null);
    try {
      const r = await test.mutateAsync(e.id);
      setNotice({ tone: r.lastTestOk ? 'success' : 'error', text: `${r.code} : ${r.lastTestMessage}` });
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
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-800">Systèmes distants</h2>
          {canConfig && (
            <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
              Nouvelle connexion
            </Button>
          )}
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : isError ? (
          <Alert tone="error" className="m-4">
            {errorMessage(error)}
          </Alert>
        ) : !data?.length ? (
          <EmptyState icon={Network} title="Aucune connexion">
            Déclarez l’instance DHIS2 nationale et le STS VLSM / InteLIS, directement ou via OpenHIM.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Connexion</th>
                  <th className="px-4 py-2">Système</th>
                  <th className="px-4 py-2">Acheminement</th>
                  <th className="px-4 py-2">Dernier test</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((e) => (
                  <tr key={e.id} className={cn(!e.isActive && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">
                        {e.name} {!e.isActive && <Badge>Inactive</Badge>}
                      </div>
                      <div className="font-mono text-xs text-slate-500">
                        {e.code} · {e.baseUrl}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={e.system === 'DHIS2' ? 'info' : 'brand'}>{e.system}</Badge>
                      <div className="mt-1 text-xs text-slate-500">{e.mappingCount} correspondance(s)</div>
                    </td>
                    <td className="px-4 py-3">
                      {INTEROP_TRANSPORT_LABELS[e.transport]}
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <KeyRound className="size-3" aria-hidden /> {e.hasSecret ? `${e.username ?? 'jeton'} · secret chiffré` : 'aucun secret'}
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      {e.lastTestAt ? (
                        <>
                          <Badge tone={e.lastTestOk ? 'success' : 'danger'}>{e.lastTestOk ? 'Réussi' : 'Échec'}</Badge>
                          <div className="mt-1 text-xs text-slate-600">{e.lastTestMessage}</div>
                          <div className="text-xs text-slate-400">{formatDateTime(e.lastTestAt)}</div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">Jamais testée</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {canConfig && (
                          <>
                            <Button size="sm" variant="secondary" icon={Plug} loading={test.isPending && test.variables === e.id} onClick={() => runTest(e)}>
                              Tester
                            </Button>
                            <IconAction icon={Pencil} label="Modifier" onClick={() => setEditing(e)} />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <EndpointFormModal open={!!editing} endpoint={editing && editing !== 'new' ? editing : null} onClose={() => setEditing(null)} />
    </>
  );
}

function EndpointSelect({ system, value, onChange }: { system: InteropSystem; value: string; onChange: (id: string) => void }) {
  const { data } = useQuery(interopEndpointsQuery);
  const list = (data ?? []).filter((e) => e.system === system);
  useEffect(() => {
    if (!value && list.length) onChange((list.find((e) => e.isActive) ?? list[0]!).id);
  }, [value, list, onChange]);
  return (
    <SelectField label={`Connexion ${system}`} value={value} onChange={(e) => onChange(e.target.value)} containerClassName="min-w-72">
      {list.length === 0 && <option value="">Aucune connexion {system}</option>}
      {list.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name} ({INTEROP_TRANSPORT_LABELS[e.transport]}){e.isActive ? '' : ' — inactive'}
        </option>
      ))}
    </SelectField>
  );
}

// ---------------------------------------------------------------------------
// Rapport DHIS2
// ---------------------------------------------------------------------------

function Dhis2Tab({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const { hasRole } = useAuth();
  const canMap = hasRole(...INTEROP_MAPPING_ROLES);
  const canSend = hasRole(...INTEROP_SEND_ROLES);
  const [endpointId, setEndpointId] = useState('');
  const [period, setPeriod] = useState(() => previousMonthPeriod(localToday()));
  const endpoints = useQuery(interopEndpointsQuery);
  const endpoint = endpoints.data?.find((e) => e.id === endpointId);
  const mappings = useQuery({ ...dhis2MappingsQuery(endpointId), enabled: !!endpointId });
  const preview = useQuery({ ...dhis2PreviewQuery(endpointId, period), enabled: !!endpointId && /^\d{6}$/.test(period) });
  const del = useDeleteDhis2Mapping();
  const send = useSendDhis2();
  const [editing, setEditing] = useState<Dhis2MappingDto | 'new' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [lastRun, setLastRun] = useState<InteropRunDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doSend = async (dryRun: boolean) => {
    setError(null);
    setConfirm(false);
    try {
      setLastRun(await send.mutateAsync({ endpointId, body: { period, dryRun } }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (endpoints.data && !endpoints.data.some((e) => e.system === 'DHIS2')) {
    return (
      <Card>
        <EmptyState icon={Network} title="Aucune connexion DHIS2">
          Déclarez d’abord l’instance DHIS2 dans l’onglet Connexions.
        </EmptyState>
      </Card>
    );
  }
  const identical = preview.data?.lastSentSha256 && preview.data.lastSentSha256 === preview.data.payloadSha256;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <EndpointSelect system="DHIS2" value={endpointId} onChange={setEndpointId} />
        <TextField label="Période (mois)" type="month" value={periodToMonth(period)} max={periodToMonth(localToday().slice(0, 7).replace('-', ''))} onChange={(e) => e.target.value && setPeriod(monthToPeriod(e.target.value))} />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-800">Correspondances</h2>
            <p className="text-xs text-slate-500">Paramètre du catalogue → élément de données DHIS2 (ventilations par seuil, sexe et âge du canevas CV).</p>
          </div>
          {canMap && endpointId && (
            <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
              Ajouter
            </Button>
          )}
        </div>
        {mappings.isLoading ? (
          <LoadingBlock />
        ) : !mappings.data?.length ? (
          <p className="px-4 py-6 text-sm text-slate-500">Aucune correspondance pour cette connexion.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Libellé</th>
                <th className="px-4 py-2">Paramètre</th>
                <th className="px-4 py-2">Règle</th>
                <th className="px-4 py-2">Cellule DHIS2</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mappings.data.map((m) => (
                <tr key={m.id} className={cn(!m.isActive && 'opacity-50')}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {m.label} {!m.isActive && <Badge>Inactive</Badge>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {m.parameter.examCode} · {m.parameter.name}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {DHIS2_MEASURE_LABELS[m.measure].replace('seuil', String(m.threshold ?? 'seuil'))}
                    {m.measure === 'TEXT_EQUALS' && ` « ${m.textMatch} »`}
                    {m.sex !== 'ANY' && ` · ${m.sex === 'FEMALE' ? 'F' : 'M'}`}
                    {(m.ageMinYears !== null || m.ageMaxYears !== null) && ` · ${m.ageMinYears ?? 0}${m.ageMaxYears !== null ? `–${m.ageMaxYears - 1}` : '+'} ans`}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">
                    {m.dataElement}
                    {m.categoryOptionCombo ? `.${m.categoryOptionCombo}` : ''}
                  </td>
                  <td className="px-4 py-2">
                    {canMap && (
                      <div className="flex justify-end gap-1">
                        <IconAction icon={Pencil} label="Modifier" onClick={() => setEditing(m)} />
                        <IconAction icon={Trash2} label="Supprimer" onClick={() => window.confirm(`Supprimer la correspondance « ${m.label} » ?`) && del.mutate(m.id)} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-800">Valeurs de {periodLabel(period)}</h2>
            <p className="text-xs text-slate-500">
              Résultats ayant reçu leur validation biologique pendant le mois (heure du laboratoire), hors demandes annulées
              {preview.data ? ` — ${preview.data.resultCount} résultat(s) pris en compte.` : '.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={Download} disabled={!preview.data} onClick={() => endpoint && downloadDhis2Csv(endpointId, period, endpoint.code).catch((e) => setError(errorMessage(e)))}>
              CSV d’import
            </Button>
            {canSend && (
              <>
                <Button size="sm" variant="secondary" icon={FlaskConical} loading={send.isPending && send.variables?.body.dryRun === true} disabled={!preview.data?.lines.length || !endpoint?.isActive} onClick={() => doSend(true)}>
                  Simuler (dryRun)
                </Button>
                <Button size="sm" icon={Send} loading={send.isPending && send.variables?.body.dryRun === false} disabled={!preview.data?.lines.length || !endpoint?.isActive} onClick={() => setConfirm(true)}>
                  Envoyer à DHIS2
                </Button>
              </>
            )}
          </div>
        </div>
        {error && (
          <Alert tone="error" className="m-4">
            {error}
          </Alert>
        )}
        {preview.isLoading ? (
          <LoadingBlock label="Calcul des agrégats…" />
        ) : preview.isError ? (
          <Alert tone="error" className="m-4">
            {errorMessage(preview.error)}
          </Alert>
        ) : preview.data ? (
          <div className="flex flex-col gap-3 p-4">
            {preview.data.warnings.map((w) => (
              <Alert key={w} tone="warning">
                {w}
              </Alert>
            ))}
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Indicateur</th>
                  <th className="py-1 pr-3">Cellule</th>
                  <th className="py-1 pr-3 text-right">Valeur</th>
                  <th className="py-1 pr-3 text-right">Écartés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.data.lines.map((l) => (
                  <tr key={l.mappingId} className={cn(!l.sent && 'text-slate-400')}>
                    <td className="py-2">{l.label}</td>
                    <td className="py-2 font-mono text-xs">
                      {l.dataElement}
                      {l.categoryOptionCombo ? `.${l.categoryOptionCombo}` : ''}
                    </td>
                    <td className="py-2 text-right text-base font-semibold tabular-nums text-slate-900">{l.value}</td>
                    <td className="py-2 text-right text-xs text-slate-500">
                      {l.excludedNoAge > 0 && `${l.excludedNoAge} sans âge `}
                      {l.excludedAmbiguous > 0 && `${l.excludedAmbiguous} indéterminé(s)`}
                      {!l.sent && 'non envoyé (0)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">SHA-256 {preview.data.payloadSha256.slice(0, 16)}…</span>
              {preview.data.lastSentAt ? (
                identical ? (
                  <Badge tone="success">Identique au dernier envoi du {formatDateTime(preview.data.lastSentAt)}</Badge>
                ) : (
                  <Badge tone="warning">Différent du dernier envoi du {formatDateTime(preview.data.lastSentAt)}</Badge>
                )
              ) : (
                <Badge>Jamais transmis</Badge>
              )}
            </div>
          </div>
        ) : null}
      </Card>
      {lastRun && <RunSummary run={lastRun} onOpen={() => onOpenRun(lastRun.id)} />}
      <Dhis2MappingModal endpointId={endpointId} mapping={editing} onClose={() => setEditing(null)} />
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Transmettre à DHIS2 ?"
        description={`Les ${preview.data?.lines.filter((l) => l.sent).length ?? 0} valeurs de ${periodLabel(period)} seront enregistrées dans DHIS2 (création ou mise à jour) pour l’unité ${(endpoint?.settings as { orgUnit?: string } | undefined)?.orgUnit ?? ''}.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Annuler
            </Button>
            <Button icon={Send} onClick={() => doSend(false)}>
              Transmettre
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Conseil : lancez d’abord une simulation (dryRun) pour vérifier qu’aucun élément de données n’est refusé.</p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Envoi VLSM
// ---------------------------------------------------------------------------

function VlsmTab({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const { hasRole } = useAuth();
  const canMap = hasRole(...INTEROP_MAPPING_ROLES);
  const canSend = hasRole(...INTEROP_SEND_ROLES);
  const [endpointId, setEndpointId] = useState('');
  const today = localToday();
  const [range, setRange] = useState(() => ({ from: new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10), to: today }));
  const endpoints = useQuery(interopEndpointsQuery);
  const endpoint = endpoints.data?.find((e) => e.id === endpointId);
  const mappings = useQuery({ ...vlsmMappingsQuery(endpointId), enabled: !!endpointId });
  const pending = useQuery({ ...vlsmPendingQuery(endpointId, range.from, range.to), enabled: !!endpointId });
  const del = useDeleteVlsmMapping();
  const send = useSendVlsm();
  const [editing, setEditing] = useState<VlsmMappingDto | 'new' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastRun, setLastRun] = useState<InteropRunDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eligible = useMemo(() => (pending.data ?? []).filter((p) => !p.blocker), [pending.data]);

  useEffect(() => setSelected(new Set()), [endpointId, range.from, range.to]);

  const doSend = async () => {
    setError(null);
    try {
      const run = await send.mutateAsync({ endpointId, orderItemIds: [...selected].slice(0, VLSM_MAX_BATCH) });
      setLastRun(run);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (endpoints.data && !endpoints.data.some((e) => e.system === 'VLSM')) {
    return (
      <Card>
        <EmptyState icon={Network} title="Aucune connexion VLSM">
          Déclarez d’abord le STS VLSM / InteLIS dans l’onglet Connexions.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <EndpointSelect system="VLSM" value={endpointId} onChange={setEndpointId} />
        <TextField label="Validés du" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
        <TextField label="au" type="date" value={range.to} max={today} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-800">Paramètres transmis</h2>
            <p className="text-xs text-slate-500">Seuls les résultats de ces paramètres sont envoyés à VLSM, après validation biologique.</p>
          </div>
          {canMap && endpointId && (
            <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
              Ajouter
            </Button>
          )}
        </div>
        {!mappings.data?.length ? (
          <p className="px-4 py-6 text-sm text-slate-500">Aucun paramètre associé à VLSM.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {mappings.data.map((m) => (
              <li key={m.id} className={cn('flex items-center justify-between px-4 py-2', !m.isActive && 'opacity-50')}>
                <span>
                  <Badge tone={m.testType === 'VL' ? 'brand' : 'info'}>{m.testType}</Badge> <span className="font-medium">{m.parameter.examName}</span> — {m.parameter.name}
                  {m.testType === 'EID' && <span className="text-xs text-slate-500"> · positif = « {m.eidPositive} », négatif = « {m.eidNegative} »{m.eidIndeterminate ? `, indéterminé = « ${m.eidIndeterminate} »` : ''}</span>}
                </span>
                {canMap && (
                  <span className="flex gap-1">
                    <IconAction icon={Pencil} label="Modifier" onClick={() => setEditing(m)} />
                    <IconAction icon={Trash2} label="Supprimer" onClick={() => window.confirm('Retirer ce paramètre des envois VLSM ?') && del.mutate(m.id)} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-800">Résultats à transmettre {pending.data ? `(${pending.data.length})` : ''}</h2>
            <p className="text-xs text-slate-500">Un résultat corrigé après validation revient dans la file : sa nouvelle version met à jour le même enregistrement VLSM.</p>
          </div>
          {canSend && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={!eligible.length} onClick={() => setSelected(new Set(eligible.slice(0, VLSM_MAX_BATCH).map((p) => p.orderItemId)))}>
                Tout sélectionner
              </Button>
              <Button size="sm" icon={Send} disabled={!selected.size || !endpoint?.isActive} loading={send.isPending} onClick={doSend}>
                Envoyer {selected.size ? `(${selected.size})` : ''}
              </Button>
            </div>
          )}
        </div>
        {error && (
          <Alert tone="error" className="m-4">
            {error}
          </Alert>
        )}
        {pending.isLoading ? (
          <LoadingBlock />
        ) : pending.isError ? (
          <Alert tone="error" className="m-4">
            {errorMessage(pending.error)}
          </Alert>
        ) : !pending.data?.length ? (
          <p className="px-4 py-6 text-sm text-slate-500">Rien à transmettre sur la période.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 px-4 py-2" />
                  <th className="px-2 py-2">Échantillon</th>
                  <th className="px-2 py-2">Patient</th>
                  <th className="px-2 py-2">Test</th>
                  <th className="px-2 py-2">Résultat</th>
                  <th className="px-2 py-2">Validé le</th>
                  <th className="px-2 py-2">État</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.data.map((p) => (
                  <tr key={p.orderItemId}>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${p.sampleNumber}`}
                        className="size-4 accent-brand-700"
                        disabled={!!p.blocker || !canSend}
                        checked={selected.has(p.orderItemId)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(p.orderItemId);
                            else n.delete(p.orderItemId);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">
                      {p.sampleNumber}
                      <div className="text-slate-400">{p.orderNumber}</div>
                    </td>
                    <td className="px-2 py-2">
                      {p.patientName}
                      <div className="text-xs text-slate-500">{p.patientArtNo ? `N° ${p.patientArtNo}` : <span className="text-red-600">sans N° TARV</span>}</div>
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={p.testType === 'VL' ? 'brand' : 'info'}>{p.testType}</Badge>
                      {p.itemVersion > 1 && <span className="ml-1 text-xs text-amber-700">v{p.itemVersion}</span>}
                    </td>
                    <td className="px-2 py-2 font-semibold tabular-nums">{p.value ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">{formatDateTime(p.validatedAt)}</td>
                    <td className="max-w-xs px-2 py-2 text-xs">
                      {p.blocker ? (
                        <span className="text-red-700">{p.blocker}</span>
                      ) : p.lastAttempt?.status === 'FAILED' ? (
                        <span className="text-amber-700">Échec le {formatDateTime(p.lastAttempt.at)} : {p.lastAttempt.message}</span>
                      ) : p.lastAttempt?.status === 'SENT' ? (
                        <span className="text-slate-500">Version {p.lastAttempt.itemVersion} envoyée — correction à transmettre</span>
                      ) : (
                        <span className="text-slate-500">Prêt</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {lastRun && <RunSummary run={lastRun} onOpen={() => onOpenRun(lastRun.id)} />}
      <VlsmMappingModal endpointId={endpointId} mapping={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

function RunSummary({ run, onOpen }: { run: InteropRunDetailDto; onOpen: () => void }) {
  return (
    <Alert tone={run.status === 'SUCCESS' ? 'success' : run.status === 'WARNING' ? 'warning' : 'error'} title={`${INTEROP_RUN_KIND_LABELS[run.kind]} — ${INTEROP_RUN_STATUS_LABELS[run.status]}`}>
      <p>{run.message}</p>
      {run.conflicts.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {run.conflicts.slice(0, 5).map((c, i) => (
            <li key={i}>
              {c.object} : {c.value} {c.errorCode && `(${c.errorCode})`}
            </li>
          ))}
        </ul>
      )}
      <button className="mt-2 text-xs font-medium underline" onClick={onOpen}>
        Voir le détail de l’échange
      </button>
    </Alert>
  );
}

function RunsTab({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const endpoints = useQuery(interopEndpointsQuery);
  const [filter, setFilter] = useState<InteropRunsFilter>({ page: 1, pageSize: 25 });
  const { data, isLoading, isError, error } = useInteropRuns(filter);
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
        <SelectField label="Connexion" value={filter.endpointId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, page: 1, endpointId: e.target.value || undefined }))}>
          <option value="">Toutes</option>
          {(endpoints.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.code}
            </option>
          ))}
        </SelectField>
        <SelectField label="Type" value={filter.kind ?? ''} onChange={(e) => setFilter((f) => ({ ...f, page: 1, kind: (e.target.value || undefined) as InteropRunKind | undefined }))}>
          <option value="">Tous</option>
          {INTEROP_RUN_KINDS.map((k) => (
            <option key={k} value={k}>
              {INTEROP_RUN_KIND_LABELS[k]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Statut" value={filter.status ?? ''} onChange={(e) => setFilter((f) => ({ ...f, page: 1, status: (e.target.value || undefined) as InteropRunStatus | undefined }))}>
          <option value="">Tous</option>
          {INTEROP_RUN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INTEROP_RUN_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <Alert tone="error" className="m-4">
          {errorMessage(error)}
        </Alert>
      ) : !data?.items.length ? (
        <p className="px-4 py-6 text-sm text-slate-500">Aucun échange.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-2 py-2">Connexion</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Statut</th>
                  <th className="px-2 py-2">Résumé</th>
                  <th className="px-2 py-2">Par</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpenRun(r.id)}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-600">{formatDateTime(r.createdAt)}</td>
                    <td className="px-2 py-2 font-mono text-xs">
                      {r.endpoint.code}
                      {r.endpoint.transport === 'OPENHIM' && <Badge>OpenHIM</Badge>}
                    </td>
                    <td className="px-2 py-2">
                      {INTEROP_RUN_KIND_LABELS[r.kind]}
                      {r.period && <span className="ml-1 text-xs text-slate-500">{r.period}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <InteropRunStatusBadge status={r.status} />
                    </td>
                    <td className="max-w-md truncate px-2 py-2 text-xs text-slate-600" title={r.message ?? ''}>
                      {r.message}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">{r.triggeredBy ?? '—'}</td>
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

function RunModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({ ...interopRunQuery(id ?? ''), enabled: !!id });
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={data ? `${INTEROP_RUN_KIND_LABELS[data.kind]} — ${data.endpoint.code}` : 'Échange'} description={data ? `${formatDateTime(data.createdAt)} · ${INTEROP_SYSTEM_LABELS[data.endpoint.system]} · ${INTEROP_TRANSPORT_LABELS[data.endpoint.transport]}` : undefined}>
      {isLoading || !data ? (
        <LoadingBlock />
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <InteropRunStatusBadge status={data.status} />
            {data.period && <Badge>Période {data.period}</Badge>}
            {data.httpStatus !== null && <Badge>HTTP {data.httpStatus}</Badge>}
            <Badge>{data.durationMs} ms</Badge>
            {data.triggeredBy && <span className="text-xs text-slate-500">par {data.triggeredBy}</span>}
          </div>
          <p className="text-slate-700">{data.message}</p>
          {data.imported !== null && (
            <dl className="grid grid-cols-4 gap-2 text-center">
              {(
                [
                  ['Importées', data.imported],
                  ['Mises à jour', data.updated],
                  ['Ignorées', data.ignored],
                  ['Supprimées', data.deleted],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="rounded-md bg-slate-50 p-2">
                  <dt className="text-xs text-slate-500">{l}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{v ?? 0}</dd>
                </div>
              ))}
            </dl>
          )}
          {data.conflicts.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold text-slate-800">Conflits signalés par DHIS2</h3>
              <ul className="list-disc pl-5 text-xs text-slate-700">
                {data.conflicts.map((c, i) => (
                  <li key={i}>
                    <span className="font-mono">{c.object}</span> : {c.value} {c.errorCode && `(${c.errorCode})`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.submissions.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Échantillon</th>
                  <th className="py-1 pr-3">Version</th>
                  <th className="py-1 pr-3">Envoi</th>
                  <th className="py-1 pr-3">Code VLSM</th>
                  <th className="py-1 pr-3">Réponse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-1 pr-3 font-mono">{s.sampleNumber}</td>
                    <td className="py-1 pr-3">v{s.itemVersion}</td>
                    <td className="py-1 pr-3">
                      <Badge tone={s.status === 'SENT' ? 'success' : 'danger'}>{s.status === 'SENT' ? 'Accepté' : 'Échec'}</Badge>
                    </td>
                    <td className="py-1 pr-3 font-mono">{s.remoteSampleCode ?? '—'}</td>
                    <td className="py-1 pr-3 text-slate-600">{s.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="text-xs text-slate-500">
            {data.payloadSha256 && <div className="font-mono">SHA-256 {data.payloadSha256}</div>}
            {data.openhimTransactionId && <div className="font-mono">Transaction OpenHIM {data.openhimTransactionId}</div>}
          </div>
          {data.payload !== null && data.payload !== undefined && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-slate-600">Charge utile conservée{data.endpoint.system === 'VLSM' ? ' (expurgée des données patient)' : ''}</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(data.payload, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
