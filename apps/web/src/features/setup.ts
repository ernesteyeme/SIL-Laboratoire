import { queryOptions, useMutation } from '@tanstack/react-query';
import type { SetupCompleteInput, SetupResultDto, SetupStatusDto, VersionDto } from '@lims/shared';
import { api } from '@/lib/api';

export const setupStatusQuery = queryOptions({
  queryKey: ['setup', 'status'],
  queryFn: ({ signal }) => api<SetupStatusDto>('/setup/status', { signal }),
  staleTime: 30_000,
  retry: 1,
});

export const versionQuery = queryOptions({
  queryKey: ['setup', 'version'],
  queryFn: ({ signal }) => api<VersionDto>('/setup/version', { signal }),
  staleTime: Infinity,
});

export const useVerifySetupToken = () => useMutation({ mutationFn: (token: string) => api<void>('/setup/verify-token', { method: 'POST', body: { token } }) });

export const useCompleteSetup = () => useMutation({ mutationFn: (body: SetupCompleteInput) => api<SetupResultDto>('/setup/complete', { method: 'POST', body }) });

export const formatVersion = (v: Pick<VersionDto, 'version' | 'commit'> | undefined) => (v ? `v${v.version}${v.commit ? ` (${v.commit})` : ''}` : '');
