import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Dhis2MappingDto,
  Dhis2MappingInput,
  Dhis2PreviewDto,
  Dhis2SendInput,
  InteropEndpointDto,
  InteropEndpointInput,
  InteropOverviewDto,
  InteropRunDetailDto,
  InteropRunDto,
  InteropRunKind,
  InteropRunStatus,
  Paginated,
  VlsmMappingDto,
  VlsmMappingInput,
  VlsmPendingItemDto,
} from '@lims/shared';
import { api, apiBlob } from '@/lib/api';

export const interopOverviewQuery = queryOptions({
  queryKey: ['interop', 'overview'],
  queryFn: ({ signal }) => api<InteropOverviewDto>('/interop/overview', { signal }),
  staleTime: 5 * 60_000,
});

export const interopEndpointsQuery = queryOptions({
  queryKey: ['interop', 'endpoints'],
  queryFn: ({ signal }) => api<InteropEndpointDto[]>('/interop/endpoints', { signal }),
});

export const dhis2MappingsQuery = (endpointId: string) =>
  queryOptions({
    queryKey: ['interop', 'dhis2-mappings', endpointId],
    queryFn: ({ signal }) => api<Dhis2MappingDto[]>(`/interop/endpoints/${endpointId}/dhis2-mappings`, { signal }),
  });

export const dhis2PreviewQuery = (endpointId: string, period: string) =>
  queryOptions({
    queryKey: ['interop', 'dhis2-preview', endpointId, period],
    queryFn: ({ signal }) => api<Dhis2PreviewDto>(`/interop/endpoints/${endpointId}/dhis2/preview`, { query: { period }, signal }),
  });

export const vlsmMappingsQuery = (endpointId: string) =>
  queryOptions({
    queryKey: ['interop', 'vlsm-mappings', endpointId],
    queryFn: ({ signal }) => api<VlsmMappingDto[]>(`/interop/endpoints/${endpointId}/vlsm-mappings`, { signal }),
  });

export const vlsmPendingQuery = (endpointId: string, from: string, to: string) =>
  queryOptions({
    queryKey: ['interop', 'vlsm-pending', endpointId, from, to],
    queryFn: ({ signal }) => api<VlsmPendingItemDto[]>(`/interop/endpoints/${endpointId}/vlsm/pending`, { query: { from, to }, signal }),
  });

export interface InteropRunsFilter {
  page: number;
  pageSize: number;
  endpointId?: string;
  kind?: InteropRunKind;
  status?: InteropRunStatus;
}

export function useInteropRuns(filter: InteropRunsFilter) {
  return useQuery({
    queryKey: ['interop', 'runs', filter],
    queryFn: ({ signal }) => api<Paginated<InteropRunDto>>('/interop/runs', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const interopRunQuery = (id: string) =>
  queryOptions({ queryKey: ['interop', 'run', id], queryFn: ({ signal }) => api<InteropRunDetailDto>(`/interop/runs/${id}`, { signal }) });

function useInteropMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['interop', 'audit']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useSaveEndpoint = () =>
  useInteropMutation(({ id, body }: { id?: string; body: InteropEndpointInput }) =>
    id ? api<InteropEndpointDto>(`/interop/endpoints/${id}`, { method: 'PUT', body }) : api<InteropEndpointDto>('/interop/endpoints', { method: 'POST', body }),
  );

export const useTestEndpoint = () => useInteropMutation((id: string) => api<InteropEndpointDto>(`/interop/endpoints/${id}/test`, { method: 'POST' }));

export const useSaveDhis2Mapping = () =>
  useInteropMutation(({ endpointId, id, body }: { endpointId: string; id?: string; body: Dhis2MappingInput }) =>
    id ? api<Dhis2MappingDto>(`/interop/dhis2-mappings/${id}`, { method: 'PUT', body }) : api<Dhis2MappingDto>(`/interop/endpoints/${endpointId}/dhis2-mappings`, { method: 'POST', body }),
  );

export const useDeleteDhis2Mapping = () => useInteropMutation((id: string) => api<void>(`/interop/dhis2-mappings/${id}`, { method: 'DELETE' }));

export const useSendDhis2 = () =>
  useInteropMutation(({ endpointId, body }: { endpointId: string; body: Dhis2SendInput }) => api<InteropRunDetailDto>(`/interop/endpoints/${endpointId}/dhis2/send`, { method: 'POST', body }));

export const useSaveVlsmMapping = () =>
  useInteropMutation(({ endpointId, id, body }: { endpointId: string; id?: string; body: VlsmMappingInput }) =>
    id ? api<VlsmMappingDto>(`/interop/vlsm-mappings/${id}`, { method: 'PUT', body }) : api<VlsmMappingDto>(`/interop/endpoints/${endpointId}/vlsm-mappings`, { method: 'POST', body }),
  );

export const useDeleteVlsmMapping = () => useInteropMutation((id: string) => api<void>(`/interop/vlsm-mappings/${id}`, { method: 'DELETE' }));

export const useSendVlsm = () =>
  useInteropMutation(({ endpointId, orderItemIds }: { endpointId: string; orderItemIds: string[] }) =>
    api<InteropRunDetailDto>(`/interop/endpoints/${endpointId}/vlsm/send`, { method: 'POST', body: { orderItemIds } }),
  );

/** Téléchargement du fichier CSV d'import DHIS2 de la période. */
export async function downloadDhis2Csv(endpointId: string, period: string, code: string): Promise<void> {
  const { blob } = await apiBlob(`/interop/endpoints/${endpointId}/dhis2/csv?period=${encodeURIComponent(period)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dhis2-${code.toLowerCase()}-${period}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
