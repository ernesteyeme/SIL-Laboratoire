import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CashSessionDto,
  CashSessionReportDto,
  CloseCashSessionInput,
  DiscountInput,
  ExchangeRateDto,
  ExchangeRateInput,
  InvoiceDetailDto,
  InvoiceListItemDto,
  OpenCashSessionInput,
  Paginated,
  PaymentInput,
  ReceiptDto,
} from '@lims/shared';
import { api } from '@/lib/api';

export interface InvoicesFilter {
  page: number;
  pageSize: number;
  q?: string;
  outstanding?: 'true' | 'false';
}

export function useInvoices(filter: InvoicesFilter) {
  return useQuery({
    queryKey: ['invoices', filter],
    queryFn: ({ signal }) => api<Paginated<InvoiceListItemDto>>('/invoices', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const invoiceQuery = (id: string) =>
  queryOptions({ queryKey: ['invoice', id], queryFn: ({ signal }) => api<InvoiceDetailDto>(`/invoices/${id}`, { signal }) });

export const currentSessionQuery = queryOptions({
  queryKey: ['cash-session', 'current'],
  queryFn: ({ signal }) => api<CashSessionDto | null>('/cash-sessions/current', { signal }),
});

export function useCashSessions(page: number) {
  return useQuery({
    queryKey: ['cash-session', 'list', page],
    queryFn: ({ signal }) => api<Paginated<CashSessionDto>>('/cash-sessions', { query: { page, pageSize: 15 }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const cashSessionReportQuery = (id: string) =>
  queryOptions({ queryKey: ['cash-session', 'report', id], queryFn: ({ signal }) => api<CashSessionReportDto>(`/cash-sessions/${id}`, { signal }) });

export const receiptQuery = (paymentId: string) =>
  queryOptions({ queryKey: ['receipt', paymentId], queryFn: ({ signal }) => api<ReceiptDto>(`/payments/${paymentId}/receipt`, { signal }) });

function useBillingMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['invoices', 'invoice', 'cash-session', 'orders', 'order', 'audit']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useOpenSession = () =>
  useBillingMutation((body: OpenCashSessionInput) => api<CashSessionDto>('/cash-sessions/open', { method: 'POST', body }));
export const useCloseSession = () =>
  useBillingMutation((body: CloseCashSessionInput) => api<CashSessionDto>('/cash-sessions/current/close', { method: 'POST', body }));
export const useDiscount = () =>
  useBillingMutation(({ id, body }: { id: string; body: DiscountInput }) =>
    api<InvoiceDetailDto>(`/invoices/${id}/discount`, { method: 'POST', body }),
  );
export const usePay = () =>
  useBillingMutation(({ id, body }: { id: string; body: PaymentInput }) =>
    api<{ invoice: InvoiceDetailDto; paymentId: string }>(`/invoices/${id}/payments`, { method: 'POST', body }),
  );
export const useCancelPayment = () =>
  useBillingMutation(({ id, reason }: { id: string; reason: string }) =>
    api<InvoiceDetailDto>(`/payments/${id}/cancel`, { method: 'POST', body: { reason } }),
  );

export const todayRateQuery = queryOptions({
  queryKey: ['exchange-rate', 'today'],
  queryFn: ({ signal }) => api<ExchangeRateDto | null>('/exchange-rates/today', { signal }),
});

export function useExchangeRates(enabled: boolean) {
  return useQuery({
    queryKey: ['exchange-rate', 'list'],
    queryFn: ({ signal }) => api<ExchangeRateDto[]>('/exchange-rates', { signal }),
    enabled,
  });
}

export function useSetTodayRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ExchangeRateInput) => api<ExchangeRateDto>('/exchange-rates/today', { method: 'PUT', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['exchange-rate'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/** Ouvre une page d'impression dans un nouvel onglet (elle lance l'impression d'elle-même). */
export function openPrint(path: string): void {
  window.open(path, '_blank', 'noopener');
}
