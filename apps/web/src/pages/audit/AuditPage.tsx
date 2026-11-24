import { ChevronDown, ChevronRight, FilterX, ScrollText, ShieldCheck } from 'lucide-react';
import { Fragment, useState } from 'react';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABELS,
  ROLE_LABELS,
  type AuditAction,
  type AuditEntity,
  type AuditLogDto,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuditLog, useVerifyAudit, type AuditFilter } from '@/features/audit';
import { errorMessage, formatDateTime } from '@/lib/utils';

const EMPTY_FILTER: AuditFilter = { page: 1, pageSize: 25, entity: '', entityId: '', action: '', from: '', to: '' };

const ACTION_TONE: Partial<Record<AuditAction, 'success' | 'info' | 'danger' | 'warning' | 'neutral'>> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  RESTORE: 'success',
  LOGIN_FAILURE: 'warning',
  ACCOUNT_LOCKED: 'danger',
  ACCESS_DENIED: 'danger',
  TOKEN_REUSE_DETECTED: 'danger',
};

export function AuditPage() {
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_FILTER);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, isError, error, isFetching } = useAuditLog(filter);
  const verify = useVerifyAudit();

  const update = (patch: Partial<AuditFilter>) => setFilter((f) => ({ ...f, ...patch, page: 1 }));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Piste d’audit"
        description="Journal inaltérable de toutes les opérations sensibles (ISO 15189). Les entrées sont chaînées par hash SHA-256."
        actions={
          <Button variant="secondary" icon={ShieldCheck} loading={verify.isPending} onClick={() => verify.mutate()}>
            Vérifier l’intégrité
          </Button>
        }
      />

      {verify.isError && (
        <Alert tone="error" className="mb-4">
          {errorMessage(verify.error)}
        </Alert>
      )}
      {verify.data &&
        (verify.data.valid ? (
          <Alert tone="success" title="Chaîne d’audit intègre" className="mb-4">
            {verify.data.totalEntries} entrées vérifiées le {formatDateTime(verify.data.checkedAt)}. Dernière entrée n°
            {verify.data.lastSeq ?? '—'}, empreinte : <code className="break-all font-mono text-xs">{verify.data.lastHash ?? '—'}</code>
            <p className="mt-1 text-xs">Consignez cette empreinte dans votre registre qualité pour ancrer la chaîne.</p>
          </Alert>
        ) : (
          <Alert tone="error" title="Anomalie d’intégrité détectée" className="mb-4">
            {verify.data.issues.length} anomalie(s) sur {verify.data.totalEntries} entrées. Ouvrez une non-conformité et
            préservez la base en l’état.
            <ul className="mt-2 list-inside list-disc text-xs">
              {verify.data.issues.slice(0, 10).map((i) => (
                <li key={`${i.seq}-${i.issue}`}>
                  Entrée n°{i.seq} :{' '}
                  {i.issue === 'HASH_MISMATCH'
                    ? 'contenu modifié'
                    : i.issue === 'CHAIN_BROKEN'
                      ? 'chaînage rompu'
                      : 'rupture de séquence (entrée supprimée ?)'}
                </li>
              ))}
            </ul>
          </Alert>
        ))}

      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-6">
          <SelectField label="Entité" value={filter.entity} onChange={(e) => update({ entity: e.target.value })}>
            <option value="">Toutes</option>
            {AUDIT_ENTITIES.map((en) => (
              <option key={en} value={en}>
                {AUDIT_ENTITY_LABELS[en]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Action"
            value={filter.action}
            onChange={(e) => update({ action: e.target.value as AuditAction | '' })}
          >
            <option value="">Toutes</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Identifiant d’entité"
            value={filter.entityId}
            onChange={(e) => update({ entityId: e.target.value.trim() })}
            containerClassName="md:col-span-2"
          />
          <TextField label="Du" type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => update({ from: e.target.value })} />
          <TextField label="Au" type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => update({ to: e.target.value })} />
          <div className="md:col-span-6">
            <Button variant="ghost" size="sm" icon={FilterX} onClick={() => setFilter(EMPTY_FILTER)}>
              Réinitialiser les filtres
            </Button>
          </div>
        </div>

        {isLoading ? (
          <LoadingBlock />
        ) : isError ? (
          <div className="p-4">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={ScrollText} title="Aucune entrée pour ces critères" />
        ) : (
          <>
            <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-8 px-3 py-3" />
                    <th className="px-3 py-3">N°</th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Acteur</th>
                    <th className="px-3 py-3">Action</th>
                    <th className="px-3 py-3">Entité</th>
                    <th className="px-3 py-3">Motif / détail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((row) => {
                    const open = expanded === row.id;
                    return (
                      <Fragment key={row.id}>
                        <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(open ? null : row.id)}>
                          <td className="px-3 py-2 text-slate-400">
                            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.seq}</td>
                          <td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.occurredAt)}</td>
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-800">{row.actorUsername ?? 'anonyme'}</p>
                            {row.actorRoles.length > 0 && (
                              <p className="text-xs text-slate-500">{row.actorRoles.map((r) => ROLE_LABELS[r]).join(', ')}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={ACTION_TONE[row.action] ?? 'neutral'}>{AUDIT_ACTION_LABELS[row.action]}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            <p>{AUDIT_ENTITY_LABELS[row.entity as AuditEntity] ?? row.entity}</p>
                            <p className="max-w-48 truncate font-mono text-xs text-slate-500" title={row.entityId}>
                              {row.entityId}
                            </p>
                          </td>
                          <td className="max-w-md px-3 py-2 text-slate-600">
                            <p className="truncate" title={row.reason ?? undefined}>
                              {row.reason ?? '—'}
                            </p>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50">
                            <td colSpan={7} className="px-6 py-4">
                              <AuditDetail row={row} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              onChange={(page) => setFilter((f) => ({ ...f, page }))}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function display(v: unknown): string {
  if (v === undefined) return '';
  if (v === null) return '∅';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function AuditDetail({ row }: { row: AuditLogDto }) {
  const before = asRecord(row.before);
  const after = asRecord(row.after);
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();

  return (
    <div className="space-y-3 text-xs">
      {keys.length > 0 && (
        <table className="w-full max-w-4xl overflow-hidden rounded-md border border-slate-200 bg-white">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-3 py-1.5">Champ</th>
              {before && <th className="px-3 py-1.5">Avant</th>}
              <th className="px-3 py-1.5">{before ? 'Après' : 'Valeur'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {keys.map((k) => {
              const b = before?.[k];
              const a = after?.[k];
              const changed = before && after && JSON.stringify(b) !== JSON.stringify(a);
              return (
                <tr key={k} className={changed ? 'bg-amber-50' : ''}>
                  <td className="px-3 py-1.5 font-sans font-medium text-slate-700">{k}</td>
                  {before && <td className="break-all px-3 py-1.5 text-slate-500">{display(b)}</td>}
                  <td className="break-all px-3 py-1.5 text-slate-800">{display(a)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <dl className="grid max-w-4xl gap-x-6 gap-y-1 text-slate-600 sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Adresse IP : </dt>
          <dd className="inline font-mono">{row.ip ?? '—'}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Requête : </dt>
          <dd className="inline font-mono">{row.requestId ?? '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline font-medium">Navigateur : </dt>
          <dd className="inline">{row.userAgent ?? '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline font-medium">Empreinte : </dt>
          <dd className="inline break-all font-mono">{row.hash}</dd>
        </div>
      </dl>
    </div>
  );
}
