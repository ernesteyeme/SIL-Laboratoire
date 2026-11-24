import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcknowledgeAlertInput,
  AnalysisItemDto,
  BiologicalValidationInput,
  OrderResultsDto,
  Paginated,
  ReportDto,
  SaveResultsInput,
  WorklistItemDto,
} from '@lims/shared';
import { api, apiBlob } from '@/lib/api';

export type WorklistStatus = 'TO_ENTER' | 'ENTERED' | 'TECHNICAL_VALIDATED' | 'VALIDATED';

export interface WorklistFilter {
  page: number;
  pageSize: number;
  status: WorklistStatus;
  sectionId?: string;
  q?: string;
}

export function useWorklist(filter: WorklistFilter) {
  return useQuery({
    queryKey: ['worklist', filter],
    queryFn: ({ signal }) => api<Paginated<WorklistItemDto>>('/results/worklist', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export const orderResultsQuery = (orderId: string) =>
  queryOptions({
    queryKey: ['order-results', orderId],
    queryFn: ({ signal }) => api<OrderResultsDto>(`/results/orders/${orderId}`, { signal }),
  });

function useResultsMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['order-results', 'worklist', 'orders', 'order', 'audit']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useSaveResults = () =>
  useResultsMutation(({ itemId, body }: { itemId: string; body: SaveResultsInput }) =>
    api<AnalysisItemDto>(`/results/items/${itemId}`, { method: 'PUT', body }),
  );
export const useTechnicalValidation = () =>
  useResultsMutation((itemId: string) => api<AnalysisItemDto>(`/results/items/${itemId}/technical-validation`, { method: 'POST' }));
export const useBiologicalValidation = () =>
  useResultsMutation(({ itemId, body }: { itemId: string; body: BiologicalValidationInput }) =>
    api<AnalysisItemDto>(`/results/items/${itemId}/biological-validation`, { method: 'POST', body }),
  );
export const useReturnToEntry = () =>
  useResultsMutation(({ itemId, reason }: { itemId: string; reason: string }) =>
    api<AnalysisItemDto>(`/results/items/${itemId}/return`, { method: 'POST', body: { reason } }),
  );
export const useAmend = () =>
  useResultsMutation(({ itemId, reason }: { itemId: string; reason: string }) =>
    api<AnalysisItemDto>(`/results/items/${itemId}/amend`, { method: 'POST', body: { reason } }),
  );
export const useAcknowledgeAlert = () =>
  useResultsMutation(({ alertId, body }: { alertId: string; body: AcknowledgeAlertInput }) =>
    api<AnalysisItemDto>(`/results/alerts/${alertId}/acknowledge`, { method: 'POST', body }),
  );
export const useIssuePartialReport = () =>
  useResultsMutation((orderId: string) => api<ReportDto>(`/reports/orders/${orderId}/partial`, { method: 'POST' }));

/**
 * Ouvre le PDF archivé dans un nouvel onglet. L'onglet est ouvert avant le téléchargement
 * (sinon les navigateurs bloquent la fenêtre surgissante), puis reçoit le document.
 */
export async function openReportPdf(report: Pick<ReportDto, 'id' | 'number'>): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const { blob } = await apiBlob(`/reports/${report.id}/pdf`);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
