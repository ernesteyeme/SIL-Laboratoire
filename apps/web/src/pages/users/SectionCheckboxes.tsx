import { useQuery } from '@tanstack/react-query';
import { sectionsQuery } from '@/features/catalog';
import { cn } from '@/lib/utils';

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}

/**
 * Habilitations par service (ISO 15189 §6.2) : services où le technicien ou le biologiste peut saisir
 * et valider. Les services désactivés ne sont proposés que s'ils sont déjà attribués (pour pouvoir les retirer).
 */
export function SectionCheckboxes({ value, onChange, error }: Props) {
  const { data, isLoading } = useQuery(sectionsQuery);
  const sections = (data ?? []).filter((s) => s.isActive || value.includes(s.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium text-slate-700">
        Services habilités<span className="ml-0.5 text-red-600" aria-hidden>*</span>
      </legend>
      <p className="text-xs text-slate-500">
        Le technicien ou le biologiste ne saisit et ne valide que les examens de ces services (paillasses, CIQ, automates).
      </p>
      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement des services…</p>
      ) : (
        <div className={cn('grid gap-2 sm:grid-cols-3', error && 'rounded-md p-1 ring-1 ring-red-300')}>
          {sections.map((s) => {
            const checked = value.includes(s.id);
            return (
              <label
                key={s.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm',
                  checked ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                <input type="checkbox" className="accent-brand-700" checked={checked} onChange={() => toggle(s.id)} />
                <span className="font-medium text-slate-800">{s.name}</span>
                {!s.isActive && <span className="text-xs text-slate-500">(désactivé)</span>}
              </label>
            );
          })}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
