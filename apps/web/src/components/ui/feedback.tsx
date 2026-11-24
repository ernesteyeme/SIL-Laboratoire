import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, { box: string; icon: LucideIcon }> = {
  info: { box: 'bg-sky-50 text-sky-900 border-sky-200', icon: Info },
  success: { box: 'bg-emerald-50 text-emerald-900 border-emerald-200', icon: CheckCircle2 },
  warning: { box: 'bg-amber-50 text-amber-900 border-amber-200', icon: TriangleAlert },
  error: { box: 'bg-red-50 text-red-900 border-red-200', icon: AlertCircle },
};

export function Alert({ tone = 'info', title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-md border p-3 text-sm', box, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="break-words">{children}</div>}
      </div>
    </div>
  );
}

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-100',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE_TONES[tone])}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-brand-700', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Icon className="size-8 text-slate-300" aria-hidden />
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}
