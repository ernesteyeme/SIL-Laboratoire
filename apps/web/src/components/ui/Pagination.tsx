import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

interface Props {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, total, onChange }: Props) {
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>
        {total} résultat{total > 1 ? 's' : ''} · page {page} / {totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Précédent
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Suivant
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
