import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancelQualityIssueInput,
  CloseQualityIssueInput,
  CreateQualityIssueInput,
  IndicatorsDto,
  LeveyJenningsDto,
  Paginated,
  PlanQualityIssueInput,
  QcMaterialDto,
  QcMaterialInput,
  QcParameterStatusDto,
  QcRunDetailDto,
  QcRunDto,
  QcRunInput,
  QcStatus,
  QcTargetDto,
  QcTargetInput,
  QualityIssueCategory,
  QualityIssueDto,
  QualityIssueSeverity,
  QualityIssueStatus,
} from '@lims/shared';
import { api } from '@/lib/api';

// ---------------------------------------------------------------- CIQ
export const qcStatusQuery = (sectionId?: string) =>
  queryOptions({
    queryKey: ['qc', 'status', sectionId ?? ''],
    queryFn: ({ signal }) => api<QcParameterStatusDto[]>('/qc/status', { query: { sectionId }, signal }),
    refetchInterval: 60_000,
  });

export const qcMaterialsQuery = (includeInactive: boolean) =>
  queryOptions({
    queryKey: ['qc', 'materials', includeInactive],
    queryFn: ({ signal }) => api<QcMaterialDto[]>('/qc/materials', { query: { includeInactive: String(includeInactive) }, signal }),
  });

export interface QcRunsFilter {
  page: number;
  pageSize: number;
  parameterId?: string;
  sectionId?: string;
  status?: QcStatus;
  unresolved?: 'true';
  from?: string;
  to?: string;
}

export function useQcRuns(filter: QcRunsFilter) {
  return useQuery({
    queryKey: ['qc', 'runs', filter],
    queryFn: ({ signal }) => api<Paginated<QcRunDto>>('/qc/runs', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const qcRunQuery = (id: string) =>
  queryOptions({ queryKey: ['qc', 'run', id], queryFn: ({ signal }) => api<QcRunDetailDto>(`/qc/runs/${id}`, { signal }) });

export const leveyJenningsQuery = (targetId: string, from?: string, to?: string) =>
  queryOptions({
    queryKey: ['qc', 'lj', targetId, from ?? '', to ?? ''],
    queryFn: ({ signal }) => api<LeveyJenningsDto>(`/qc/targets/${targetId}/levey-jennings`, { query: { from, to }, signal }),
  });

function useQualityMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['qc', 'quality-issues', 'indicators', 'audit', 'order-results', 'worklist']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useCreateQcRun = () => useQualityMutation((body: QcRunInput) => api<QcRunDetailDto>('/qc/runs', { method: 'POST', body }));
export const useQcCorrectiveAction = () =>
  useQualityMutation(({ id, correctiveAction }: { id: string; correctiveAction: string }) =>
    api<QcRunDetailDto>(`/qc/runs/${id}/corrective-action`, { method: 'POST', body: { correctiveAction } }),
  );
export const useExcludeQcRun = () =>
  useQualityMutation(({ id, reason }: { id: string; reason: string }) => api<QcRunDetailDto>(`/qc/runs/${id}/exclude`, { method: 'POST', body: { reason } }));
export const useSaveQcMaterial = () =>
  useQualityMutation(({ id, body }: { id?: string; body: QcMaterialInput }) =>
    id ? api<QcMaterialDto>(`/qc/materials/${id}`, { method: 'PUT', body }) : api<QcMaterialDto>('/qc/materials', { method: 'POST', body }),
  );
export const useSaveQcTarget = () =>
  useQualityMutation(({ materialId, body }: { materialId: string; body: QcTargetInput }) =>
    api<QcTargetDto>(`/qc/materials/${materialId}/targets`, { method: 'PUT', body }),
  );

// ---------------------------------------------------------------- Non-conformités
export interface IssuesFilter {
  page: number;
  pageSize: number;
  status?: QualityIssueStatus;
  category?: QualityIssueCategory;
  severity?: QualityIssueSeverity;
  overdue?: 'true';
  q?: string;
}

export function useQualityIssues(filter: IssuesFilter) {
  return useQuery({
    queryKey: ['quality-issues', 'list', filter],
    queryFn: ({ signal }) => api<Paginated<QualityIssueDto>>('/quality-issues', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const qualityIssueQuery = (id: string) =>
  queryOptions({ queryKey: ['quality-issues', 'one', id], queryFn: ({ signal }) => api<QualityIssueDto>(`/quality-issues/${id}`, { signal }) });

export const useDeclareIssue = () => useQualityMutation((body: CreateQualityIssueInput) => api<QualityIssueDto>('/quality-issues', { method: 'POST', body }));
export const usePlanIssue = () =>
  useQualityMutation(({ id, body }: { id: string; body: PlanQualityIssueInput }) => api<QualityIssueDto>(`/quality-issues/${id}/plan`, { method: 'POST', body }));
export const useCloseIssue = () =>
  useQualityMutation(({ id, body }: { id: string; body: CloseQualityIssueInput }) => api<QualityIssueDto>(`/quality-issues/${id}/close`, { method: 'POST', body }));
export const useCancelIssue = () =>
  useQualityMutation(({ id, body }: { id: string; body: CancelQualityIssueInput }) => api<QualityIssueDto>(`/quality-issues/${id}/cancel`, { method: 'POST', body }));

// ---------------------------------------------------------------- Indicateurs
export const indicatorsQuery = (from: string, to: string, sectionId?: string) =>
  queryOptions({
    queryKey: ['indicators', from, to, sectionId ?? ''],
    queryFn: ({ signal }) => api<IndicatorsDto>('/quality/indicators', { query: { from, to, sectionId }, signal }),
    placeholderData: keepPreviousData,
  });
