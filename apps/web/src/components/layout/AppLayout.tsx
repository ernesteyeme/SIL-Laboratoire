import { useQuery } from '@tanstack/react-query';
import { FlaskConical, KeyRound, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { formatVersion, versionQuery } from '@/features/setup';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@lims/shared';
import { CHANGE_PASSWORD_PATH } from '@/auth/RequireAuth';
import { NAV_GROUP_LABELS, NAV_ITEMS, canAccess, type NavItem } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;
  // Tant que le mot de passe temporaire n'est pas changé, seul l'écran de changement est affiché, sans navigation.
  if (user.mustChangePassword) return <Outlet />;
  const items = NAV_ITEMS.filter((item) => canAccess(item, user.roles));

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      navigate('/connexion', { replace: true });
    }
  };

  const groups = (['main', 'activity', 'quality', 'referentials', 'admin'] as NavItem['group'][])
    .map((g) => ({ group: g, items: items.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);

  const nav = (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3" aria-label="Navigation principale">
      {groups.map(({ group, items: groupItems }) => (
        <div key={group} className="flex flex-col gap-1">
          {NAV_GROUP_LABELS[group] && (
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-brand-100/50">{NAV_GROUP_LABELS[group]}</p>
          )}
          {groupItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-700 text-white' : 'text-brand-100 hover:bg-brand-800 hover:text-white',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full">
      {/* Barre latérale (bureau) */}
      <aside className="hidden w-64 shrink-0 flex-col bg-brand-900 lg:flex">
        <Brand />
        {nav}
        <VersionTag />
      </aside>

      {/* Barre latérale (mobile) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-64 flex-col bg-brand-900">
            <button
              type="button"
              className="absolute right-3 top-4 text-brand-100"
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
            >
              <X className="size-5" />
            </button>
            <Brand />
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-8">
          <button type="button" className="text-slate-600 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="size-6" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
              <p className="text-xs text-slate-500">{user.roles.map((r) => ROLE_LABELS[r]).join(' · ')}</p>
            </div>
            <NavLink
              to={CHANGE_PASSWORD_PATH}
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="Changer mon mot de passe"
              aria-label="Changer mon mot de passe"
            >
              <KeyRound className="size-5" />
            </NavLink>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="Se déconnecter"
              aria-label="Se déconnecter"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Version et commit déployés (comme le pied de page d'InteLIS), utile pour le support après une mise à jour. */
function VersionTag() {
  const { data } = useQuery(versionQuery);
  return data ? <p className="mt-auto px-5 py-3 text-xs text-brand-100/50">{formatVersion(data)}</p> : null;
}

function Brand() {
  return (
    <div className="flex h-16 items-center gap-2 border-b border-brand-800 px-5">
      <FlaskConical className="size-6 text-brand-100" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-white">SIL Laboratoire</p>
        <p className="text-xs text-brand-100/70">ISO 15189</p>
      </div>
    </div>
  );
}
