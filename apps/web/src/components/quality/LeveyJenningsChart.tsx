import { useEffect, useMemo, useRef, useState } from 'react';
import { QC_STATUS_LABELS, type LeveyJenningsDto } from '@lims/shared';
import { formatDateTime } from '@/lib/utils';

/** Couleurs : une seule série (marque) ; statuts réservés, toujours doublés d'une forme et d'un libellé. */
const C = {
  series: '#0f766e',
  grid: '#e2e8f0',
  sd1: '#e2e8f0',
  sd2: '#cbd5e1',
  sd3: '#94a3b8',
  mean: '#64748b',
  band: 'rgba(15,118,110,0.06)',
  warning: '#fab219',
  critical: '#d03b3b',
  excluded: '#94a3b8',
  surface: '#ffffff',
  text: '#334155',
  muted: '#64748b',
};

const HEIGHT = 340;
const M = { top: 16, right: 64, bottom: 40, left: 56 };

const nf = (v: number, dp = 3) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: dp }).format(v);
const shortDate = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(new Date(iso));

type Point = LeveyJenningsDto['points'][number];

/** Marqueur selon le statut : cercle (accepté), triangle (avertissement), losange (rejet), cercle creux (exclu). */
function Marker({ p, x, y, active }: { p: Point; x: number; y: number; active: boolean }) {
  const r = active ? 6 : 4.5;
  if (p.excluded) return <circle cx={x} cy={y} r={r} fill={C.surface} stroke={C.excluded} strokeWidth={2} />;
  if (p.status === 'REJECTED') {
    const s = r + 1.5;
    return <path d={`M${x} ${y - s} L${x + s} ${y} L${x} ${y + s} L${x - s} ${y} Z`} fill={C.critical} stroke={C.surface} strokeWidth={2} />;
  }
  if (p.status === 'WARNING') {
    const s = r + 1.5;
    return <path d={`M${x} ${y - s} L${x + s} ${y + s * 0.8} L${x - s} ${y + s * 0.8} Z`} fill={C.warning} stroke={C.surface} strokeWidth={2} strokeLinejoin="round" />;
  }
  return <circle cx={x} cy={y} r={r} fill={C.series} stroke={C.surface} strokeWidth={2} />;
}

export function LeveyJenningsLegend() {
  const item = (svg: React.ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        {svg}
      </svg>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-600">
      {item(<circle cx="8" cy="8" r="4.5" fill={C.series} />, QC_STATUS_LABELS.ACCEPTED)}
      {item(<path d="M8 2 L14 12.8 L2 12.8 Z" fill={C.warning} />, `${QC_STATUS_LABELS.WARNING} (1-2s)`)}
      {item(<path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z" fill={C.critical} />, QC_STATUS_LABELS.REJECTED)}
      {item(<circle cx="8" cy="8" r="4.5" fill="white" stroke={C.excluded} strokeWidth="2" />, 'Exclue des statistiques')}
    </div>
  );
}

export function LeveyJenningsChart({ data, unit }: { data: LeveyJenningsDto; unit: string | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { mean, sd } = data.target;
  const pts = data.points;
  const geo = useMemo(() => {
    const maxDev = Math.max(3.5, ...pts.map((p) => Math.abs(p.z) + 0.4));
    const lo = mean - maxDev * sd;
    const hi = mean + maxDev * sd;
    const innerW = width - M.left - M.right;
    const innerH = HEIGHT - M.top - M.bottom;
    const n = Math.max(pts.length, 2);
    const x = (i: number) => M.left + (pts.length === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = (v: number) => M.top + ((hi - v) / (hi - lo)) * innerH;
    return { x, y, innerW, innerH };
  }, [pts, mean, sd, width]);

  const lines = [3, 2, 1, 0, -1, -2, -3].map((k) => ({
    k,
    v: mean + k * sd,
    color: k === 0 ? C.mean : Math.abs(k) === 3 ? C.sd3 : Math.abs(k) === 2 ? C.sd2 : C.sd1,
    label: k === 0 ? 'x̄' : `${k > 0 ? '+' : '−'}${Math.abs(k)} ET`,
  }));
  const retained = pts.map((p, i) => ({ p, i })).filter(({ p }) => !p.excluded);
  const path = retained.map(({ p, i }, j) => `${j === 0 ? 'M' : 'L'}${geo.x(i).toFixed(1)} ${geo.y(p.value).toFixed(1)}`).join(' ');
  const tickEvery = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(geo.innerW / 70))));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (pts.length === 0) return;
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left + M.left;
    let best = 0;
    let bestD = Infinity;
    pts.forEach((_, i) => {
      const d = Math.abs(geo.x(i) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover !== null ? pts[hover] : null;

  return (
    <div ref={wrap} className="relative w-full">
      <svg width={width} height={HEIGHT} role="img" aria-label={`Graphique de Levey-Jennings, ${pts.length} contrôles, cible ${nf(mean)} ± ${nf(sd)}`}>
        <rect x={M.left} y={geo.y(mean + 2 * sd)} width={geo.innerW} height={geo.y(mean - 2 * sd) - geo.y(mean + 2 * sd)} fill={C.band} />
        {lines.map((l) => (
          <g key={l.k}>
            <line x1={M.left} x2={M.left + geo.innerW} y1={geo.y(l.v)} y2={geo.y(l.v)} stroke={l.color} strokeWidth={l.k === 0 ? 1.5 : 1} />
            <text x={M.left - 8} y={geo.y(l.v)} dy="0.32em" textAnchor="end" fontSize="11" fill={l.k === 0 ? C.text : C.muted}>
              {l.label}
            </text>
            <text x={M.left + geo.innerW + 8} y={geo.y(l.v)} dy="0.32em" fontSize="11" fill={C.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {nf(l.v)}
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          i % tickEvery === 0 || i === pts.length - 1 ? (
            <text key={p.runId} x={geo.x(i)} y={HEIGHT - M.bottom + 18} textAnchor="middle" fontSize="11" fill={C.muted}>
              {shortDate(p.performedAt)}
            </text>
          ) : null,
        )}
        <line x1={M.left} x2={M.left + geo.innerW} y1={HEIGHT - M.bottom} y2={HEIGHT - M.bottom} stroke={C.grid} />
        {hp && <line x1={geo.x(hover!)} x2={geo.x(hover!)} y1={M.top} y2={HEIGHT - M.bottom} stroke={C.sd2} strokeWidth={1} />}
        <path d={path} fill="none" stroke={C.series} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <Marker key={p.runId} p={p} x={geo.x(i)} y={geo.y(p.value)} active={hover === i} />
        ))}
        <rect x={M.left - 10} y={M.top} width={geo.innerW + 20} height={geo.innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: geo.x(hover!) > width / 2 ? Math.max(0, geo.x(hover!) - 236) : geo.x(hover!) + 12, top: Math.max(0, geo.y(hp.value) - 70) }}
        >
          <p className="font-semibold text-slate-900">{formatDateTime(hp.performedAt)}</p>
          <p className="tabular-nums text-slate-700">
            {nf(hp.value, 4)}
            {unit ? ` ${unit}` : ''} · z {hp.z > 0 ? '+' : ''}
            {nf(hp.z, 2)}
          </p>
          <p className="text-slate-600">
            {hp.excluded ? 'Exclue des statistiques' : QC_STATUS_LABELS[hp.status]}
            {hp.rules.length > 0 && ` · ${hp.rules.join(', ')}`}
          </p>
        </div>
      )}
    </div>
  );
}
