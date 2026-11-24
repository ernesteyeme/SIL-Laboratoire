import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@lims/shared';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { useAuth } from './useAuth';

export const CHANGE_PASSWORD_PATH = '/changer-mot-de-passe';

interface Props {
  children: ReactNode;
  roles?: Role[];
}

export function RequireAuth({ children, roles }: Props) {
  const { status, user, hasRole } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner label="Chargement de la session…" />;

  if (status === 'anonymous' || !user) {
    return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  }

  if (user.mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  if (roles && !hasRole(...roles)) {
    return <ForbiddenPage requiredRoles={roles} />;
  }

  return <>{children}</>;
}
