import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { computeAge } from '@lims/shared';
import { Barcode } from '@/components/Barcode';
import { orderQuery } from '@/features/orders';
import { PrintShell } from './PrintShell';

const SEX_SHORT = { MALE: 'M', FEMALE: 'F', UNKNOWN: '?' } as const;

/**
 * Étiquettes d'échantillons pour imprimante thermique en rouleau (50 × 30 mm, une étiquette par page).
 * Contenu conforme à l'identification primaire ISO 15189 §7.2.4 : patient (nom, code, sexe, âge), n° d'échantillon en code-barres,
 * nature de l'échantillon, examens, date.
 */
export function LabelsPrintPage() {
  const { orderId = '' } = useParams();
  const [params] = useSearchParams();
  const only = params.get('echantillon');
  const { data: order, isLoading, error } = useQuery(orderQuery(orderId));

  const samples = (order?.samples ?? []).filter((s) => s.status !== 'REJECTED' && s.examCodes.length > 0 && (!only || s.id === only));
  const p = order?.patient;
  const age = p?.birthDate ? computeAge(p.birthDate).label : '';
  const date = order ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(new Date(order.createdAt)) : '';

  return (
    <PrintShell pageCss="size: 50mm 30mm; margin: 0;" ready={!isLoading && !!order} error={error} title={`Étiquettes ${order?.number ?? ''}`}>
      <div className="flex flex-wrap gap-4 print:block">
        {samples.map((s) => (
          <div
            key={s.id}
            className="flex flex-col justify-between overflow-hidden bg-white text-black shadow print:shadow-none"
            style={{ width: '50mm', height: '30mm', padding: '1.5mm 2mm', breakAfter: 'page', fontFamily: 'Arial, sans-serif' }}
          >
            <div style={{ fontSize: '7.5pt', lineHeight: 1.15 }}>
              <div className="truncate font-bold" style={{ fontSize: '8pt' }}>
                {p?.fullName}
              </div>
              <div className="flex justify-between">
                <span>{p?.code}</span>
                <span>
                  {p ? SEX_SHORT[p.sex] : ''} {age}
                </span>
              </div>
            </div>
            <div className="flex justify-center" style={{ height: '11mm' }}>
              {/* Module de 0,375 mm (≈ 1,417 px CSS) = 3 points d'une tête thermique 203 dpi : barres nettes et lisibles. */}
              <Barcode value={s.number} height={40} width={1.417} showText={false} className="h-full" />
            </div>
            <div style={{ fontSize: '7pt', lineHeight: 1.15 }}>
              <div className="flex justify-between font-mono font-bold" style={{ fontSize: '8pt' }}>
                <span>{s.number}</span>
                <span>{order?.priority === 'URGENT' ? 'URGENT' : date}</span>
              </div>
              <div className="truncate">
                {s.sampleType.code} · {s.examCodes.join(' ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </PrintShell>
  );
}
