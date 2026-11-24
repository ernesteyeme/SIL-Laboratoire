import { Spinner } from './feedback';

export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-3 text-sm text-slate-500" role="status">
      <Spinner className="size-6" /> {label}
    </div>
  );
}
