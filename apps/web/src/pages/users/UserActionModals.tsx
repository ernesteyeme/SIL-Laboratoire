import { zodResolver } from '@hookform/resolvers/zod';
import { Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  resetPasswordSchema,
  userStatusChangeSchema,
  type ResetPasswordInput,
  type UserDto,
  type UserStatusChangeInput,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { useResetPassword, useUserStatusAction, type StatusAction } from '@/features/users';
import { applyApiFieldErrors, errorMessage, generateTemporaryPassword } from '@/lib/utils';

interface BaseProps {
  user: UserDto | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ResetPasswordModal({ user, onClose, onDone }: BaseProps) {
  const reset = useResetPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { temporaryPassword: '', reason: '' },
  });
  const { register, handleSubmit, setValue, setError, formState } = form;

  useEffect(() => {
    if (user) {
      form.reset({ temporaryPassword: generateTemporaryPassword(), reason: '' });
      setFormError(null);
    }
  }, [user, form]);

  const onSubmit = handleSubmit(async (values) => {
    if (!user) return;
    setFormError(null);
    try {
      await reset.mutateAsync({ id: user.id, body: values });
      onDone(
        `Mot de passe de « ${user.username} » réinitialisé. Ses sessions ont été fermées ; communiquez-lui le mot de passe temporaire.`,
      );
      onClose();
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, ['temporaryPassword', 'reason'])) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Réinitialiser le mot de passe de « ${user?.username ?? ''} »`}
      description="L’utilisateur devra choisir un nouveau mot de passe à sa prochaine connexion."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="reset-password-form" loading={reset.isPending}>
            Réinitialiser
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="flex items-start gap-2">
          <TextField
            label="Mot de passe temporaire"
            required
            autoComplete="off"
            className="font-mono"
            containerClassName="flex-1"
            error={formState.errors.temporaryPassword?.message}
            {...register('temporaryPassword')}
          />
          <Button
            variant="secondary"
            icon={Wand2}
            className="mt-6"
            aria-label="Générer un mot de passe"
            onClick={() => setValue('temporaryPassword', generateTemporaryPassword(), { shouldValidate: true })}
          />
        </div>
        <TextAreaField
          label="Motif"
          required
          placeholder="Ex. : mot de passe oublié, demande vérifiée en personne"
          error={formState.errors.reason?.message}
          {...register('reason')}
        />
      </form>
    </Modal>
  );
}

const STATUS_COPY: Record<StatusAction, { title: string; description: string; confirm: string; done: string; danger: boolean; placeholder: string }> = {
  deactivate: {
    title: 'Désactiver le compte',
    description: 'Le compte ne pourra plus se connecter et ses sessions seront fermées immédiatement. Ses données et son historique sont conservés.',
    confirm: 'Désactiver',
    done: 'désactivé',
    danger: true,
    placeholder: 'Ex. : fin de contrat, mutation',
  },
  reactivate: {
    title: 'Réactiver le compte',
    description: 'L’utilisateur devra changer son mot de passe à la prochaine connexion.',
    confirm: 'Réactiver',
    done: 'réactivé',
    danger: false,
    placeholder: 'Ex. : retour de congé, nouveau contrat',
  },
  unlock: {
    title: 'Déverrouiller le compte',
    description: 'Le compte a été verrouillé après plusieurs échecs de connexion.',
    confirm: 'Déverrouiller',
    done: 'déverrouillé',
    danger: false,
    placeholder: 'Ex. : identité vérifiée par téléphone',
  },
};

export function StatusChangeModal({ user, action, onClose, onDone }: BaseProps & { action: StatusAction | null }) {
  const mutation = useUserStatusAction();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<UserStatusChangeInput>({ resolver: zodResolver(userStatusChangeSchema), defaultValues: { reason: '' } });
  const open = !!user && !!action;
  const copy = action ? STATUS_COPY[action] : STATUS_COPY.deactivate;

  useEffect(() => {
    if (open) {
      form.reset({ reason: '' });
      setFormError(null);
    }
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!user || !action) return;
    setFormError(null);
    try {
      await mutation.mutateAsync({ id: user.id, action, body: values });
      onDone(`Compte « ${user.username} » ${copy.done}.`);
      onClose();
    } catch (error) {
      if (!applyApiFieldErrors(error, form.setError, ['reason'])) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${copy.title} « ${user?.username ?? ''} »`}
      description={copy.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="status-change-form" variant={copy.danger ? 'danger' : 'primary'} loading={mutation.isPending}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <form id="status-change-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextAreaField
          label="Motif (consigné dans la piste d’audit)"
          required
          placeholder={copy.placeholder}
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
      </form>
    </Modal>
  );
}
