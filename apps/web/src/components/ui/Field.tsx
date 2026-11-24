import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const CONTROL =
  'block w-full rounded-md border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-xs ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 disabled:bg-slate-100 disabled:text-slate-500';

const controlClass = (error?: string) =>
  cn(CONTROL, error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : 'border-slate-300');

interface FieldShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FieldShell({ id, label, error, hint, required, children, className }: FieldShellProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label: string; error?: string; hint?: ReactNode; containerClassName?: string };

export const TextField = forwardRef<HTMLInputElement, Common & InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { label, error, hint, containerClassName, className, id, required, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={cn(controlClass(error), 'h-10', className)}
        {...rest}
      />
    </FieldShell>
  );
});

export const SelectField = forwardRef<HTMLSelectElement, Common & SelectHTMLAttributes<HTMLSelectElement>>(function SelectField(
  { label, error, hint, containerClassName, className, id, required, children, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <select ref={ref} id={fieldId} aria-invalid={!!error} className={cn(controlClass(error), 'h-10', className)} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<HTMLTextAreaElement, Common & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextAreaField({ label, error, hint, containerClassName, className, id, required, ...rest }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    return (
      <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} className={containerClassName}>
        <textarea
          ref={ref}
          id={fieldId}
          aria-invalid={!!error}
          className={cn(controlClass(error), 'min-h-24 py-2', className)}
          {...rest}
        />
      </FieldShell>
    );
  },
);
