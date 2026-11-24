import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { PAYMENT_METHOD_LABELS } from '@lims/shared';
import { receiptQuery } from '@/features/billing';
import { formatDateTime, formatMoney } from '@/lib/utils';
import { PrintShell } from './PrintShell';

/** Reçu de paiement au format ticket (imprimante 80 mm). */
export function ReceiptPrintPage() {
  const { paymentId = '' } = useParams();
  const { data, isLoading, error } = useQuery(receiptQuery(paymentId));
  const cur = data?.lab.currency;

  return (
    <PrintShell pageCss="size: 80mm auto; margin: 4mm;" ready={!isLoading && !!data} error={error} title={`Reçu ${data?.payment.number ?? ''}`}>
      {data && (
        <div className="mx-auto bg-white p-3 text-black shadow print:p-0 print:shadow-none" style={{ width: '72mm', fontFamily: 'Arial, sans-serif', fontSize: '9pt' }}>
          <div className="text-center">
            <p className="font-bold" style={{ fontSize: '11pt' }}>
              {data.lab.name}
            </p>
            {data.lab.address && <p>{data.lab.address}</p>}
            {(data.lab.city || data.lab.phone) && <p>{[data.lab.city, data.lab.phone].filter(Boolean).join(' · ')}</p>}
          </div>
          <hr className="my-2 border-dashed border-black" />
          <p className="text-center font-bold">REÇU N° {data.payment.number}</p>
          {data.payment.cancelledAt && <p className="text-center font-bold">*** ANNULÉ ***</p>}
          <p>Date : {formatDateTime(data.payment.receivedAt)}</p>
          <p>Patient : {data.invoice.patient.fullName}</p>
          <p>Code : {data.invoice.patient.code}</p>
          <p>
            Facture : {data.invoice.number} · Demande : {data.invoice.orderNumber}
          </p>
          <hr className="my-2 border-dashed border-black" />
          <table className="w-full">
            <tbody>
              {data.invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td className="pr-2 align-top">{l.label}</td>
                  <td className="whitespace-nowrap text-right align-top">{formatMoney(l.amount, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <hr className="my-2 border-dashed border-black" />
          <Line label="Total" value={formatMoney(data.invoice.totalAmount, cur)} />
          {data.invoice.discountAmount !== '0.00' && <Line label="Remise" value={`− ${formatMoney(data.invoice.discountAmount, cur)}`} />}
          {data.invoice.coveragePercent > 0 && (
            <Line label={`Pris en charge (${data.invoice.coveragePercent} %)`} value={`− ${formatMoney(data.invoice.thirdPartyAmount, cur)}`} />
          )}
          <Line label="Part patient" value={formatMoney(data.invoice.patientAmount, cur)} bold />
          <hr className="my-2 border-dashed border-black" />
          {data.payment.currency !== cur || data.payment.changeAmount !== '0.00' ? (
            <>
              <Line label={`Remis (${PAYMENT_METHOD_LABELS[data.payment.method]})`} value={formatMoney(data.payment.tenderedAmount, data.payment.currency)} />
              {data.payment.currency !== cur && <p>Taux du jour : 1 USD = {Number(data.payment.exchangeRate).toLocaleString('fr-FR')} CDF</p>}
              <Line label="Imputé sur la facture" value={formatMoney(data.payment.amount, cur)} bold />
              {data.payment.changeAmount !== '0.00' && <Line label="Monnaie rendue" value={formatMoney(data.payment.changeAmount, cur)} />}
            </>
          ) : (
            <Line label={`Ce paiement (${PAYMENT_METHOD_LABELS[data.payment.method]})`} value={formatMoney(data.payment.amount, cur)} bold />
          )}
          {data.payment.reference && <p>Réf. : {data.payment.reference}</p>}
          <Line label="Total payé" value={formatMoney(data.invoice.paidAmount, cur)} />
          <Line label="Reste à payer" value={formatMoney(data.invoice.balance, cur)} bold />
          <hr className="my-2 border-dashed border-black" />
          <p>Caissier : {data.payment.receivedBy ?? '—'}</p>
          <p>Session : {data.payment.cashSessionNumber}</p>
          {data.lab.reportFooter && <p className="mt-2 text-center" style={{ fontSize: '7.5pt' }}>{data.lab.reportFooter}</p>}
          <p className="mt-2 text-center" style={{ fontSize: '8pt' }}>
            Conservez ce reçu pour le retrait de vos résultats.
          </p>
        </div>
      )}
    </PrintShell>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
