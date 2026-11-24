import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Ban, FileText, LockKeyhole, Pencil, Percent, Printer, Search, Unlock, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  closeCashSessionSchema,
  convertCents,
  discountSchema,
  exchangeRateSchema,
  fromCents,
  MAX_CASHIER_DISCOUNT_PERCENT,
  openCashSessionSchema,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHODS_WITH_REFERENCE,
  paymentSchema,
  toCents,
  type CashSessionDto,
  type ExchangeRateDto,
  type InvoiceDetailDto,
  type MethodTotalDto,
  type PaymentMethod,
} from '@lims/shared';
import { CASHIER_ROLES, EXCHANGE_RATE_WRITE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { InvoiceStatusBadge } from '@/components/labels';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ReasonModal } from '@/components/ui/ReasonModal';
import {
  currentSessionQuery,
  invoiceQuery,
  openPrint,
  todayRateQuery,
  useCancelPayment,
  useCashSessions,
  useCloseSession,
  useDiscount,
  useInvoices,
  useExchangeRates,
  useOpenSession,
  usePay,
  useSetTodayRate,
  type InvoicesFilter,
} from '@/features/billing';
import { settingsQuery } from '@/features/settings';
import { cn, errorMessage, formatDate, formatDateTime, formatMoney, zodFieldErrors } from '@/lib/utils';

/** Montant saisi → centimes (null si invalide). */
function parseCents(value: string): number | null {
  try {
    return value.trim() === '' ? null : toCents(value);
  } catch {
    return null;
  }
}

