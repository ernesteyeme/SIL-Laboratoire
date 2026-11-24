import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { PAYMENT_METHOD_LABELS } from '@lims/shared';
import { cashSessionReportQuery } from '@/features/billing';
import { settingsQuery } from '@/features/settings';
import { formatDateTime, formatMoney } from '@/lib/utils';
import { PrintShell } from './PrintShell';

/** Rapport de session de caisse (A4) : totaux par moyen, contrôle des espèces, détail des paiements, signatures. */
export function CashSessionPrintPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useQuery(cashSessionReportQuery(id));
  const settings = useQuery(settingsQuery);
  const cur = data?.baseCurrency ?? settings.data?.currency;
  const second = data?.secondaryCurrency ?? null;

  return (
    <PrintShell pageCss="size: A4; margin: 15mm;" ready={!isLoading && !!data && !!settings.data} error={error} title={`Rapport de caisse ${data?.number ?? ''}`}>
      {data && (
        <div className="mx-auto max-w-[180mm] bg-white p-8 text-sm text-black shadow print:p-0 print:shadow-none">
          <div className="mb-6 flex justify-between border-b border-black pb-3">
            <div>
              <p className="text-lg font-bold">{settings.data?.name}</p>
              <p>Rapport de session de caisse</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-base font-bold">{data.number}</p>
              <p>{data.status === 'OPEN' ? 'SESSION OUVERTE (rapport provisoire)' : 'Session clôturée'}</p>
            </div>
          </div>

          <table className="mb-6 w-full">
            <tbody>
              <Row label="Caissier" value={data.cashier.fullName} />
              <Row label="Ouverture" value={formatDateTime(data.openedAt)} />
              <Row label="Clôture" value={data.closedAt ? formatDateTime(data.closedAt) : '—'} />
            </tbody>
          </table>

          <h2 className="mb-2 font-bold">Encaissements par moyen de paiement</h2>
          <table className="mb-6 w-full border-collapse">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1">Moyen</th>
                <th className="py-1">Devise</th>
                <th className="py-1 text-right">Nombre</th>
                <th className="py-1 text-right">Montant remis</th>
                <th className="py-1 text-right">Imputé ({cur})</th>
              </tr>
            </thead>
            <tbody>
              {data.totals.map((t) => (
                <tr key={`${t.method}-${t.currency}`} className="border-b border-slate-300">
                  <td className="py-1">{PAYMENT_METHOD_LABELS[t.method]}</td>
                  <td className="py-1">{t.currency}</td>
                  <td className="py-1 text-right">{t.count}</td>
                  <td className="py-1 text-right">{formatMoney(t.tendered, t.currency)}</td>
                  <td className="py-1 text-right">{formatMoney(t.applied, cur)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-1" colSpan={2}>Total encaissé</td>
                <td className="py-1 text-right">{data.paymentCount}</td>
                <td />
                <td className="py-1 text-right">{formatMoney(data.totalCollected, cur)}</td>
              </tr>
            </tbody>
          </table>

          <h2 className="mb-2 font-bold">Contrôle des espèces</h2>
          <table className="mb-6 w-full">
            <tbody>
              <Row label={`Fond de caisse ${cur}`} value={formatMoney(data.openingFloat, cur)} />
              {data.totalChange !== '0.00' && <Row label={`Monnaie rendue (${cur})`} value={`− ${formatMoney(data.totalChange, cur)}`} />}
              <Row label={`Espèces attendues ${cur} (fond + espèces ${cur} − monnaie rendue)`} value={formatMoney(data.expectedCash, cur)} />
              <Row label={`Espèces comptées ${cur}`} value={data.countedCash ? formatMoney(data.countedCash, cur) : '—'} />
              <Row label={`Écart ${cur}`} value={data.difference ? formatMoney(data.difference, cur) : '—'} bold />
              {second && (
                <>
                  <Row label={`Fond de caisse ${second}`} value={formatMoney(data.openingFloatSecondary, second)} />
                  <Row label={`Espèces attendues ${second} (fond + espèces ${second})`} value={formatMoney(data.expectedCashSecondary ?? '0', second)} />
                  <Row label={`Espèces comptées ${second}`} value={data.countedCashSecondary ? formatMoney(data.countedCashSecondary, second) : '—'} />
                  <Row label={`Écart ${second}`} value={data.differenceSecondary ? formatMoney(data.differenceSecondary, second) : '—'} bold />
                </>
              )}
              {data.closingNote && <Row label="Justification" value={data.closingNote} />}
              <Row label="Paiements annulés" value={String(data.cancelledCount)} />
            </tbody>
          </table>

          <h2 className="mb-2 font-bold">Détail des paiements</h2>
          <table className="mb-10 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1">Reçu</th>
                <th className="py-1">Heure</th>
                <th className="py-1">Facture</th>
                <th className="py-1">Patient</th>
                <th className="py-1">Moyen</th>
                <th className="py-1 text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className={`border-b border-slate-300 ${p.cancelledAt ? 'line-through' : ''}`}>
                  <td className="py-1 pr-2 font-mono whitespace-nowrap">{p.number}</td>
                  <td className="py-1 pr-2">{formatDateTime(p.receivedAt)}</td>
                  <td className="py-1 pr-2 font-mono whitespace-nowrap">{p.invoiceNumber}</td>
                  <td className="py-1 pr-2">{p.patientName}</td>
                  <td className="py-1 pr-3">
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.reference && ` (${p.reference})`}
                    {p.cancelledAt && ` — annulé : ${p.cancellationReason}`}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    {formatMoney(p.amount, cur)}
                    {p.currency !== cur && <span className="block">({formatMoney(p.tenderedAmount, p.currency)} × {Number(p.exchangeRate).toLocaleString('fr-FR')})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-10 pt-6">
            <div className="border-t border-black pt-1 text-center">Signature du caissier</div>
            <div className="border-t border-black pt-1 text-center">Signature du responsable</div>
          </div>
          <p className="mt-6 text-right text-xs">Édité le {formatDateTime(new Date().toISOString())}</p>
        </div>
      )}
    </PrintShell>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr className={bold ? 'font-bold' : ''}>
      <td className="py-0.5 pr-4">{label}</td>
      <td className="py-0.5 text-right">{value}</td>
    </tr>
  );
}
