import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROLE_LABELS } from '@lims/shared';
import { NAV_ITEMS, canAccess } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { Badge } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { settingsQuery } from '@/features/settings';

export function DashboardPage() {
  const { user } = useAuth();
  const settings = useQuery(settingsQuery);
  if (!user) return null;

  const modules = NAV_ITEMS.filter((i) => i.to !== '/' && canAccess(i, user.roles));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Bonjour, ${user.fullName}`} description="Bienvenue dans le système d’information du laboratoire." />

      <Card className="mb-6 flex flex-wrap items-center gap-4 p-5">
        <Building2 className="size-8 text-brand-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{settings.data?.name ?? '…'}</p>
          <p className="text-sm text-slate-500">
            {[settings.data?.city, settings.data?.country].filter(Boolean).join(', ') || 'Adresse non renseignée'}
            {settings.data?.accreditationNumber && ` · Accréditation ${settings.data.accreditationNumber}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {user.roles.map((r) => (
            <Badge key={r} tone="brand">
              {ROLE_LABELS[r]}
            </Badge>
          ))}
        </div>
      </Card>

      {modules.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map(({ to, label, icon: Icon, description }) => (
            <Link key={to} to={to} className="group">
              <Card className="flex items-center gap-4 p-5 transition-shadow group-hover:shadow-md">
                <div className="rounded-md bg-brand-50 p-2.5 text-brand-700">
                  <Icon className="size-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{label}</p>
                  <p className="text-sm text-slate-500">{description}</p>
                </div>
                <ChevronRight className="size-4 text-slate-300 group-hover:text-brand-700" aria-hidden />
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-sm text-slate-500">
          Les modules métier de votre profil (réception, caisse, paillasse, validation…) seront disponibles dans les
          prochaines versions.
        </Card>
      )}
    </div>
  );
}
