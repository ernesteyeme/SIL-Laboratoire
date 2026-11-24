import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateUserInput,
  Paginated,
  ResetPasswordInput,
  Role,
  UpdateUserInput,
  UserDto,
  UserStatusChangeInput,
} from '@lims/shared';
import { api } from '@/lib/api';

export interface UsersFilter {
  page: number;
  pageSize: number;
  search?: string;
  role?: Role | '';
  status: 'active' | 'inactive' | 'all';
}

export function useUsers(filter: UsersFilter) {
  return useQuery({
    queryKey: ['users', filter],
    queryFn: ({ signal }) => api<Paginated<UserDto>>('/users', { query: { ...filter }, signal }),
    placeholderData: keepPreviousData,
  });
}

function useUserMutation<TVars>(fn: (vars: TVars) => Promise<UserDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export const useCreateUser = () =>
  useUserMutation((body: CreateUserInput) => api<UserDto>('/users', { method: 'POST', body }));

export const useUpdateUser = () =>
  useUserMutation(({ id, body }: { id: string; body: UpdateUserInput }) =>
    api<UserDto>(`/users/${id}`, { method: 'PATCH', body }),
  );

export const useResetPassword = () =>
  useUserMutation(({ id, body }: { id: string; body: ResetPasswordInput }) =>
    api<UserDto>(`/users/${id}/reset-password`, { method: 'POST', body }),
  );

export type StatusAction = 'deactivate' | 'reactivate' | 'unlock';

export const useUserStatusAction = () =>
  useUserMutation(({ id, action, body }: { id: string; action: StatusAction; body: UserStatusChangeInput }) =>
    api<UserDto>(`/users/${id}/${action}`, { method: 'POST', body }),
  );
