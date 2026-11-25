import { zodResolver } from '@hookform/resolvers/zod';
import { Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  createUserSchema,
  isSectionScoped,
  PASSWORD_MIN_LENGTH,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
  type UserDto,
} from '@lims/shared';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { useCreateUser, useUpdateUser } from '@/features/users';
import { applyApiFieldErrors, errorMessage, generateTemporaryPassword } from '@/lib/utils';
import { RoleCheckboxes } from './RoleCheckboxes';
import { SectionCheckboxes } from './SectionCheckboxes';

interface Props {
  open: boolean;
  user: UserDto | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function UserFormModal({ open, user, onClose, onSaved }: Props) {
  return user ? (
    <EditUserForm open={open} user={user} onClose={onClose} onSaved={onSaved} />
  ) : (
    <CreateUserForm open={open} onClose={onClose} onSaved={onSaved} />
  );
}

const CREATE_FIELDS = ['username', 'fullName', 'email', 'roles', 'sectionIds', 'temporaryPassword'] as const;

function CreateUserForm({ open, onClose, onSaved }: Omit<Props, 'user'>) {
  const create = useCreateUser();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    reset,
    watch,
    formState: { errors },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { username: '', fullName: '', email: '', roles: [], sectionIds: [], temporaryPassword: '' },
  });
  const scoped = isSectionScoped(watch('roles') ?? []);

  useEffect(() => {
    if (open) {
      reset({ username: '', fullName: '', email: '', roles: [], sectionIds: [], temporaryPassword: generateTemporaryPassword() });
      setFormError(null);
    }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const created = await create.mutateAsync({ ...values, sectionIds: isSectionScoped(values.roles) ? values.sectionIds : [] });
      onSaved(
        `Compte « ${created.username} » créé. Communiquez-lui le mot de passe temporaire : il devra le changer à la première connexion.`,
      );
      onClose();
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, CREATE_FIELDS)) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Nouvel utilisateur"
      description="Le mot de passe temporaire devra être changé à la première connexion."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="create-user-form" loading={create.isPending}>
            Créer le compte
          </Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Identifiant"
            required
            autoComplete="off"
            hint="Minuscules, chiffres, . - _"
            error={errors.username?.message}
            {...register('username')}
          />
          <TextField label="Nom complet" required error={errors.fullName?.message} {...register('fullName')} />
          <TextField label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
          <div className="flex items-end gap-2">
            <TextField
              label="Mot de passe temporaire"
              required
              autoComplete="off"
              containerClassName="flex-1"
              className="font-mono"
              hint={`${PASSWORD_MIN_LENGTH} caractères minimum`}
              error={errors.temporaryPassword?.message}
              {...register('temporaryPassword')}
            />
            <Button
              variant="secondary"
              icon={Wand2}
              title="Générer un mot de passe"
              aria-label="Générer un mot de passe"
              className="mb-5"
              onClick={() => setValue('temporaryPassword', generateTemporaryPassword(), { shouldValidate: true })}
            />
          </div>
        </div>
        <Controller
          control={control}
          name="roles"
          render={({ field }) => (
            <RoleCheckboxes value={field.value} onChange={field.onChange} error={errors.roles?.message} />
          )}
        />
        {scoped && (
          <Controller
            control={control}
            name="sectionIds"
            render={({ field }) => <SectionCheckboxes value={field.value ?? []} onChange={field.onChange} error={errors.sectionIds?.message} />}
          />
        )}
      </form>
    </Modal>
  );
}

const EDIT_FIELDS = ['fullName', 'email', 'roles', 'sectionIds'] as const;

function EditUserForm({ open, user, onClose, onSaved }: Props & { user: UserDto }) {
  const { user: me } = useAuth();
  const update = useUpdateUser();
  const [formError, setFormError] = useState<string | null>(null);
  const isSelf = me?.id === user.id;

  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { fullName: user.fullName, email: user.email ?? '', roles: user.roles, sectionIds: user.sections.map((s) => s.id) },
  });
  const scoped = isSectionScoped(watch('roles') ?? user.roles);

  useEffect(() => {
    if (open) {
      reset({ fullName: user.fullName, email: user.email ?? '', roles: user.roles, sectionIds: user.sections.map((s) => s.id) });
      setFormError(null);
    }
  }, [open, user, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const roles = values.roles ?? user.roles;
      await update.mutateAsync({ id: user.id, body: { ...values, sectionIds: isSectionScoped(roles) ? (values.sectionIds ?? []) : [] } });
      onSaved(`Compte « ${user.username} » mis à jour.`);
      onClose();
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, EDIT_FIELDS)) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Modifier « ${user.username} »`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="edit-user-form" loading={update.isPending} disabled={!isDirty}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Identifiant" value={user.username} disabled readOnly />
          <TextField label="Nom complet" required error={errors.fullName?.message} {...register('fullName')} />
          <TextField label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
        </div>
        <Controller
          control={control}
          name="roles"
          render={({ field }) => (
            <RoleCheckboxes
              value={field.value ?? []}
              onChange={field.onChange}
              error={errors.roles?.message}
              disabledRoles={isSelf ? ['ADMIN'] : []}
            />
          )}
        />
        {scoped && (
          <Controller
            control={control}
            name="sectionIds"
            render={({ field }) => <SectionCheckboxes value={field.value ?? []} onChange={field.onChange} error={errors.sectionIds?.message} />}
          />
        )}
        {isSelf && (
          <p className="text-xs text-slate-500">Vous ne pouvez pas retirer votre propre rôle Administrateur.</p>
        )}
      </form>
    </Modal>
  );
}
