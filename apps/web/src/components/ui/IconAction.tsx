import type { LucideIcon } from 'lucide-react';

/** Bouton d'action compact (icône seule, libellé accessible et infobulle). */
export function IconAction({
  label,
  icon: Icon,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-red-500 hover:bg-red-50' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
      }`}
    >
      <Icon className="size-4" />
    </button>
  );
}
