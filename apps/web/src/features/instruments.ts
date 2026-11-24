import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IngestResultDto,
  InstrumentApiKeyDto,
  InstrumentDto,
  InstrumentInput,
  InstrumentMappingInput,
  InstrumentMessageDetailDto,
  InstrumentMessageDto,
  InstrumentMessageStatus,
  InstrumentQcMaterialInput,
  InstrumentResultDto,
  InstrumentResultStatus,
  InstrumentWorklistDto,
  Paginated,
} from '@lims/shared';
import { api } from '@/lib/api';

export const instrumentsQuery = queryOptions({
  queryKey: ['instruments', 'list'],
  queryFn: ({ signal }) => api<InstrumentDto[]>('/instruments', { signal }),
  refetchInterval: 30_000,
});

export const instrumentQuery = (id: string) =>
  queryOptions({ queryKey: ['instruments', 'one', id], queryFn: ({ signal }) => api<InstrumentDto>(`/instruments/${id}`, { signal }) });

export const instrumentWorklistQuery = (id: string) =>
  queryOptions({ queryKey: ['instruments', 'worklist', id], queryFn: ({ signal }) => api<InstrumentWorklistDto>(`/instruments/${id}/worklist`, { signal }) });

export interface InstrumentResultsFilter {
  page: number;
  pageSize: number;
  instrumentId?: string;
  status: InstrumentResultStatus | 'TO_REVIEW';
  q?: string;
}

export function useInstrumentResults(filter: InstrumentResultsFilter) {
  return useQuery({
    queryKey: ['instrument-results', filter],
    queryFn: ({ signal }) => api<Paginated<InstrumentResultDto>>('/instrument-results', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export interface InstrumentMessagesFilter {
  page: number;
  pageSize: number;
  instrumentId?: string;
  status?: InstrumentMessageStatus;
}

export function useInstrumentMessages(filter: InstrumentMessagesFilter) {
  return useQuery({
    queryKey: ['instrument-messages', filter],
    queryFn: ({ signal }) => api<Paginated<InstrumentMessageDto>>('/instrument-messages', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const instrumentMessageQuery = (id: string) =>
  queryOptions({ queryKey: ['instrument-messages', 'one', id], queryFn: ({ signal }) => api<InstrumentMessageDetailDto>(`/instrument-messages/${id}`, { signal }) });

function useInstrumentMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['instruments', 'instrument-results', 'instrument-messages', 'order-results', 'worklist', 'qc', 'audit']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useSaveInstrument = () =>
  useInstrumentMutation(({ id, body }: { id?: string; body: InstrumentInput }) =>
    id ? api<InstrumentDto>(`/instruments/${id}`, { method: 'PUT', body }) : api<InstrumentDto>('/instruments', { method: 'POST', body }),
  );
export const useRotateKey = () => useInstrumentMutation((id: string) => api<InstrumentApiKeyDto>(`/instruments/${id}/api-key`, { method: 'POST' }));
export const useSaveMapping = () =>
  useInstrumentMutation(({ id, body }: { id: string; body: InstrumentMappingInput }) => api<InstrumentDto>(`/instruments/${id}/mappings`, { method: 'PUT', body }));
export const useSaveQcLink = () =>
  useInstrumentMutation(({ id, body }: { id: string; body: InstrumentQcMaterialInput }) => api<InstrumentDto>(`/instruments/${id}/qc-materials`, { method: 'PUT', body }));
export const useRemoveQcLink = () =>
  useInstrumentMutation(({ id, linkId }: { id: string; linkId: string }) => api<InstrumentDto>(`/instruments/${id}/qc-materials/${linkId}`, { method: 'DELETE' }));
export const useUploadFile = () =>
  useInstrumentMutation(({ id, content, filename }: { id: string; content: string; filename: string }) =>
    api<IngestResultDto>(`/instruments/${id}/upload`, { method: 'POST', body: { content, filename } }),
  );
export const useRetryResult = () => useInstrumentMutation((id: string) => api<InstrumentResultDto>(`/instrument-results/${id}/retry`, { method: 'POST' }));
export const useAcceptResult = () => useInstrumentMutation((id: string) => api<InstrumentResultDto>(`/instrument-results/${id}/accept`, { method: 'POST' }));
export const useDismissResult = () =>
  useInstrumentMutation(({ id, reason }: { id: string; reason: string }) => api<InstrumentResultDto>(`/instrument-results/${id}/dismiss`, { method: 'POST', body: { reason } }));
