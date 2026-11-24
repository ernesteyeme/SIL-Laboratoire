import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { changePasswordSchema, PASSWORD_MIN_LENGTH, type ChangePasswordInput } from '@lims/shared';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { Card } from '@/components/ui/PageHeader';
import { applyApiFieldErrors, errorMessage } from '@/lib/utils';

const FIELDS = ['currentPassword', 'newPassword', 'confirmPassword'] as const;

export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const forced = !!user?.mustChangePassword;

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await changePassword(values);
      reset();
      if (forced) {
        navigate('/', { replace: true });
      } else {
        setDone(true);
      }
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, FIELDS)) setFormError(errorMessage(error));
    }
  });

  const form = (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {forced && (
        <Alert tone="warning" title="Changement de mot de passe obligatoire">
          Votre mot de passe est temporaire. Choisissez un mot de passe personnel pour continuer.
        </Alert>
      )}
      {done && <Alert tone="success">Mot de passe modifié. Vos autres sessions ont été fermées.</Alert>}
      {formError && <Alert tone="error">{formError}</Alert>}
      <TextField
        label={forced ? 'Mot de passe temporaire' : 'Mot de passe actuel'}
        type="password"
        autoComplete="current-password"
        required
        error={errors.currentPassword?.message}
        {...register('currentPassword')}
      />
      <TextField
        label="Nouveau mot de passe"
        type="password"
        autoComplete="new-password"
        required
        hint={`Au moins ${PASSWORD_MIN_LENGTH} caractères, avec majuscule, minuscule, chiffre et caractère spécial.`}
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <TextField
        label="Confirmation du nouveau mot de passe"
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
      <div className="flex items-center justify-between gap-2 pt-2">
        {forced ? (
          <Button
            variant="ghost"
            icon={LogOut}
            onClick={async () => {
              await logout();
              navigate('/connexion', { replace: true });
            }}
          >
            Se déconnecter
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={isSubmitting} icon={KeyRound}>
          Enregistrer
        </Button>
      </div>
    </form>
  );

  if (forced) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-100 px-4 py-12">
        <Card className="w-full max-w-md p-6">
          <h1 className="mb-1 text-lg font-semibold text-slate-900">Bienvenue, {user?.fullName}</h1>
          <p className="mb-5 text-sm text-slate-500">Sécurisez votre compte avant votre première utilisation.</p>
          {form}
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Changer mon mot de passe</h1>
      <Card className="p-6">{form}</Card>
    </div>
  );
}
