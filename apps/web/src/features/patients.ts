import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePatientInput,
  DuplicateCandidate,
  DuplicateCheckInput,
  Paginated,
  PatientDto,
  PatientStatusChangeInput,
  Sex,
  UpdatePatientInput,
} from '@lims/shared';
import { api } from '@/lib/api';

export interface PatientsFilter {
  page: number;
  pageSize: number;
  q?: string;
  sex?: Sex | '';
  status: 'active' | 'inactive' | 'all';
}

export function usePatients(filter: PatientsFilter) {
  return useQuery({
    queryKey: ['patients', filter],
    queryFn: ({ signal }) => api<Paginated<PatientDto>>('/patients', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function checkDuplicates(body: DuplicateCheckInput, signal?: AbortSignal) {
  return api<DuplicateCandidate[]>('/patients/duplicates', { method: 'POST', body, signal });
}

function usePatientMutation<T>(fn: (vars: T) => Promise<PatientDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patients'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export const useCreatePatient = () =>
  usePatientMutation((body: CreatePatientInput) => api<PatientDto>('/patients', { method: 'POST', body }));

export const useUpdatePatient = () =>
  usePatientMutation(({ id, body }: { id: string; body: UpdatePatientInput }) =>
    api<PatientDto>(`/patients/${id}`, { method: 'PATCH', body }),
  );

export const usePatientStatus = () =>
  usePatientMutation(({ id, active, body }: { id: string; active: boolean; body: PatientStatusChangeInput }) =>
    api<PatientDto>(`/patients/${id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST', body }),
  );
