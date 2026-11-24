import type { ClsStore } from 'nestjs-cls';
import type { Role } from '@lims/shared';

/** Utilisateur authentifié attaché à la requête par le JwtAuthGuard. */
export interface RequestUser {
  id: string;
  username: string;
  fullName: string;
  roles: Role[];
  mustChangePassword: boolean;
}

/** Contexte propagé (AsyncLocalStorage) pendant toute la durée d'une requête. */
export interface AppClsStore extends ClsStore {
  ip?: string;
  userAgent?: string;
  user?: RequestUser;
}
