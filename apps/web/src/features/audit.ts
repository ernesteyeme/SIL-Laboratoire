import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { AuditAction, AuditLogDto, AuditVerifyResult, Paginated } from '@lims/shared';
import { api } from '@/lib/api';

export interface AuditFilter {
  page: number;
  pageSize: number;
  entity?: string;
  entityId?: string;
  action?: AuditAction | '';
  from?: string;
  to?: string;
}

export function useAuditLog(filter: AuditFilter) {
  return useQuery({
    queryKey: ['audit', filter],
    queryFn: ({ signal }) =>
      api<Paginated<AuditLogDto>>('/audit', {
        signal,
        query: {
          ...filter,
          // Les dates du formulaire sont locales (AAAA-MM-JJ) : on couvre la journée entière.
          from: filter.from ? new Date(`${filter.from}T00:00:00`).toISOString() : undefined,
          to: filter.to ? new Date(`${filter.to}T23:59:59.999`).toISOString() : undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useVerifyAudit() {
  return useMutation({ mutationFn: () => api<AuditVerifyResult>('/audit/verify') });
}
