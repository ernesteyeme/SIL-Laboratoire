import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { LabSettingsDto, LabSettingsFormValues } from '@lims/shared';
import { api } from '@/lib/api';

export const settingsQuery = queryOptions({
  queryKey: ['settings', 'lab'],
  queryFn: ({ signal }) => api<LabSettingsDto>('/settings/lab', { signal }),
  staleTime: 5 * 60_000,
});

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LabSettingsFormValues) => api<LabSettingsDto>('/settings/lab', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(settingsQuery.queryKey, data);
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}