export function CashierPage() {
  const { hasRole } = useAuth();
  const isCashier = hasRole(...CASHIER_ROLES);
  const [params, setParams] = useSearchParams();
  const openInvoiceId = params.get('facture');
  const [tab, setTab] = useState<'outstanding' | 'all' | 'sessions'>('outstanding');
  const [notice, setNotice] = useState<string | null>(null);
  const settings = useQuery(settingsQuery);
  const currency = settings.data?.currency;
  const secondary = settings.data?.secondaryCurrency ?? null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Caisse" description="Encaissement des factures, sessions de caisse et clôture." />
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {secondary && currency && <RatePanel base={currency} secondary={secondary} onNotice={setNotice} />}
      {isCashier && <SessionPanel currency={currency} secondary={secondary} onNotice={setNotice} />}

      <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            ['outstanding', 'À encaisser'],
            ['all', 'Toutes les factures'],
            ['sessions', 'Sessions de caisse'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sessions' ? (
        <SessionsHistory currency={currency} />
      ) : (
        <InvoicesList key={tab} outstanding={tab === 'outstanding'} currency={currency} onOpen={(id) => setParams({ facture: id })} />
      )}

      <InvoiceModal
        invoiceId={openInvoiceId}
        currency={currency}
        secondary={secondary}
        onClose={() => setParams({})}
        onNotice={(m) => {
          setNotice(m);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taux du jour (caisse bi-devise)
// ---------------------------------------------------------------------------

function formatRate(rate: string, base: string): string {
  const value = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(Number(rate));
  return `1 USD = ${value} CDF${base === 'USD' ? ' (devise de base : USD)' : ''}`;
}

function RatePanel({ base, secondary, onNotice }: { base: string; secondary: string; onNotice: (m: string) => void }) {
  const { hasRole } = useAuth();
  const canEdit = hasRole(...EXCHANGE_RATE_WRITE_ROLES);
  const { data: rate, isLoading } = useQuery(todayRateQuery);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const rates = useExchangeRates(history);

  if (isLoading) return null;
  return (
    <Card className={cn('mb-4 p-4', !rate && 'border-amber-300 bg-amber-50')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ArrowRightLeft className={cn('size-5', rate ? 'text-brand-700' : 'text-amber-700')} aria-hidden />
          {rate ? (
            <div>
              <p className="font-semibold text-slate-900 tabular-nums">Taux du jour : {formatRate(rate.cdfPerUsd, base)}</p>
              <p className="text-xs text-slate-500">
                Fixé par {rate.setBy ?? '—'} · {formatDateTime(rate.updatedAt)}
                {rate.note && ` · ${rate.note}`} · paiements acceptés en {base} et en {secondary}
              </p>
            </div>
          ) : (
            <div>
              <p className="font-semibold text-amber-900">Aucun taux saisi pour aujourd’hui</p>
              <p className="text-sm text-amber-800">
                Les paiements en {secondary} sont bloqués tant que le taux du jour n’est pas fixé{canEdit ? '.' : ' (administrateur ou comptable).'}
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => setHistory((h) => !h)}>
              {history ? 'Masquer l’historique' : 'Historique'}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>
              {rate ? 'Modifier le taux' : 'Saisir le taux'}
            </Button>
          )}
        </div>
      </div>
      {history && (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-slate-200">
          {rates.isLoading ? (
            <LoadingBlock />
          ) : rates.isError ? (
            <Alert tone="error">{errorMessage(rates.error)}</Alert>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">CDF pour 1 USD</th>
                  <th className="px-3 py-2">Saisi par</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(rates.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-1.5">{formatDate(r.effectiveDate)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(Number(r.cdfPerUsd))}</td>
                    <td className="px-3 py-1.5">{r.setBy ?? '—'}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <RateModal open={editing} current={rate ?? null} onClose={() => setEditing(false)} onSaved={(r) => onNotice(`Taux du jour enregistré : ${formatRate(r.cdfPerUsd, base)}.`)} />
    </Card>
  );
}

function RateModal({ open, current, onClose, onSaved }: { open: boolean; current: ExchangeRateDto | null; onClose: () => void; onSaved: (r: ExchangeRateDto) => void }) {
  const save = useSetTodayRate();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(current ? String(Number(current.cdfPerUsd)) : '');
      setNote('');
      setErrors({});
      setFormError(null);
    }
  }, [open, current]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = exchangeRateSchema.safeParse({ cdfPerUsd: value, note });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      const saved = await save.mutateAsync(parsed.data);
      onSaved(saved);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Taux de change du jour"
      description="Nombre de francs congolais pour 1 dollar américain. Le taux est figé sur chaque paiement au moment de l’encaissement ; le modifier n’affecte pas les paiements déjà enregistrés."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="rate-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="rate-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField label="CDF pour 1 USD" required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} error={errors.cdfPerUsd} autoFocus />
        <TextAreaField
          label="Note"
          hint={current ? 'Motif de la modification (consigné dans la piste d’audit).' : 'Ex. cours indicatif de la Banque centrale.'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={errors.note}
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Session de caisse
// ---------------------------------------------------------------------------

/** « Espèces USD 10,00 $ (28 500 CDF) » : montant remis et, s'il diffère, montant imputé en devise de base. */
function methodTotalLabel(t: MethodTotalDto, base?: string): string {
  const head = `${PAYMENT_METHOD_LABELS[t.method]}${t.currency !== base ? ` ${t.currency}` : ''} ${formatMoney(t.tendered, t.currency)}`;
  return t.currency !== base ? `${head} (imputé ${formatMoney(t.applied, base)})` : head;
}

function SessionPanel({ currency, secondary, onNotice }: { currency?: string; secondary: string | null; onNotice: (m: string) => void }) {
  const { data: session, isLoading, isError, error: loadError } = useQuery(currentSessionQuery);
  const openM = useOpenSession();
  const [float, setFloat] = useState('0');
  const [floatSecondary, setFloatSecondary] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  if (isLoading) return <LoadingBlock label="Session de caisse…" />;
  if (isError) {
    return (
      <Alert tone="error" className="mb-6">
        Impossible de charger la session de caisse : {errorMessage(loadError)}
      </Alert>
    );
  }

  if (!session) {
    return (
      <Card className="mb-6 flex flex-wrap items-end justify-between gap-4 border-amber-300 bg-amber-50 p-5">
        <div>
          <p className="flex items-center gap-2 font-medium text-amber-900">
            <LockKeyhole className="size-4" aria-hidden /> Caisse fermée
          </p>
          <p className="text-sm text-amber-800">
            Ouvrez votre session en déclarant le fond de caisse{secondary ? ' dans chaque devise' : ''} pour pouvoir encaisser.
          </p>
          {error && (
            <Alert tone="error" className="mt-2">
              {error}
            </Alert>
          )}
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const parsed = openCashSessionSchema.safeParse(secondary ? { openingFloat: float, openingFloatSecondary: floatSecondary } : { openingFloat: float });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Montant invalide.');
              return;
            }
            try {
              const s = await openM.mutateAsync(parsed.data);
              onNotice(`Session ${s.number} ouverte.`);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <TextField label={`Fond de caisse (${currency ?? ''})`} inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} containerClassName="w-44" />
          {secondary && (
            <TextField label={`Fond de caisse (${secondary})`} inputMode="decimal" value={floatSecondary} onChange={(e) => setFloatSecondary(e.target.value)} containerClassName="w-44" />
          )}
          <Button type="submit" icon={Unlock} loading={openM.isPending}>
            Ouvrir la caisse
          </Button>
        </form>
      </Card>
    );
  }

  const second = session.secondaryCurrency;
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-medium text-slate-900">
            <Wallet className="size-4 text-brand-700" aria-hidden /> Session {session.number} <Badge tone="success">Ouverte</Badge>
          </p>
          <p className="text-sm text-slate-500">
            Depuis le {formatDateTime(session.openedAt)} · fond de caisse {formatMoney(session.openingFloat, session.baseCurrency)}
            {second && ` + ${formatMoney(session.openingFloatSecondary, second)}`}
          </p>
        </div>
        <Button variant="secondary" icon={LockKeyhole} onClick={() => setClosing(true)}>
          Clôturer la caisse
        </Button>
      </div>
      <div className={cn('mt-4 grid gap-3', second ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
        <Stat label={`Encaissé (imputé, ${session.baseCurrency})`} value={formatMoney(session.totalCollected, session.baseCurrency)} />
        <Stat label={`Espèces attendues ${session.baseCurrency}`} value={formatMoney(session.expectedCash, session.baseCurrency)} />
        {second && <Stat label={`Espèces attendues ${second}`} value={formatMoney(session.expectedCashSecondary ?? '0', second)} />}
        <Stat
          label="Paiements"
          value={`${session.paymentCount}${session.cancelledCount ? ` (+${session.cancelledCount} annulé·s)` : ''}${session.totalChange !== '0.00' ? ` · monnaie rendue ${formatMoney(session.totalChange, session.baseCurrency)}` : ''}`}
          small={session.totalChange !== '0.00'}
        />
        <Stat label="Par moyen" value={session.totals.length === 0 ? '—' : session.totals.map((t) => methodTotalLabel(t, session.baseCurrency)).join(' · ')} small />
      </div>
      <CloseSessionModal open={closing} session={session} onClose={() => setClosing(false)} onNotice={onNotice} />
    </Card>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-0.5 font-semibold text-slate-900', small ? 'text-xs' : 'text-base tabular-nums')}>{value}</p>
    </div>
  );
}

function CloseSessionModal({ open, session, onClose, onNotice }: { open: boolean; session: CashSessionDto; onClose: () => void; onNotice: (m: string) => void }) {
  const closeM = useCloseSession();
  const base = session.baseCurrency;
  const second = session.secondaryCurrency;
  const [counted, setCounted] = useState('');
  const [countedSecondary, setCountedSecondary] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCounted('');
      setCountedSecondary('');
      setNote('');
      setError(null);
    }
  }, [open]);

  const countedCents = parseCents(counted);
  const diff = countedCents === null ? null : countedCents - toCents(session.expectedCash);
  const countedSecondaryCents = parseCents(countedSecondary);
  const diffSecondary = !second || countedSecondaryCents === null ? null : countedSecondaryCents - toCents(session.expectedCashSecondary ?? '0');
  const hasGap = (diff !== null && diff !== 0) || (diffSecondary !== null && diffSecondary !== 0);
  const gapLabel = (d: number | null, cur: string) => (d === null ? '—' : `${d > 0 ? '+' : ''}${formatMoney(fromCents(d), cur)}`);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = closeCashSessionSchema.safeParse(second ? { countedCash: counted, countedCashSecondary: countedSecondary, note } : { countedCash: counted, note });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Montant invalide.');
      return;
    }
    try {
      const closed = await closeM.mutateAsync(parsed.data);
      const gaps = [
        closed.difference && closed.difference !== '0.00' ? formatMoney(closed.difference, base) : null,
        second && closed.differenceSecondary && closed.differenceSecondary !== '0.00' ? formatMoney(closed.differenceSecondary, second) : null,
      ].filter(Boolean);
      onNotice(`Session ${closed.number} clôturée${gaps.length ? ` avec un écart de ${gaps.join(' et ')}` : ' sans écart'}.`);
      onClose();
      openPrint(`/impression/caisse/${closed.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Clôture de la session ${session.number}`}
      description={`Comptez les espèces présentes dans la caisse (fond de caisse inclus)${second ? ', séparément pour chaque devise' : ''}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="close-session-form" loading={closeM.isPending}>
            Clôturer et imprimer le rapport
          </Button>
        </>
      }
    >
      <form id="close-session-form" onSubmit={submit} noValidate className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label={`Espèces attendues ${base}`} value={formatMoney(session.expectedCash, base)} />
          <Stat label={`Écart ${base}`} value={gapLabel(diff, base)} />
          {second && <Stat label={`Espèces attendues ${second}`} value={formatMoney(session.expectedCashSecondary ?? '0', second)} />}
          {second && <Stat label={`Écart ${second}`} value={gapLabel(diffSecondary, second)} />}
        </div>
        <div className={cn('grid gap-3', second && 'sm:grid-cols-2')}>
          <TextField label={`Espèces comptées (${base})`} required inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
          {second && <TextField label={`Espèces comptées (${second})`} required inputMode="decimal" value={countedSecondary} onChange={(e) => setCountedSecondary(e.target.value)} />}
        </div>
        <TextAreaField
          label="Justification de l’écart"
          required={hasGap}
          hint={hasGap ? 'Obligatoire en cas d’écart.' : undefined}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Factures
// ---------------------------------------------------------------------------

function InvoicesList({ outstanding, currency, onOpen }: { outstanding: boolean; currency?: string; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<InvoicesFilter>({ page: 1, pageSize: 20, q: '', outstanding: outstanding ? 'true' : 'false' });
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === searchInput ? f : { ...f, q: searchInput, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const { data, isLoading, isError, error, isFetching } = useInvoices(filter);

  return (
    <Card>
      <div className="border-b border-slate-200 p-4">
        <div className="relative max-w-xl">
          <TextField label="Rechercher" placeholder="N° de facture, de demande, code ou nom du patient" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-9" />
          <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
        </div>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <div className="p-4">
          <Alert tone="error">{errorMessage(error)}</Alert>
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FileText} title={outstanding ? 'Aucune facture à encaisser' : 'Aucune facture'} />
      ) : (
        <>
          <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Facture</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Part patient</th>
                  <th className="px-4 py-3 text-right">Reste à payer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((i) => (
                  <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(i.id)}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-brand-800">{i.number}</span>
                      <span className="block text-xs text-slate-500">
                        {i.orderNumber} · {formatDateTime(i.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{i.patient.fullName}</p>
                      <p className="text-xs text-slate-500">{i.patient.code}</p>
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge status={i.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(i.patientAmount, currency)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(i.balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={(page) => setFilter((f) => ({ ...f, page }))} />
        </>
      )}
    </Card>
  );
}

function InvoiceModal({
  invoiceId,
  currency,
  secondary,
  onClose,
  onNotice,
}: {
  invoiceId: string | null;
  currency?: string;
  secondary: string | null;
  onClose: () => void;
  onNotice: (m: string) => void;
}) {
  const { hasRole } = useAuth();
  const isCashier = hasRole(...CASHIER_ROLES);
  const isAdmin = hasRole('ADMIN');
  const { data: invoice, isLoading, isError, error } = useQuery({ ...invoiceQuery(invoiceId ?? ''), enabled: !!invoiceId });
  const session = useQuery({ ...currentSessionQuery, enabled: isCashier && !!invoiceId });
  const cancelPayment = useCancelPayment();
  const [discountOpen, setDiscountOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  return (
    <Modal open={!!invoiceId} onClose={onClose} size="lg" title={invoice ? `Facture ${invoice.number}` : 'Facture'} description={invoice ? `${invoice.patient.fullName} · demande ${invoice.orderNumber}` : undefined}>
      {isLoading || !invoice ? (
        isError ? <Alert tone="error">{errorMessage(error)}</Alert> : <LoadingBlock />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <InvoiceStatusBadge status={invoice.status} />
            {isCashier && invoice.status !== 'CANCELLED' && (
              <Button size="sm" variant="secondary" icon={Percent} onClick={() => setDiscountOpen(true)}>
                Remise
              </Button>
            )}
          </div>

          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5">{l.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(l.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 text-sm">
              <TotalRow label="Total" value={formatMoney(invoice.totalAmount, currency)} />
              {invoice.discountAmount !== '0.00' && (
                <TotalRow label={`Remise${invoice.discountReason ? ` (${invoice.discountReason})` : ''}`} value={`− ${formatMoney(invoice.discountAmount, currency)}`} />
              )}
              {invoice.coveragePercent > 0 && (
                <TotalRow label={`Prise en charge ${invoice.payerName ?? ''} (${invoice.coveragePercent} %)`} value={`− ${formatMoney(invoice.thirdPartyAmount, currency)}`} />
              )}
              <TotalRow label="Part patient" value={formatMoney(invoice.patientAmount, currency)} strong />
              <TotalRow label="Déjà payé" value={formatMoney(invoice.paidAmount, currency)} />
              <TotalRow label="Reste à payer" value={formatMoney(invoice.balance, currency)} strong />
            </tfoot>
          </table>

          {invoice.payments.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Paiements</h3>
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
                {invoice.payments.map((p) => (
                  <li key={p.id} className={cn('flex flex-wrap items-center justify-between gap-2 px-3 py-2', p.cancelledAt && 'bg-slate-50 text-slate-400 line-through')}>
                    <span>
                      <span className="font-mono text-xs">{p.number}</span> · {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference && ` (${p.reference})`} · {formatDateTime(p.receivedAt)}
                      {p.receivedBy && ` · ${p.receivedBy}`}
                      {p.cancelledAt && <span className="block text-xs no-underline">Annulé : {p.cancellationReason}</span>}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-right tabular-nums">
                        {formatMoney(p.amount, currency)}
                        {p.currency !== currency && (
                          <span className="block text-xs text-slate-500">
                            remis {formatMoney(p.tenderedAmount, p.currency)} à {Number(p.exchangeRate).toLocaleString('fr-FR')}
                          </span>
                        )}
                        {p.changeAmount !== '0.00' && <span className="block text-xs text-slate-500">monnaie {formatMoney(p.changeAmount, currency)}</span>}
                      </span>
                      {!p.cancelledAt && <IconAction label="Imprimer le reçu" icon={Printer} onClick={() => openPrint(`/impression/recu/${p.id}`)} />}
                      {!p.cancelledAt && isAdmin && <IconAction label="Annuler le paiement" icon={Ban} danger onClick={() => setCancelTarget(p.id)} />}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isCashier && invoice.status !== 'CANCELLED' && invoice.status !== 'PAID' && (
            session.data ? (
              <PaymentForm invoice={invoice} currency={currency} secondary={secondary} onPaid={(paymentId) => { onNotice(`Paiement enregistré sur ${invoice.number}.`); openPrint(`/impression/recu/${paymentId}`); }} />
            ) : (
              <Alert tone="warning">Ouvrez votre session de caisse pour encaisser.</Alert>
            )
          )}

          <DiscountModal open={discountOpen} invoice={invoice} currency={currency} canExceed={isAdmin} onClose={() => setDiscountOpen(false)} />
          <ReasonModal
            open={!!cancelTarget}
            title="Annuler le paiement"
            description="Réservé aux erreurs de saisie et aux remboursements, tant que la session de caisse est ouverte. Le reçu sera marqué annulé."
            confirmLabel="Annuler le paiement"
            danger
            onClose={() => setCancelTarget(null)}
            onConfirm={async (reason) => {
              await cancelPayment.mutateAsync({ id: cancelTarget!, reason });
              onNotice('Paiement annulé.');
            }}
          />
        </div>
      )}
    </Modal>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-semibold text-slate-900' : 'text-slate-600'}>
      <td className="py-1">{label}</td>
      <td className="py-1 text-right tabular-nums">{value}</td>
    </tr>
  );
}

function PaymentForm({ invoice, currency, secondary, onPaid }: { invoice: InvoiceDetailDto; currency?: string; secondary: string | null; onPaid: (paymentId: string) => void }) {
  const pay = usePay();
  const base = currency ?? 'CDF';
  const rateQ = useQuery({ ...todayRateQuery, enabled: !!secondary });
  const rate = rateQ.data?.cdfPerUsd ?? null;
  const [payCurrency, setPayCurrency] = useState(base);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState(invoice.balance);
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const balanceCents = toCents(invoice.balance);
  const foreign = payCurrency !== base;

  /** Montant à remettre dans la devise choisie pour solder la facture (arrondi au centime supérieur). */
  const suggested = useMemo(() => {
    if (!foreign) return invoice.balance;
    if (!rate) return '';
    let c = convertCents(balanceCents, base, payCurrency, rate);
    while (convertCents(c, payCurrency, base, rate) < balanceCents) c++;
    return fromCents(c);
  }, [foreign, rate, balanceCents, base, payCurrency, invoice.balance]);

  useEffect(() => {
    setAmount(suggested);
    setReference('');
  }, [suggested]);

  const preview = useMemo(() => {
    const tendered = parseCents(amount);
    if (tendered === null || tendered <= 0) return null;
    if (foreign && !rate) return null;
    const converted = foreign ? convertCents(tendered, payCurrency, base, rate!) : tendered;
    const applied = Math.min(converted, balanceCents);
    return { converted, applied, change: converted - applied };
  }, [amount, foreign, rate, payCurrency, base, balanceCents]);

  const overpayNonCash = !!preview && preview.change > 0 && method !== 'CASH';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = paymentSchema.safeParse({ amount, method, reference, ...(foreign ? { currency: payCurrency } : {}) });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      const result = await pay.mutateAsync({ id: invoice.id, body: parsed.data });
      onPaid(result.paymentId);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-brand-600/30 bg-brand-50/50 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Encaisser</h3>
      {formError && <Alert tone="error">{formError}</Alert>}
      {foreign && !rate && !rateQ.isLoading && (
        <Alert tone="warning">Aucun taux du jour : les paiements en {payCurrency} sont impossibles tant qu’un administrateur ou le comptable ne l’a pas saisi.</Alert>
      )}
      <div className={cn('grid gap-3', secondary ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        {secondary && (
          <SelectField label="Devise remise" value={payCurrency} onChange={(e) => setPayCurrency(e.target.value)}>
            <option value={base}>{base}</option>
            <option value={secondary}>{secondary}</option>
          </SelectField>
        )}
        <SelectField label="Moyen de paiement" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </SelectField>
        <TextField
          label={method === 'CASH' ? `Somme remise (${payCurrency})` : `Montant payé (${payCurrency})`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          hint={`Reste dû : ${formatMoney(invoice.balance, base)}${foreign && suggested ? ` ≈ ${formatMoney(suggested, payCurrency)}` : ''}`}
        />
        {method !== 'CASH' && (
          <TextField
            label="Référence de transaction"
            required={PAYMENT_METHODS_WITH_REFERENCE.includes(method)}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            error={errors.reference}
          />
        )}
      </div>
      {preview && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-white px-3 py-2 text-sm tabular-nums" aria-live="polite">
          {foreign && (
            <span>
              Équivalent : <strong>{formatMoney(fromCents(preview.converted), base)}</strong>
              <span className="text-slate-500"> (1 USD = {Number(rate).toLocaleString('fr-FR')} CDF)</span>
            </span>
          )}
          <span>
            Imputé sur la facture : <strong>{formatMoney(fromCents(preview.applied), base)}</strong>
          </span>
          {method === 'CASH' && preview.change > 0 && (
            <span className="text-brand-800">
              Monnaie à rendre : <strong>{formatMoney(fromCents(preview.change), base)}</strong>
            </span>
          )}
        </div>
      )}
      {overpayNonCash && <Alert tone="warning">Hors espèces, le montant ne peut pas dépasser le reste dû (aucune monnaie rendue).</Alert>}
      <Button type="submit" icon={Wallet} loading={pay.isPending} disabled={overpayNonCash || (foreign && !rate)}>
        Encaisser et imprimer le reçu
      </Button>
    </form>
  );
}

function DiscountModal({
  open,
  invoice,
  currency,
  canExceed,
  onClose,
}: {
  open: boolean;
  invoice: InvoiceDetailDto;
  currency?: string;
  canExceed: boolean;
  onClose: () => void;
}) {
  const discount = useDiscount();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(invoice.discountAmount === '0.00' ? '' : invoice.discountAmount);
      setReason('');
      setErrors({});
      setFormError(null);
    }
  }, [open, invoice.discountAmount]);

  const cents = parseCents(amount);
  const percent = cents === null || invoice.totalAmount === '0.00' ? null : (cents / toCents(invoice.totalAmount)) * 100;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = discountSchema.safeParse({ discountAmount: amount || '0', reason });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues, { discountAmount: 'amount' }));
      return;
    }
    try {
      await discount.mutateAsync({ id: invoice.id, body: parsed.data });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Remise sur ${invoice.number}`}
      description={`Total ${formatMoney(invoice.totalAmount, currency)}. ${canExceed ? '' : `Au-delà de ${MAX_CASHIER_DISCOUNT_PERCENT} %, la remise doit être accordée par un administrateur.`}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="discount-form" loading={discount.isPending}>
            Appliquer
          </Button>
        </>
      }
    >
      <form id="discount-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label={`Montant de la remise (${currency ?? ''})`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          hint={percent !== null ? `Soit ${percent.toFixed(1)} % du total. Saisissez 0 pour retirer la remise.` : undefined}
        />
        <TextAreaField label="Motif (consigné dans la piste d’audit)" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Historique des sessions
// ---------------------------------------------------------------------------

function SessionsHistory({ currency }: { currency?: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useCashSessions(page);
  if (isLoading) return <LoadingBlock />;
  if (isError) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!data || data.items.length === 0) return <Card><EmptyState icon={Wallet} title="Aucune session de caisse" /></Card>;
  return (
    <Card>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Session</th>
            <th className="px-4 py-3">Caissier</th>
            <th className="px-4 py-3">Période</th>
            <th className="px-4 py-3 text-right">Encaissé</th>
            <th className="px-4 py-3 text-right">Écart</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.items.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-3">
                <span className="font-mono text-xs font-semibold">{s.number}</span>{' '}
                {s.status === 'OPEN' ? <Badge tone="success">Ouverte</Badge> : <Badge>Clôturée</Badge>}
              </td>
              <td className="px-4 py-3">{s.cashier.fullName}</td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {formatDateTime(s.openedAt)}
                {s.closedAt && <> → {formatDateTime(s.closedAt)}</>}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatMoney(s.totalCollected, currency)}</td>
              <td className={cn('px-4 py-3 text-right tabular-nums', s.difference && s.difference !== '0.00' && 'font-semibold text-red-700')}>
                {s.difference === null ? '—' : formatMoney(s.difference, s.baseCurrency)}
                {s.secondaryCurrency && s.differenceSecondary !== null && (
                  <span className={cn('block text-xs', s.differenceSecondary !== '0.00' ? 'text-red-700' : 'text-slate-500')}>
                    {formatMoney(s.differenceSecondary, s.secondaryCurrency)}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <IconAction label="Rapport de session" icon={Printer} onClick={() => openPrint(`/impression/caisse/${s.id}`)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
    </Card>
  );
}
