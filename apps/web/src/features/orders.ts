import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CollectSampleInput,
  CreateOrderInput,
  NonConformityInput,
  OrderDetailDto,
  OrderListItemDto,
  OrderPriority,
  OrderStatus,
  Paginated,
  SampleContextDto,
  SampleStatus,
} from '@lims/shared';
import { api } from '@/lib/api';

export interface OrdersFilter {
  page: number;
  pageSize: number;
  q?: string;
  status?: OrderStatus | '';
  priority?: OrderPriority | '';
  from?: string;
  to?: string;
}

export function useOrders(filter: OrdersFilter) {
  return useQuery({
    queryKey: ['orders', filter],
    queryFn: ({ signal }) => api<Paginated<OrderListItemDto>>('/orders', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const orderQuery = (id: string) =>
  queryOptions({ queryKey: ['order', id], queryFn: ({ signal }) => api<OrderDetailDto>(`/orders/${id}`, { signal }) });

export interface SamplesFilter {
  page: number;
  pageSize: number;
  status: SampleStatus;
  q?: string;
}

export function useSamples(filter: SamplesFilter) {
  return useQuery({
    queryKey: ['samples', filter],
    queryFn: ({ signal }) => api<Paginated<SampleContextDto>>('/samples', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function fetchSampleByNumber(number: string) {
  return api<SampleContextDto>(`/samples/by-number/${encodeURIComponent(number.trim())}`);
}

/** Toute opération sur une demande ou un échantillon rafraîchit demandes, échantillons, factures et audit. */
function useLabMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['orders', 'order', 'samples', 'invoices', 'invoice', 'cash-session', 'audit']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export const useCreateOrder = () => useLabMutation((body: CreateOrderInput) => api<OrderDetailDto>('/orders', { method: 'POST', body }));
export const useCancelOrder = () =>
  useLabMutation(({ id, reason }: { id: string; reason: string }) => api<OrderDetailDto>(`/orders/${id}/cancel`, { method: 'POST', body: { reason } }));

export const useCollectSample = () =>
  useLabMutation(({ id, body }: { id: string; body: CollectSampleInput }) =>
    api<SampleContextDto>(`/samples/${id}/collect`, { method: 'POST', body }),
  );
export const useReceiveSample = () =>
  useLabMutation((id: string) => api<SampleContextDto>(`/samples/${id}/receive`, { method: 'POST' }));
export const useNonConformity = () =>
  useLabMutation(({ id, body }: { id: string; body: NonConformityInput }) =>
    api<SampleContextDto>(`/samples/${id}/non-conformities`, { method: 'POST', body }),
  );
export const useRecollect = () =>
  useLabMutation(({ id, reason }: { id: string; reason: string }) =>
    api<SampleContextDto>(`/samples/${id}/recollect`, { method: 'POST', body: { reason } }),
  );
