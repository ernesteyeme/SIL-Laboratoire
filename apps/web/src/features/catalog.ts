import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateExamInput,
  CreateLabSectionInput,
  CreateParameterInput,
  CreateSampleTypeInput,
  ExamDetailDto,
  ExamListItemDto,
  ExamParameterDto,
  LabSectionDto,
  Paginated,
  ReferenceRangeDto,
  ReferenceRangeInput,
  SampleTypeDto,
  UpdateExamInput,
  UpdateLabSectionInput,
  UpdateParameterInput,
  UpdateSampleTypeInput,
} from '@lims/shared';
import { api } from '@/lib/api';

export const sectionsQuery = queryOptions({
  queryKey: ['catalog', 'sections'],
  queryFn: ({ signal }) => api<LabSectionDto[]>('/catalog/sections', { signal }),
});

export const sampleTypesQuery = queryOptions({
  queryKey: ['catalog', 'sample-types'],
  queryFn: ({ signal }) => api<SampleTypeDto[]>('/catalog/sample-types', { signal }),
});

export interface ExamsFilter {
  page: number;
  pageSize: number;
  q?: string;
  sectionId?: string;
  status: 'active' | 'inactive' | 'all';
}

export function useExams(filter: ExamsFilter) {
  return useQuery({
    queryKey: ['catalog', 'exams', filter],
    queryFn: ({ signal }) => api<Paginated<ExamListItemDto>>('/catalog/exams', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const examQuery = (id: string) =>
  queryOptions({
    queryKey: ['catalog', 'exam', id],
    queryFn: ({ signal }) => api<ExamDetailDto>(`/catalog/exams/${id}`, { signal }),
  });

/** Toute écriture au catalogue invalide l'ensemble du cache catalogue et l'audit. */
function useCatalogMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export const useCreateSection = () =>
  useCatalogMutation((body: CreateLabSectionInput) => api<LabSectionDto>('/catalog/sections', { method: 'POST', body }));
export const useUpdateSection = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdateLabSectionInput }) =>
    api<LabSectionDto>(`/catalog/sections/${id}`, { method: 'PATCH', body }),
  );

export const useCreateSampleType = () =>
  useCatalogMutation((body: CreateSampleTypeInput) => api<SampleTypeDto>('/catalog/sample-types', { method: 'POST', body }));
export const useUpdateSampleType = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdateSampleTypeInput }) =>
    api<SampleTypeDto>(`/catalog/sample-types/${id}`, { method: 'PATCH', body }),
  );

export const useCreateExam = () =>
  useCatalogMutation((body: CreateExamInput) => api<ExamDetailDto>('/catalog/exams', { method: 'POST', body }));
export const useUpdateExam = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdateExamInput }) =>
    api<ExamDetailDto>(`/catalog/exams/${id}`, { method: 'PATCH', body }),
  );

export const useCreateParameter = () =>
  useCatalogMutation(({ examId, body }: { examId: string; body: CreateParameterInput }) =>
    api<ExamParameterDto>(`/catalog/exams/${examId}/parameters`, { method: 'POST', body }),
  );
export const useUpdateParameter = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdateParameterInput }) =>
    api<ExamParameterDto>(`/catalog/parameters/${id}`, { method: 'PATCH', body }),
  );

export const useSaveRange = () =>
  useCatalogMutation(({ parameterId, rangeId, body }: { parameterId: string; rangeId?: string; body: ReferenceRangeInput }) =>
    rangeId
      ? api<ReferenceRangeDto>(`/catalog/reference-ranges/${rangeId}`, { method: 'PUT', body })
      : api<ReferenceRangeDto>(`/catalog/parameters/${parameterId}/reference-ranges`, { method: 'POST', body }),
  );
export const useDeleteRange = () =>
  useCatalogMutation(({ id, reason }: { id: string; reason: string }) =>
    api<void>(`/catalog/reference-ranges/${id}`, { method: 'DELETE', body: { reason } }),
  );
