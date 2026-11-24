import { ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROLE_LABELS, type Role } from '@lims/shared';

export function ForbiddenPage({ requiredRoles }: { requiredRoles?: Role[] }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <ShieldX className="size-12 text-red-400" aria-hidden />
      <h1 className="text-lg font-semibold text-slate-900">Accès refusé</h1>
      <p className="text-sm text-slate-500">
        Vous ne disposez pas des droits nécessaires pour cette page.
        {requiredRoles && requiredRoles.length > 0 && (
          <> Rôle requis : {requiredRoles.map((r) => ROLE_LABELS[r]).join(' ou ')}.</>
        )}
      </p>
      <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
        Retour au tableau de bord
      </Link>
    </div>
  );
}
