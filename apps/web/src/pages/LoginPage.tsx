import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, LogIn } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@lims/shared';
import { CHANGE_PASSWORD_PATH } from '@/auth/RequireAuth';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { formatVersion, setupStatusQuery } from '@/features/setup';
import { errorMessage } from '@/lib/utils';

export function LoginPage() {
  const { status, user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });

  const setup = useQuery({ ...setupStatusQuery, enabled: status !== 'authenticated' });

  if (status === 'loading') return <FullPageSpinner label="Chargement…" />;
  // Premier démarrage : aucun compte n'existe encore, l'assistant d'installation prend la main.
  if (setup.data?.needsSetup) return <Navigate to="/installation" replace />;
  if (status === 'authenticated' && user) {
    return <Navigate to={user.mustChangePassword ? CHANGE_PASSWORD_PATH : from} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const loggedIn = await login(values);
      navigate(loggedIn.mustChangePassword ? CHANGE_PASSWORD_PATH : from, { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center text-white">
          <div className="rounded-xl bg-white/10 p-3">
            <FlaskConical className="size-8" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold">Système d’information de laboratoire</h1>
          <p className="text-sm text-brand-100/80">Connectez-vous pour accéder à votre espace</p>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg bg-white p-6 shadow-xl">
          {formError && <Alert tone="error">{formError}</Alert>}
          <TextField
            label="Identifiant"
            autoComplete="username"
            autoFocus
            required
            error={errors.username?.message}
            {...register('username')}
          />
          <TextField
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />
          <Button type="submit" className="w-full" loading={isSubmitting} icon={LogIn}>
            Se connecter
          </Button>
          <p className="text-center text-xs text-slate-500">
            Accès réservé au personnel autorisé. Toutes les actions sont tracées.
          </p>
        </form>
        {setup.data && <p className="mt-3 text-center text-xs text-brand-100/70">{formatVersion(setup.data)}</p>}
      </div>
    </div>
  );
}
