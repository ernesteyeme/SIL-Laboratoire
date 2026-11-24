import { Printer, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, LoadingBlock } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/utils';

interface Props {
  /** Règle @page (format du support d'impression) */
  pageCss: string;
  ready: boolean;
  error?: unknown;
  title: string;
  children: ReactNode;
}

/**
 * Cadre commun des pages d'impression (ouvertes dans un nouvel onglet) :
 * barre d'outils masquée à l'impression, lancement automatique de l'impression quand le contenu est prêt.
 */
export function PrintShell({ pageCss, ready, error, title, children }: Props) {
  const printed = useRef(false);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (ready && !printed.current) {
      printed.current = true;
      // Laisse le temps aux codes-barres SVG d'être dessinés.
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [ready]);

  return (
    <div className="min-h-full bg-slate-200 print:bg-white">
      <style>{`@page { ${pageCss} } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-300 bg-white px-4 py-2">
        <p className="text-sm font-medium text-slate-700">{title}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white">
            <Printer className="size-4" /> Imprimer
          </button>
          <button type="button" onClick={() => window.close()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            <X className="size-4" /> Fermer
          </button>
        </div>
      </div>
      <div className="p-6 print:p-0">
        {error ? <Alert tone="error">{errorMessage(error)}</Alert> : ready ? children : <LoadingBlock label="Préparation de l’impression…" />}
      </div>
    </div>
  );
}
