import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ban, FlaskConical, Info, Printer, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { computeAge, SEX_LABELS } from '@lims/shared';
import { BILLING_READ_ROLES, REGISTRATION_WRITE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { InvoiceStatusBadge, OrderStatusBadge, PriorityBadge } from '@/components/labels';
import { SampleCard } from '@/components/samples/SampleCard';
import { Button } from '@/components/ui/Button';
import { Alert, LoadingBlock } from '@/components/ui/feedback';
import { Card } from '@/components/ui/PageHeader';
import { ReasonModal } from '@/components/ui/ReasonModal';
import { openPrint } from '@/features/billing';
import { orderQuery, useCancelOrder } from '@/features/orders';
import { settingsQuery } from '@/features/settings';
import { errorMessage, formatDateTime, formatMoney, formatTurnaround } from '@/lib/utils';
import { NotFoundPage } from '../NotFoundPage';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { hasRole } = useAuth();
  const { data: order, isLoading, isError, error } = useQuery(orderQuery(id));
  const settings = useQuery(settingsQuery);
  const cancel = useCancelOrder();
  const [notice, setNotice] = useState<string | null>(
    (location.state as { justCreated?: boolean } | null)?.justCreated ? 'Demande enregistrée. Imprimez les étiquettes des échantillons.' : null,
  );
  const [cancelOpen, setCancelOpen] = useState(false);

  if (isLoading) return <LoadingBlock />;
  if (isError) return (error as { status?: number })?.status === 404 ? <NotFoundPage /> : <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!order) return null;

  const cancelled = order.status === 'CANCELLED';
  const currency = settings.data?.currency;
  const instructions = [...new Set(order.items.map((i) => i.patientInstructions).filter((v): v is string => !!v))];
  const canCancel = !cancelled && hasRole(...REGISTRATION_WRITE_ROLES) && !order.samples.some((s) => s.status === 'RECEIVED');
  const printableSamples = order.samples.filter((s) => s.status !== 'REJECTED' && s.examCodes.length > 0);
  const paymentBlocking =
    order.paymentRequiredBeforeCollection && order.priority !== 'URGENT' && order.invoice && order.invoice.status !== 'PAID' && !cancelled;

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/demandes" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="size-4" /> Demandes
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-sm font-semibold text-white">{order.number}</span>
            <PriorityBadge priority={order.priority} />
            <OrderStatusBadge status={order.status} />
          </div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{order.patient.fullName}</h1>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{order.patient.code}</span> · {SEX_LABELS[order.patient.sex]}
            {order.patient.birthDate && ` · ${computeAge(order.patient.birthDate).label}${order.patient.birthDateEstimated ? ' (est.)' : ''}`}
            {order.patient.phone && ` · ${order.patient.phone}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {printableSamples.length > 0 && !cancelled && (
            <Button icon={Printer} onClick={() => openPrint(`/impression/etiquettes/${order.id}`)}>
              Imprimer les étiquettes ({printableSamples.length})
            </Button>
          )}
          {order.samples.some((s) => s.status === 'RECEIVED') && (
            <Link
              to={`/resultats/${order.id}`}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FlaskConical className="size-4" aria-hidden /> Résultats et comptes rendus
            </Link>
          )}
          {canCancel && (
            <Button variant="secondary" icon={Ban} onClick={() => setCancelOpen(true)}>
              Annuler la demande
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {cancelled && (
        <Alert tone="error" className="mb-4" title={`Demande annulée le ${formatDateTime(order.cancelledAt)}`}>
          {order.cancellationReason}
        </Alert>
      )}
      {paymentBlocking && (
        <Alert tone="warning" className="mb-4" title="Paiement requis avant le prélèvement">
          Le laboratoire exige le règlement de la part patient avant tout prélèvement (sauf urgence). Orientez le patient vers la caisse.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Échantillons</h2>
          {instructions.length > 0 && !cancelled && (
            <Alert tone="info" title="Préparation du patient">
              <ul className="list-inside list-disc">
                {instructions.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Alert>
          )}
          {order.samples.map((s) => (
            <SampleCard key={s.id} sample={s} orderId={order.id} orderCancelled={cancelled} onDone={setNotice} />
          ))}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Demande</h2>
            <dl className="space-y-2 text-sm">
              <Detail label="Enregistrée le" value={`${formatDateTime(order.createdAt)}${order.createdBy ? ` par ${order.createdBy}` : ''}`} />
              <Detail label="Prescripteur" value={order.prescriberName ?? '—'} />
              <Detail label="Renseignements cliniques" value={order.clinicalInfo ?? '—'} />
            </dl>
          </Card>

          <Card>
            <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Examens</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 px-5 py-2">
                  <span>
                    <span className="font-mono text-xs font-semibold">{i.examCode}</span> {i.examName}
                    <span className="block text-xs text-slate-500">
                      Éch. {i.sampleNumber} · résultat sous {formatTurnaround(i.turnaroundHours)}
                    </span>
                  </span>
                  <span className="whitespace-nowrap tabular-nums">{formatMoney(i.unitPrice, currency)}</span>
                </li>
              ))}
            </ul>
          </Card>

          {order.invoice && (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Facture</h2>
                <InvoiceStatusBadge status={order.invoice.status} />
              </div>
              <dl className="space-y-1 text-sm">
                <Detail label="N°" value={order.invoice.number} />
                <Detail label="Part patient" value={formatMoney(order.invoice.patientAmount, currency)} />
                <Detail label="Payé" value={formatMoney(order.invoice.paidAmount, currency)} />
                <Detail label="Reste à payer" value={formatMoney(order.invoice.balance, currency)} strong />
              </dl>
              {hasRole(...BILLING_READ_ROLES) && (
                <Link to={`/caisse?facture=${order.invoice.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                  <Wallet className="size-4" /> Ouvrir en caisse
                </Link>
              )}
              {!hasRole(...BILLING_READ_ROLES) && order.invoice.status !== 'PAID' && order.invoice.status !== 'CANCELLED' && (
                <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Orientez le patient vers la caisse pour le règlement.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      <ReasonModal
        open={cancelOpen}
        title={`Annuler la demande ${order.number}`}
        description="La facture sera annulée. Impossible si des paiements ont été encaissés (à faire annuler par un administrateur) ou si des échantillons sont déjà reçus."
        confirmLabel="Annuler la demande"
        danger
        placeholder="Ex. : erreur de patient, patient reparti"
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          await cancel.mutateAsync({ id: order.id, reason });
          setNotice('Demande annulée.');
        }}
      />
    </div>
  );
}

function Detail({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right ${strong ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{value}</dd>
    </div>
  );
}
