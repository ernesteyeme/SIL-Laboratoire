import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@lims/shared';
import type { RequestUser } from '../context/request-context';

export const IS_PUBLIC_KEY = 'security:isPublic';
export const ROLES_KEY = 'security:roles';
export const ANY_ROLE_KEY = 'security:anyRole';
export const ALLOW_PENDING_PASSWORD_KEY = 'security:allowPendingPassword';

/** Route accessible sans authentification. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Route réservée aux rôles listés (au moins un rôle en commun suffit). */
export const Roles = (...roles: [Role, ...Role[]]) => SetMetadata(ROLES_KEY, roles);

/** Route accessible à tout utilisateur authentifié, quel que soit son rôle. */
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true);

/** Route accessible même si l'utilisateur doit encore changer son mot de passe. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

/** Injecte l'utilisateur authentifié dans un paramètre de contrôleur. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
  if (!req.user) {
    throw new Error('CurrentUser utilisé sur une route publique.');
  }
  return req.user;
});
