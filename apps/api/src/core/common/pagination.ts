import type { Paginated, PaginationQuery } from '@lims/shared';

export function toPage<T>(items: T[], total: number, query: PaginationQuery): Paginated<T> {
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export function skipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/** Filtre de statut actif / inactif / tous. */
export function statusFilter(status: 'active' | 'inactive' | 'all'): boolean | undefined {
  return status === 'all' ? undefined : status === 'active';
}
