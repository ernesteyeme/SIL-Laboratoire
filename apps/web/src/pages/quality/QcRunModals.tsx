import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, ExternalLink, EyeOff, FlaskConical, LineChart, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  evaluateWestgard,
  qcCorrectiveActionSchema,
  qcRunSchema,
  WESTGARD_RULE_LABELS,
  zScore,
  type QcParameterStatusDto,
  type QcRunDetailDto,
  type QcStatus,
  type WestgardRule,
} from '@lims/shared';
import { QC_CORRECTIVE_ROLES, QC_EXCLUDE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { QcStatusBadge, QualityIssueStatusBadge } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { Alert, Badge, LoadingBlock } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { ReasonModal } from '@/components/ui/ReasonModal';
import { qcRunQuery, useCreateQcRun, useExcludeQcRun, useQcCorrectiveAction } from '@/features/quality';
import { ApiError } from '@/lib/api';
import { cn, errorMessage, formatDateTime } from '@/lib/utils';

export const fmt = (v: number | null | undefined, decimals: number | null = null) =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('fr-FR', decimals === null ? { maximumFractionDigits: 4 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
export const fmtZ = (z: number) => `${z > 0 ? '+' : ''}${fmt(z, 2)}`;

function parseDecimal(raw: string): number | null {
  const v = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (v === '' || !/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

export function RulesList({ rules }: { rules: WestgardRule[] }) {
  if (rules.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {rules.map((r) => (
        <span key={r} title={WESTGARD_RULE_LABELS[r]} className={cn('rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1 ring-inset', r === '1-2s' ? 'bg-amber-50 text-amber-800 ring-amber-300' : 'bg-red-50 text-red-800 ring-red-300')}>
          {r}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Saisie d'une série
// ---------------------------------------------------------------------------

export function QcRunEntryModal({ item, onClose, onCreated }: { item: QcParameterStatusDto | null; onClose: () => void; onCreated: (runId: string) => void }) {
  const create = useCreateQcRun();
  const [values, setValues] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setValues({});
      setComment('');
      setErrors({});
      setFormError(null);
    }
  }, [item]);

  const usable = item?.targets.filter((t) => !t.expired) ?? [];
  const points = useMemo(
    () =>
      usable.flatMap((t) => {
        const v = parseDecimal(values[t.id] ?? '');
        return v === null ? [] : [{ targetId: t.id, value: v, z: zScore(v, t.mean, t.sd) }];
      }),
    [usable, values],
  );
  // Aperçu sur la seule série : les règles qui dépendent de l'historique (2-2s entre séries, 4-1s, 10x) sont évaluées par le serveur.
  const preview = points.length > 0 ? evaluateWestgard(points, new Map()) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setFormError(null);
    const filled = usable.filter((t) => (values[t.id] ?? '').trim() !== '');
    const parsed = qcRunSchema.safeParse({
      parameterId: item.parameter.id,
      results: filled.map((t) => ({ targetId: t.id, value: values[t.id] })),
      comment,
    });
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const idx = issue.path[1];
        if (issue.path[0] === 'results' && typeof idx === 'number' && filled[idx]) map[filled[idx].id] = issue.message;
        else setFormError(issue.message);
      }
      setErrors(map);
      return;
    }
    setErrors({});
    try {
      const run = await create.mutateAsync(parsed.data);
      onCreated(run.id);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        const map: Record<string, string> = {};
        for (const f of err.fieldErrors) {
          const idx = Number(f.path.split('.')[1]);
          if (filled[idx]) map[filled[idx].id] = f.message;
        }
        setErrors(map);
      }
      setFormError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      size="lg"
      title={item ? `Série de contrôle — ${item.parameter.name}` : 'Série de contrôle'}
      description={item ? `${item.parameter.examName} · ${item.parameter.sectionName}${item.parameter.unit ? ` · ${item.parameter.unit}` : ''}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="qc-run-form" icon={Save} loading={create.isPending} disabled={points.length === 0}>
            Enregistrer la série
          </Button>
        </>
      }
    >
      {item && (
        <form id="qc-run-form" onSubmit={submit} noValidate className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-3">Niveau</th>
                <th className="py-2 pr-3">Cible (moyenne ± ET)</th>
                <th className="py-2 pr-3">Valeur mesurée</th>
                <th className="py-2 pr-3 text-right">z</th>
                <th className="py-2">Aperçu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {item.targets.map((t) => {
                const p = points.find((x) => x.targetId === t.id);
                const e = p && preview ? preview.byTarget.get(t.id) : null;
                return (
                  <tr key={t.id} className={cn(t.expired && 'opacity-60')}>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-slate-800">{t.level}</p>
                      <p className="text-xs text-slate-500">
                        {t.materialName} · lot {t.lotNumber}
                      </p>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-slate-600">
                      {fmt(t.mean)} ± {fmt(t.sd)}
                    </td>
                    <td className="py-2 pr-3">
                      {t.expired ? (
                        <Badge tone="danger">Lot périmé</Badge>
                      ) : (
                        <>
                          <input
                            aria-label={`Valeur ${t.level}`}
                            inputMode="decimal"
                            value={values[t.id] ?? ''}
                            onChange={(ev) => setValues((v) => ({ ...v, [t.id]: ev.target.value }))}
                            className={cn('w-28 rounded-md border px-2 py-1.5 tabular-nums', errors[t.id] ? 'border-red-500 bg-red-50' : 'border-slate-300')}
                          />
                          {errors[t.id] && <p className="mt-0.5 text-xs text-red-700">{errors[t.id]}</p>}
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p ? fmtZ(p.z) : '—'}</td>
                    <td className="py-2">{e ? <span className="flex flex-wrap items-center gap-1"><QcStatusBadge status={e.status} /><RulesList rules={e.rules} /></span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {preview && (
            <Alert tone={preview.status === 'REJECTED' ? 'error' : preview.status === 'WARNING' ? 'warning' : 'info'}>
              Aperçu sur cette série : <strong>{preview.status === 'REJECTED' ? 'rejet' : preview.status === 'WARNING' ? 'avertissement' : 'conforme'}</strong>
              {preview.rules.length > 0 && ` (${preview.rules.join(', ')})`}. Les règles qui portent sur les séries précédentes (2-2s, 4-1s, 10x) sont
              évaluées à l’enregistrement.
            </Alert>
          )}
          <TextAreaField label="Commentaire" placeholder="Nouveau flacon, après maintenance…" value={comment} onChange={(e) => setComment(e.target.value)} />
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Détail d'une série
// ---------------------------------------------------------------------------

export function QcRunDetailModal({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { data: run, isLoading, isError, error } = useQuery({ ...qcRunQuery(runId ?? ''), enabled: !!runId });
  return (
    <Modal open={!!runId} onClose={onClose} size="lg" title={run ? `CIQ ${run.parameter.name} — ${formatDateTime(run.performedAt)}` : 'Série de contrôle'} description={run ? `${run.parameter.examName} · ${run.parameter.sectionName}` : undefined}>
      {isLoading || !run ? isError ? <Alert tone="error">{errorMessage(error)}</Alert> : <LoadingBlock /> : <RunDetail run={run} />}
    </Modal>
  );
}

function RunDetail({ run }: { run: QcRunDetailDto }) {
  const { hasRole } = useAuth();
  const corrective = useQcCorrectiveAction();
  const exclude = useExcludeQcRun();
  const [action, setAction] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const needsAction = run.status === 'REJECTED' && !run.resolvedAt && !run.excludedAt;
  const statusLabel: Record<QcStatus, string> = { ACCEPTED: 'Série conforme : résultats patients validables.', WARNING: 'Avertissement 1-2s : série utilisable, vérifiez les autres règles et la tendance.', REJECTED: 'Série rejetée : validation des résultats patients du paramètre bloquée jusqu’à une série acceptée.' };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <QcStatusBadge status={run.status} />
        <RulesList rules={run.rules} />
        {run.excludedAt && (
          <Badge>
            <EyeOff className="mr-1 size-3" aria-hidden />
            Exclue des statistiques
          </Badge>
        )}
        <span className="text-sm text-slate-500">par {run.performedBy ?? '—'}</span>
      </div>
      <p className="text-sm text-slate-700">{run.excludedAt ? `Exclue par ${run.excludedBy ?? '—'} le ${formatDateTime(run.excludedAt)} : ${run.excludedReason}` : statusLabel[run.status]}</p>

      <table className="w-full text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="py-2 pr-3">Niveau</th>
            <th className="py-2 pr-3 text-right">Valeur</th>
            <th className="py-2 pr-3 text-right">Cible</th>
            <th className="py-2 pr-3 text-right">z</th>
            <th className="py-2 pr-3">Règles</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {run.results.map((r) => (
            <tr key={r.id}>
              <td className="py-2 pr-3">
                <p className="font-medium">{r.level}</p>
                <p className="text-xs text-slate-500">
                  {r.materialName} · lot {r.lotNumber}
                </p>
              </td>
              <td className="py-2 pr-3 text-right font-semibold tabular-nums">{fmt(r.value, run.parameter.decimals)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                {fmt(r.mean)} ± {fmt(r.sd)}
              </td>
              <td className={cn('py-2 pr-3 text-right tabular-nums', Math.abs(r.z) > 2 && 'font-semibold')}>{fmtZ(r.z)}</td>
              <td className="py-2 pr-3">
                <RulesList rules={r.rules} />
              </td>
              <td className="py-2 text-right">
                <Link to={`/qualite/ciq/levey-jennings/${r.targetId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                  <LineChart className="size-3.5" aria-hidden /> Levey-Jennings
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {run.comment && <p className="text-sm text-slate-600">Commentaire : {run.comment}</p>}

      {run.qualityIssue && (
        <p className="flex items-center gap-2 text-sm">
          Fiche de non-conformité
          <Link to={`/qualite/non-conformites?fiche=${run.qualityIssue.id}`} className="inline-flex items-center gap-1 font-mono font-semibold text-brand-700 hover:underline">
            {run.qualityIssue.number} <ExternalLink className="size-3.5" aria-hidden />
          </Link>
          <QualityIssueStatusBadge status={run.qualityIssue.status} />
        </p>
      )}

      {run.status === 'REJECTED' && (
        <div className="rounded-md border border-slate-200 p-3">
          <h3 className="mb-1 text-sm font-semibold text-slate-800">Résultats patients à réévaluer ({run.impactedResults.length})</h3>
          <p className="mb-2 text-xs text-slate-500">
            Saisis depuis le dernier CIQ acceptable{run.lastAcceptedAt ? ` (${formatDateTime(run.lastAcceptedAt)})` : ' (24 h précédentes, aucun CIQ acceptable antérieur)'} jusqu’à la série acceptée suivante.
          </p>
          {run.impactedResults.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun résultat patient concerné.</p>
          ) : (
            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto text-sm">
              {run.impactedResults.map((r, i) => (
                <li key={`${r.orderId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <Link to={`/resultats/${r.orderId}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                    {r.orderNumber}
                  </Link>
                  <span className="flex-1">{r.patientName}</span>
                  <span className="tabular-nums">{r.value || '—'}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(r.enteredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {run.resolvedAt && (
        <Alert tone="success" title={`Action corrective — ${run.resolvedBy ?? '—'}, ${formatDateTime(run.resolvedAt)}`}>
          {run.correctiveAction}
        </Alert>
      )}
      {needsAction && hasRole(...QC_CORRECTIVE_ROLES) && (
        <form
          className="space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setActionError(null);
            const parsed = qcCorrectiveActionSchema.safeParse({ correctiveAction: action });
            if (!parsed.success) {
              setActionError(parsed.error.issues[0]?.message ?? 'Action invalide.');
              return;
            }
            try {
              await corrective.mutateAsync({ id: run.id, correctiveAction: parsed.data.correctiveAction });
              setAction('');
            } catch (err) {
              setActionError(errorMessage(err));
            }
          }}
        >
          <TextAreaField
            label="Action corrective"
            required
            placeholder="Cause identifiée et action réalisée (recalibration, nouveau réactif, maintenance…)"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            error={actionError ?? undefined}
          />
          <Button type="submit" icon={ClipboardCheck} loading={corrective.isPending}>
            Enregistrer l’action corrective
          </Button>
          <p className="text-xs text-slate-600">Repassez ensuite une série : la validation est débloquée dès qu’une série est acceptée.</p>
        </form>
      )}
      {needsAction && !hasRole(...QC_CORRECTIVE_ROLES) && <Alert tone="warning">Action corrective attendue (technicien, biologiste ou responsable qualité).</Alert>}

      {!run.excludedAt && hasRole(...QC_EXCLUDE_ROLES) && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => setExcludeOpen(true)}>
            Exclure des statistiques
          </Button>
        </div>
      )}
      <ReasonModal
        open={excludeOpen}
        title="Exclure la série des statistiques"
        description="Réservé aux séries invalides (erreur de saisie, mauvais flacon ou lot). La série reste visible, marquée exclue, mais ne compte plus dans les statistiques ni dans l’évaluation des séries suivantes. Le motif est tracé."
        confirmLabel="Exclure"
        danger
        onClose={() => setExcludeOpen(false)}
        onConfirm={async (reason) => {
          await exclude.mutateAsync({ id: run.id, reason });
        }}
      />
    </div>
  );
}

export function QcEntryButton({ onClick, label = 'Saisir une série' }: { onClick: () => void; label?: string }) {
  return (
    <Button size="sm" icon={FlaskConical} onClick={onClick}>
      {label}
    </Button>
  );
}
