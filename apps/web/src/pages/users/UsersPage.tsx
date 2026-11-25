import { KeyRound, Lock, Pencil, Plus, RotateCcw, Search, Unlock, UserX, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isSectionScoped, ROLE_LABELS, ROLES, type Role, type UserDto } from '@lims/shared';
import { useQuery } from '@tanstack/react-query';
import { sectionsQuery } from '@/features/catalog';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useUsers, type StatusAction, type UsersFilter } from '@/features/users';
import { errorMessage, formatDateTime } from '@/lib/utils';
import { ResetPasswordModal, StatusChangeModal } from './UserActionModals';
import { UserFormModal } from './UserFormModal';

export function UsersPage() {
  const { user: me } = useAuth();
  const [filter, setFilter] = useState<UsersFilter>({ page: 1, pageSize: 20, search: '', role: '', sectionId: '', status: 'active' });
  const [searchInput, setSearchInput] = useState('');
  const { data: sections } = useQuery(sectionsQuery);
  const [notice, setNotice] = useState<string | null>(null);
  const [formUser, setFormUser] = useState<UserDto | null | undefined>(undefined);
  const [resetUser, setResetUser] = useState<UserDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ user: UserDto; action: StatusAction } | null>(null);

  // Recherche avec temporisation pour éviter une requête à chaque frappe.
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.search === searchInput ? f : { ...f, search: searchInput, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error, isFetching } = useUsers(filter);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Utilisateurs"
        description="Comptes du personnel et attribution des rôles. Chaque modification est tracée."
        actions={
          <Button icon={Plus} onClick={() => setFormUser(null)}>
            Nouvel utilisateur
          </Button>
        }
      />

      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}

      <Card>
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_200px_180px]">
          <div className="relative">
            <TextField
              label="Rechercher"
              placeholder="Nom, identifiant ou e-mail"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
          </div>
          <SelectField
            label="Rôle"
            value={filter.role}
            onChange={(e) => setFilter((f) => ({ ...f, role: e.target.value as Role | '', page: 1 }))}
          >
            <option value="">Tous les rôles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Service"
            value={filter.sectionId}
            onChange={(e) => setFilter((f) => ({ ...f, sectionId: e.target.value, page: 1 }))}
          >
            <option value="">Tous les services</option>
            {(sections ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Statut"
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as UsersFilter['status'], page: 1 }))}
          >
            <option value="active">Actifs</option>
            <option value="inactive">Désactivés</option>
            <option value="all">Tous</option>
          </SelectField>
        </div>

        {isLoading ? (
          <LoadingBlock />
        ) : isError ? (
          <div className="p-4">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={Users} title="Aucun utilisateur trouvé">
            Modifiez les filtres ou créez un nouveau compte.
          </EmptyState>
        ) : (
          <>
            <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Utilisateur</th>
                    <th className="px-4 py-3">Rôles</th>
                    <th className="px-4 py-3">Services</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Dernière connexion</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((u) => (
                    <tr key={u.id} className={u.isActive ? '' : 'bg-slate-50/60 text-slate-500'}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{u.fullName}</p>
                        <p className="text-xs text-slate-500">
                          {u.username}
                          {u.email && ` · ${u.email}`}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r} tone={r === 'ADMIN' ? 'info' : 'neutral'}>
                              {ROLE_LABELS[r]}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {isSectionScoped(u.roles) ? (
                          u.sections.length > 0 ? (
                            u.sections.map((s) => s.name).join(', ')
                          ) : (
                            <span className="text-amber-700">Aucun service</span>
                          )
                        ) : (
                          <span className="text-slate-400">Tous (rôle non limité)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.isActive ? <Badge tone="success">Actif</Badge> : <Badge tone="danger">Désactivé</Badge>}
                          {u.isLocked && (
                            <Badge tone="warning">
                              <Lock className="mr-1 size-3" aria-hidden />
                              Verrouillé
                            </Badge>
                          )}
                          {u.isActive && u.mustChangePassword && <Badge tone="neutral">Mot de passe temporaire</Badge>}
                        </div>
                        {!u.isActive && u.deactivationReason && (
                          <p className="mt-1 text-xs text-slate-500" title={u.deactivationReason}>
                            {u.deactivationReason}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(u.lastLoginAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <IconAction label="Modifier" icon={Pencil} onClick={() => setFormUser(u)} />
                          {u.isActive && u.id !== me?.id && (
                            <IconAction label="Réinitialiser le mot de passe" icon={KeyRound} onClick={() => setResetUser(u)} />
                          )}
                          {u.isLocked && (
                            <IconAction label="Déverrouiller" icon={Unlock} onClick={() => setStatusTarget({ user: u, action: 'unlock' })} />
                          )}
                          {u.isActive && u.id !== me?.id && (
                            <IconAction
                              label="Désactiver"
                              icon={UserX}
                              danger
                              onClick={() => setStatusTarget({ user: u, action: 'deactivate' })}
                            />
                          )}
                          {!u.isActive && (
                            <IconAction
                              label="Réactiver"
                              icon={RotateCcw}
                              onClick={() => setStatusTarget({ user: u, action: 'reactivate' })}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              onChange={(page) => setFilter((f) => ({ ...f, page }))}
            />
          </>
        )}
      </Card>

      <UserFormModal
        open={formUser !== undefined}
        user={formUser ?? null}
        onClose={() => setFormUser(undefined)}
        onSaved={setNotice}
      />
      <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} onDone={setNotice} />
      <StatusChangeModal
        user={statusTarget?.user ?? null}
        action={statusTarget?.action ?? null}
        onClose={() => setStatusTarget(null)}
        onDone={setNotice}
      />
    </div>
  );
}

function IconAction({
  label,
  icon: Icon,
  onClick,
  danger,
}: {
  label: string;
  icon: typeof Pencil;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-md p-1.5 ${danger ? 'text-red-500 hover:bg-red-50' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
    >
      <Icon className="size-4" />
    </button>
  );
}
