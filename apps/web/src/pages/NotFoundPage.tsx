import { SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <SearchX className="size-12 text-slate-300" aria-hidden />
      <h1 className="text-lg font-semibold text-slate-900">Page introuvable</h1>
      <p className="text-sm text-slate-500">L’adresse demandée n’existe pas ou a été déplacée.</p>
      <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
        Retour au tableau de bord
      </Link>
    </div>
  );
}
