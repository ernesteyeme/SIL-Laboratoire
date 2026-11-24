import { ROLE_LABELS, ROLES, type Role } from '@lims/shared';
import { cn } from '@/lib/utils';

const ROLE_HELP: Record<Role, string> = {
  ADMIN: 'Comptes, paramétrage, catalogue',
  RECEPTION: 'Patients, demandes, prélèvements',
  CAISSE: 'Facturation et encaissements',
  TECHNICIEN: 'Saisie des résultats, validation technique, CIQ',
  BIOLOGISTE: 'Validation biologique, corrections',
  QUALITE: 'Non-conformités, documents, audit',
  COMPTABLE: 'États financiers',
};

interface Props {
  value: Role[];
  onChange: (roles: Role[]) => void;
  error?: string;
  disabledRoles?: Role[];
}

export function RoleCheckboxes({ value, onChange, error, disabledRoles = [] }: Props) {
  const toggle = (role: Role) =>
    onChange(value.includes(role) ? value.filter((r) => r !== role) : ROLES.filter((r) => r === role || value.includes(r)));

  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium text-slate-700">
        Rôles<span className="ml-0.5 text-red-600" aria-hidden>*</span>
      </legend>
      <div className={cn('grid gap-2 sm:grid-cols-2', error && 'rounded-md ring-1 ring-red-300 p-1')}>
        {ROLES.map((role) => {
          const checked = value.includes(role);
          const disabled = disabledRoles.includes(role);
          return (
            <label
              key={role}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm',
                checked ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-brand-700"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(role)}
              />
              <span>
                <span className="block font-medium text-slate-800">{ROLE_LABELS[role]}</span>
                <span className="block text-xs text-slate-500">{ROLE_HELP[role]}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
