import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  NON_CONFORMITY_TYPE_LABELS,
  QUALITY_ISSUE_CATEGORY_LABELS,
  QUALITY_ISSUE_SEVERITY_LABELS,
  type IndicatorsDto,
  type TatRowDto,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, LoadingBlock } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { sectionsQuery } from '@/features/catalog';
import { indicatorsQuery } from '@/features/quality';
import { cn, errorMessage, formatDate } from '@/lib/utils';

const BAR = '#0f766e';
const TRACK = '#f1f5f9';

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => isoLocal(new Date(Date.now() - n * 86_400_000));
const nf = (v: number | null, dp = 1) => (v === null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: dp }).format(v));
const pct = (v: number | null) => (v === null ? '—' : `${nf(v)} %`);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const hours = (v: number | null) => (v === null ? '—' : v < 1 ? `${nf(v * 60, 0)} min` : `${nf(v)} h`);

type Preset = '7' | '30' | '90' | 'month' | 'custom';

export function IndicatorsPage() {
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState({ from: daysAgo(30), to: isoLocal(new Date()) });
  const [sectionId, setSectionId] = useState('');
  const sections = useQuery(sectionsQuery);

  const period = useMemo(() => {
    const today = isoLocal(new Date());
    if (preset === 'custom') return custom;
    if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
    return { from: daysAgo(Number(preset) - 1), to: today };
  }, [preset, custom]);
  const valid = period.from <= period.to;
  const { data, isLoading, isError, error, isFetching } = useQuery({ ...indicatorsQuery(period.from, period.to, sectionId || undefined), enabled: valid });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Indicateurs qualité" description="Indicateurs pré-, per- et post-analytiques (ISO 15189 §8.8) sur la période choisie." />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5" role="group" aria-label="Période">
          {(
            [
              ['7', '7 jours'],
              ['30', '30 jours'],
              ['90', '90 jours'],
              ['month', 'Mois en cours'],
              ['custom', 'Personnalisée'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={preset === id}
              onClick={() => setPreset(id)}
              className={cn('rounded px-3 py-1.5 text-sm font-medium', preset === id ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
            >
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <>
            <TextField label="Du" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} containerClassName="w-40" />
            <TextField label="Au" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} containerClassName="w-40" />
          </>
        )}
        <SelectField label="Section (délais et CIQ)" value={sectionId} onChange={(e) => setSectionId(e.target.value)} containerClassName="w-56">
          <option value="">Toutes les sections</option>
          {(sections.data ?? []).filter((s) => s.isActive).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </div>

      {!valid ? (
        <Alert tone="error">La date de début doit précéder la date de fin.</Alert>
      ) : isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <Alert tone="error">{errorMessage(error)}</Alert>
      ) : data ? (
        <div className={cn('space-y-6', isFetching && 'opacity-70')}>
          <Dashboard d={data} />
        </div>
      ) : null}
    </div>
  );
}

function Dashboard({ d }: { d: IndicatorsDto }) {
  const tatAlert = d.tat.overall.withinTargetPercent !== null && d.tat.overall.withinTargetPercent < 90;
  return (
    <>
      <p className="text-sm text-slate-500">
        Du {formatDate(d.period.from)} au {formatDate(d.period.to)}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Examens rendus dans le délai" value={pct(d.tat.overall.withinTargetPercent)} hint={`${plural(d.tat.overall.count, 'examen validé', 'examens validés')} · médiane ${hours(d.tat.overall.medianHours)}`} warn={tatAlert ? 'Sous 90 %' : undefined} />
        <Tile label="Examens en retard (maintenant)" value={String(d.tat.overdueNow)} hint="Échéance dépassée, non validés" warn={d.tat.overdueNow > 0 ? 'À traiter' : undefined} />
        <Tile label="Taux de refus d’échantillons" value={pct(d.samples.rejectionRatePercent)} hint={`${plural(d.samples.rejected, 'refusé', 'refusés')} · ${plural(d.samples.received, 'reçu', 'reçus')} · ${plural(d.samples.derogations, 'dérogation', 'dérogations')}`} />
        <Tile
          label={`Valeurs critiques communiquées en ${d.critical.targetMinutes} min`}
          value={pct(d.critical.withinTargetPercent)}
          hint={`${plural(d.critical.count, 'alerte', 'alertes')} · médiane ${d.critical.medianMinutes === null ? '—' : `${nf(d.critical.medianMinutes, 0)} min`}`}
          warn={d.critical.count > d.critical.acknowledged ? `${d.critical.count - d.critical.acknowledged} non communiquée(s)` : undefined}
        />
        <Tile label="Taux de rejet du CIQ" value={pct(d.qc.rejectionRatePercent)} hint={`${plural(d.qc.runs, 'série', 'séries')} · ${plural(d.qc.warning, 'avertissement', 'avertissements')} · ${plural(d.qc.rejected, 'rejet', 'rejets')}`} />
        <Tile label="Comptes rendus rectificatifs" value={pct(d.reports.amendedRatePercent)} hint={`${plural(d.reports.amended, 'rectificatif', 'rectificatifs')} pour ${plural(d.reports.final, 'définitif', 'définitifs')}`} />
        <Tile label="Non-conformités déclarées" value={String(d.issues.declared)} hint={`${d.issues.openNow} ouvertes au total · clôture médiane ${d.issues.medianClosureDays === null ? '—' : `${nf(d.issues.medianClosureDays)} j`}`} />
        <Tile label="Actions correctives en retard" value={String(d.issues.overdueNow)} hint="Échéance dépassée, fiche non clôturée" warn={d.issues.overdueNow > 0 ? 'À relancer' : undefined} />
      </div>

      <TatTable rows={d.tat.byExam} pre={d.tat.preAnalyticalMedianHours} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Non-conformités pré-analytiques par motif</h2>
          <p className="mb-3 text-xs text-slate-500">Refus et dérogations enregistrés à la réception</p>
          <HBarList rows={d.samples.byType.map((t) => ({ label: NON_CONFORMITY_TYPE_LABELS[t.type], value: t.count }))} unit="non-conformité(s)" />
        </Card>
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Fiches de non-conformité par catégorie</h2>
          <p className="mb-3 text-xs text-slate-500">
            {d.issues.bySeverity.map((s) => `${QUALITY_ISSUE_SEVERITY_LABELS[s.severity]} : ${s.count}`).join(' · ') || 'Aucune fiche sur la période'}
          </p>
          <HBarList rows={d.issues.byCategory.map((c) => ({ label: QUALITY_ISSUE_CATEGORY_LABELS[c.category], value: c.count }))} unit="fiche(s)" />
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Contrôle qualité interne par paramètre</h2>
        <p className="mb-3 text-xs text-slate-500">Séries non exclues de la période</p>
        {d.qc.byParameter.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune série sur la période.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-3">Paramètre</th>
                <th className="py-2 pr-3 text-right">Séries</th>
                <th className="py-2 pr-3 text-right">Avertissements</th>
                <th className="py-2 pr-3 text-right">Rejets</th>
                <th className="py-2 text-right">Taux de rejet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {d.qc.byParameter.map((p) => (
                <tr key={p.parameterCode}>
                  <td className="py-1.5 pr-3">
                    {p.parameterName} <span className="font-mono text-xs text-slate-400">{p.parameterCode}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right">{p.runs}</td>
                  <td className="py-1.5 pr-3 text-right">{p.warning}</td>
                  <td className={cn('py-1.5 pr-3 text-right', p.rejected > 0 && 'font-semibold')}>{p.rejected}</td>
                  <td className="py-1.5 text-right">{pct(p.runs > 0 ? (100 * p.rejected) / p.runs : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Tile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {warn && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-800">
          <TriangleAlert className="size-3.5 text-amber-600" aria-hidden /> {warn}
        </p>
      )}
    </Card>
  );
}

/** Barres horizontales, une seule série : valeur au bout de la barre, détail au survol. */
function HBarList({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <p className="text-sm text-slate-500">Aucune donnée sur la période.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="space-y-2" role="list">
      {rows.map((r, i) => (
        <li key={r.label} className="relative grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-3 text-sm" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="truncate text-slate-700" title={r.label}>
            {r.label}
          </span>
          <span className="flex items-center gap-2">
            <svg className="h-4 flex-1" preserveAspectRatio="none" viewBox="0 0 100 16" aria-hidden>
              <path d={barPath((r.value / max) * 100)} fill={BAR} opacity={hover === null || hover === i ? 1 : 0.55} />
            </svg>
            <span className="w-8 text-right tabular-nums text-slate-900">{r.value}</span>
          </span>
          {hover === i && (
            <span className="pointer-events-none absolute right-10 -top-8 z-10 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow">
              {r.label} : {r.value} {unit} ({nf((100 * r.value) / total)} %)
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Barre de 16 px d'épaisseur partant de la ligne de base, extrémité arrondie (4 px). */
function barPath(w: number): string {
  if (w <= 0) return '';
  const r = Math.min(4, w);
  return `M0 0 H${w - r} Q${w} 0 ${w} ${r} V${16 - r} Q${w} 16 ${w - r} 16 H0 Z`;
}

function TatTable({ rows, pre }: { rows: TatRowDto[]; pre: number | null }) {
  const [hover, setHover] = useState<string | null>(null);
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.p90Hours ?? 0, r.targetHours)));

  const exportCsv = () => {
    const head = ['Examen', 'Libellé', 'Section', 'Délai cible (h)', 'Examens', 'Médiane (h)', 'P90 (h)', 'Dans le délai (%)'];
    const lines = rows.map((r) => [r.examCode, r.examName, r.sectionName, r.targetHours, r.count, r.medianHours ?? '', r.p90Hours ?? '', r.withinTargetPercent ?? '']);
    const csv = [head, ...lines].map((l) => l.map((v) => `"${(typeof v === 'number' ? String(v).replace('.', ',') : String(v)).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'delais-de-rendu.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Délais de rendu par examen (réception → validation biologique)</h2>
          <p className="text-xs text-slate-500">
            Barre : médiane · trait vertical : délai cible · délai prélèvement → réception (médiane) : {hours(pre)}
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={rows.length === 0}>
          Exporter (CSV)
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <BarChart3 className="size-4" aria-hidden /> Aucun examen validé sur la période.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-3">Examen</th>
                <th className="py-2 pr-3 text-right">Validés</th>
                <th className="py-2 pr-3" style={{ minWidth: 220 }}>
                  Médiane / cible
                </th>
                <th className="py-2 pr-3 text-right">Médiane</th>
                <th className="py-2 pr-3 text-right">P90</th>
                <th className="py-2 pr-3 text-right">Cible</th>
                <th className="py-2 text-right">Dans le délai</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {rows.map((r) => {
                const w = ((r.medianHours ?? 0) / scale) * 100;
                const target = (r.targetHours / scale) * 100;
                const late = r.withinTargetPercent !== null && r.withinTargetPercent < 90;
                return (
                  <tr key={r.examCode} onMouseEnter={() => setHover(r.examCode)} onMouseLeave={() => setHover(null)} className={cn(hover === r.examCode && 'bg-slate-50')}>
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-xs font-semibold">{r.examCode}</span> {r.examName}
                      <span className="block text-xs text-slate-400">{r.sectionName}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right">{r.count}</td>
                    <td className="py-1.5 pr-3">
                      <svg className="h-4 w-full" viewBox="0 0 100 16" preserveAspectRatio="none" role="img" aria-label={`Médiane ${hours(r.medianHours)} pour une cible de ${r.targetHours} h`}>
                        <rect x="0" y="0" width="100" height="16" fill={TRACK} />
                        <path d={barPath(w)} fill={BAR} />
                        <rect x={Math.min(99.4, target)} y="0" width="0.8" height="16" fill="#0f172a" />
                      </svg>
                    </td>
                    <td className="py-1.5 pr-3 text-right">{hours(r.medianHours)}</td>
                    <td className="py-1.5 pr-3 text-right">{hours(r.p90Hours)}</td>
                    <td className="py-1.5 pr-3 text-right">{r.targetHours} h</td>
                    <td className="py-1.5 text-right">
                      <span className={cn('inline-flex items-center gap-1', late && 'font-semibold text-amber-800')}>
                        {late && <TriangleAlert className="size-3.5 text-amber-600" aria-label="Sous 90 %" />}
                        {pct(r.withinTargetPercent)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
