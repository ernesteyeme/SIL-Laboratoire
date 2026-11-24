import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePrescriberInput, Paginated, PrescriberDto, UpdatePrescriberInput } from '@lims/shared';
import { api } from '@/lib/api';

export interface PrescribersFilter {
  page: number;
  pageSize: number;
  q?: string;
  status: 'active' | 'inactive' | 'all';
}

export function usePrescribers(filter: PrescribersFilter) {
  return useQuery({
    queryKey: ['prescribers', filter],
    queryFn: ({ signal }) => api<Paginated<PrescriberDto>>('/prescribers', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

function usePrescriberMutation<T>(fn: (vars: T) => Promise<PrescriberDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prescribers'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export const useCreatePrescriber = () =>
  usePrescriberMutation((body: CreatePrescriberInput) => api<PrescriberDto>('/prescribers', { method: 'POST', body }));

export const useUpdatePrescriber = () =>
  usePrescriberMutation(({ id, body }: { id: string; body: UpdatePrescriberInput }) =>
    api<PrescriberDto>(`/prescribers/${id}`, { method: 'PATCH', body }),
  );
