import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, LineChart, Table2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QC_STATUS_LABELS, QC_TARGET_SOURCE_LABELS } from '@lims/shared';
import { LeveyJenningsChart, LeveyJenningsLegend } from '@/components/quality/LeveyJenningsChart';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Alert, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { Card } from '@/components/ui/PageHeader';
import { leveyJenningsQuery } from '@/features/quality';
import { cn, errorMessage, formatDateTime } from '@/lib/utils';
import { NotFoundPage } from '../NotFoundPage';
import { fmt, fmtZ, RulesList } from './QcRunModals';

export function LeveyJenningsPage() {
  const { targetId = '' } = useParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [table, setTable] = useState(false);
  const { data, isLoading, isError, error, isFetching } = useQuery(leveyJenningsQuery(targetId, from || undefined, to || undefined));

  if (isLoading) return <LoadingBlock />;
  if (isError) return (error as { status?: number })?.status === 404 ? <NotFoundPage /> : <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!data) return null;
  const { target, observed, points } = data;
  const unit = target.parameter.unit;
  const biasPercent = observed.mean !== null && target.mean !== 0 ? ((observed.mean - target.mean) / target.mean) * 100 : null;

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/qualite/ciq" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="size-4" /> Contrôle qualité
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <LineChart className="size-5 text-brand-700" aria-hidden /> {target.parameter.name} — {target.level}
          </h1>
          <p className="text-sm text-slate-500">
            {target.materialName} · lot <span className="font-mono">{target.lotNumber}</span> · cible {fmt(target.mean)} ± {fmt(target.sd)}
            {unit ? ` ${unit}` : ''} ({QC_TARGET_SOURCE_LABELS[target.source].toLowerCase()})
          </p>
        </div>
        <div className="flex items-end gap-2">
          <TextField label="Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} containerClassName="w-40" />
          <TextField label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} containerClassName="w-40" />
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Tile label="Contrôles retenus" value={String(observed.n)} hint={`${points.length} sur la période (rejetés et exclus non comptés)`} />
        <Tile label="Moyenne observée" value={observed.mean === null ? '—' : fmt(observed.mean, 3)} hint={biasPercent === null ? `cible ${fmt(target.mean)}` : `biais ${biasPercent > 0 ? '+' : ''}${fmt(biasPercent, 1)} % / cible`} />
        <Tile label="Écart-type observé" value={observed.sd === null ? '—' : fmt(observed.sd, 3)} hint={`cible ${fmt(target.sd)}`} />
        <Tile label="CV observé" value={observed.cv === null ? '—' : `${fmt(observed.cv, 1)} %`} hint={target.cvPercent === null ? undefined : `cible ${fmt(target.cvPercent, 1)} %`} />
      </div>

      <Card className={cn('p-4', isFetching && 'opacity-70')}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <LeveyJenningsLegend />
          <Button size="sm" variant="ghost" icon={Table2} onClick={() => setTable((t) => !t)}>
            {table ? 'Masquer le tableau' : 'Afficher le tableau'}
          </Button>
        </div>
        {points.length === 0 ? (
          <EmptyState icon={LineChart} title="Aucun contrôle sur la période" />
        ) : (
          <LeveyJenningsChart data={data} unit={unit} />
        )}
        {table && points.length > 0 && (
          <div className="mt-4 max-h-80 overflow-y-auto border-t border-slate-200">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Valeurs du graphique de Levey-Jennings</caption>
              <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3 text-right">Valeur</th>
                  <th className="py-2 pr-3 text-right">z</th>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2">Règles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...points].reverse().map((p) => (
                  <tr key={p.runId} className={cn(p.excluded && 'text-slate-400')}>
                    <td className="py-1.5 pr-3">
                      <Link to={`/qualite/ciq?serie=${p.runId}`} className="hover:underline">
                        {formatDateTime(p.performedAt)}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(p.value, target.parameter.decimals)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtZ(p.z)}</td>
                    <td className="py-1.5 pr-3">{p.excluded ? 'Exclue' : QC_STATUS_LABELS[p.status]}</td>
                    <td className="py-1.5">
                      <RulesList rules={p.rules} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Les lignes horizontales marquent la moyenne cible (x̄) et ±1, ±2, ±3 écarts-types ; la zone teintée correspond à ±2 ET. Survolez un point pour son détail.
      </p>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}
