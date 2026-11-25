import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isSectionScoped, type AuthResponse, type AuthUser, type ChangePasswordInput, type LoginInput, type Role } from '@lims/shared';
import { api, onSessionChange, refreshSession, setAccessToken } from '@/lib/api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (input: LoginInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  changePassword: (input: ChangePasswordInput) => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  /** Habilitation par service : vrai si l’utilisateur peut saisir/valider dans ce service (rôles non limités : toujours vrai). */
  canActOnSection: (sectionId: string) => boolean;
  /** Services attribués, ou null si le rôle n’est pas limité à des services. */
  allowedSectionIds: string[] | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const applySession = useCallback((session: AuthResponse | null) => {
    if (session) {
      setAccessToken(session.accessToken);
      setUser(session.user);
      setStatus('authenticated');
    } else {
      setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  // Restauration de la session au chargement (cookie httpOnly) + écoute des rafraîchissements.
  useEffect(() => {
    const unsubscribe = onSessionChange((session) => {
      applySession(session);
      if (!session) queryClient.clear();
    });
    void refreshSession();
    return unsubscribe;
  }, [applySession, queryClient]);

  const login = useCallback(
    async (input: LoginInput) => {
      const session = await api<AuthResponse>('/auth/login', { method: 'POST', body: input, skipRefresh: true });
      queryClient.clear();
      applySession(session);
      return session.user;
    },
    [applySession, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST', skipRefresh: true });
    } finally {
      queryClient.clear();
      applySession(null);
    }
  }, [applySession, queryClient]);

  const changePassword = useCallback(
    async (input: ChangePasswordInput) => {
      const session = await api<AuthResponse>('/auth/change-password', { method: 'POST', body: input });
      applySession(session);
    },
    [applySession],
  );

  const hasRole = useCallback((...roles: Role[]) => !!user && user.roles.some((r) => roles.includes(r)), [user]);

  const allowedSectionIds = useMemo(() => (user && isSectionScoped(user.roles) ? (user.sectionIds ?? []) : null), [user]);
  const canActOnSection = useCallback(
    (sectionId: string) => allowedSectionIds === null || allowedSectionIds.includes(sectionId),
    [allowedSectionIds],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, changePassword, hasRole, canActOnSection, allowedSectionIds }),
    [status, user, login, logout, changePassword, hasRole, canActOnSection, allowedSectionIds],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
