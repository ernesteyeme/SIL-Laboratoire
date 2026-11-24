import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, FlaskConical, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SETUP_TIMEZONES, setupAdminSchema, setupLabSchema, type SetupResultDto, type SetupCheckStatus } from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert, LoadingBlock } from '@/components/ui/feedback';
import { formatVersion, setupStatusQuery, useCompleteSetup, useVerifySetupToken } from '@/features/setup';
import { ApiError } from '@/lib/api';
import { cn, errorMessage, zodFieldErrors } from '@/lib/utils';

const STEPS = ['Vérification', 'Laboratoire', 'Administrateur'] as const;
const CHECK_ICON: Record<SetupCheckStatus, typeof CircleCheck> = { PASS: CircleCheck, WARN: TriangleAlert, FAIL: CircleX };
const CHECK_TONE: Record<SetupCheckStatus, string> = { PASS: 'text-emerald-600', WARN: 'text-amber-600', FAIL: 'text-red-600' };

/**
 * Assistant du premier démarrage, à la manière d'InteLIS : vérification du serveur, paramètres du
 * laboratoire, premier administrateur. Disponible tant qu'aucun compte n'existe.
 */
export function SetupPage() {
  const status = useQuery(setupStatusQuery);
  const qc = useQueryClient();
  const verify = useVerifySetupToken();
  const complete = useCompleteSetup();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState('');
  const [lab, setLab] = useState({
    name: '',
    shortName: '',
    city: 'Kinshasa',
    country: 'République démocratique du Congo',
    phone: '',
    email: '',
    timezone: 'Africa/Kinshasa' as (typeof SETUP_TIMEZONES)[number],
    currency: 'CDF' as 'CDF' | 'USD',
    secondaryCurrencyEnabled: true,
  });
  const [loadCatalog, setLoadCatalog] = useState(true);
  const [admin, setAdmin] = useState({ username: 'admin', fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<SetupResultDto | null>(null);

  if (status.isLoading) return <Shell><LoadingBlock label="Vérification du serveur…" /></Shell>;
  if (status.isError) {
    return (
      <Shell>
        <Alert tone="error" title="Le serveur ne répond pas">
          {errorMessage(status.error)} Sur le serveur, lancez « lims doctor ».
        </Alert>
      </Shell>
    );
  }
  const s = status.data!;
  if (!s.needsSetup && !done && !complete.isSuccess) {
    return (
      <Shell version={formatVersion(s)}>
        <Alert tone="info" title="Installation déjà terminée">
          Un compte existe déjà sur ce serveur.
        </Alert>
        <Link to="/connexion" className="mt-4 inline-block text-sm font-medium text-brand-700 underline">
          Aller à la page de connexion
        </Link>
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell version={formatVersion(s)}>
        <Alert tone="success" title="Installation terminée">
          Laboratoire « {done.labName} » configuré. Administrateur « {done.adminUsername} » créé.
          {done.catalogItemsCreated > 0 && ` Catalogue de démarrage : ${done.catalogItemsCreated} éléments (tarifs et valeurs de référence à valider par le biologiste).`}
        </Alert>
        <Link
          to="/connexion"
          className="mt-4 inline-flex h-10 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800"
        >
          Se connecter
        </Link>
      </Shell>
    );
  }

  const blocking = s.checks.some((c) => c.status === 'FAIL');
  const labText = (k: 'name' | 'shortName' | 'city' | 'country' | 'phone' | 'email') => ({
    value: lab[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLab((l) => ({ ...l, [k]: e.target.value })),
    error: errors[k],
  });
  const adminText = (k: keyof typeof admin) => ({
    value: admin[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAdmin((a) => ({ ...a, [k]: e.target.value })),
    error: errors[k],
  });

  const next = async () => {
    setFormError(null);
    setErrors({});
    if (step === 0) {
      try {
        await verify.mutateAsync(token);
        setStep(1);
      } catch (err) {
        setErrors({ token: errorMessage(err) });
      }
      return;
    }
    if (step === 1) {
      const parsed = setupLabSchema.safeParse(lab);
      if (!parsed.success) return setErrors(zodFieldErrors(parsed.error.issues));
      setStep(2);
      return;
    }
    const parsedAdmin = setupAdminSchema.safeParse(admin);
    if (!parsedAdmin.success) return setErrors(zodFieldErrors(parsedAdmin.error.issues));
    try {
      const result = await complete.mutateAsync({ token, lab: setupLabSchema.parse(lab), admin: parsedAdmin.data, loadStarterCatalog: loadCatalog });
      // La page de connexion ne doit plus renvoyer vers l'assistant.
      qc.setQueryData(setupStatusQuery.queryKey, (old) => (old ? { ...old, needsSetup: false } : old));
      setDone(result);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path.replace(/^(admin|lab)\./, ''), f.message])));
      setFormError(errorMessage(err));
    }
  };

  return (
    <Shell version={formatVersion(s)}>
      <ol className="mb-6 flex gap-2" aria-label="Étapes">
        {STEPS.map((label, i) => (
          <li key={label} className={cn('flex-1 border-t-4 pt-2 text-xs font-medium', i <= step ? 'border-brand-700 text-brand-800' : 'border-slate-200 text-slate-400')} aria-current={i === step ? 'step' : undefined}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {formError && (
        <Alert tone="error" className="mb-4">
          {formError}
        </Alert>
      )}

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
            {s.checks.map((c) => {
              const Icon = CHECK_ICON[c.status];
              return (
                <li key={c.label} className="flex items-start gap-3 px-3 py-2">
                  <Icon className={cn('mt-0.5 size-4 shrink-0', CHECK_TONE[c.status])} aria-label={c.status} />
                  <span>
                    <span className="font-medium text-slate-800">{c.label}</span>
                    <span className="block text-xs text-slate-500">{c.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <TextField
            label="Code d’installation"
            required
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            hint="Affiché à la fin de l’installation. Sur le serveur : sudo lims setup-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            error={errors.token}
          />
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nom du laboratoire" required containerClassName="sm:col-span-2" placeholder="Laboratoire de biologie médicale de …" {...labText('name')} />
          <TextField label="Sigle" {...labText('shortName')} />
          <TextField label="Téléphone" {...labText('phone')} />
          <TextField label="Ville" {...labText('city')} />
          <TextField label="Pays" {...labText('country')} />
          <TextField label="E-mail" type="email" containerClassName="sm:col-span-2" {...labText('email')} />
          <SelectField label="Fuseau horaire" value={lab.timezone} onChange={(e) => setLab((l) => ({ ...l, timezone: e.target.value as (typeof SETUP_TIMEZONES)[number] }))} hint="Kinshasa : UTC+1 · Lubumbashi : UTC+2">
            {SETUP_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </SelectField>
          <SelectField label="Devise de base" value={lab.currency} onChange={(e) => setLab((l) => ({ ...l, currency: e.target.value as 'CDF' | 'USD' }))}>
            <option value="CDF">Franc congolais (CDF)</option>
            <option value="USD">Dollar américain (USD)</option>
          </SelectField>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-brand-700" checked={lab.secondaryCurrencyEnabled} onChange={(e) => setLab((l) => ({ ...l, secondaryCurrencyEnabled: e.target.checked }))} />
            Caisse bi-devise CDF / USD (taux du jour)
          </label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={loadCatalog} onChange={(e) => setLoadCatalog(e.target.checked)} />
            <span>
              Charger le catalogue de démarrage (hématologie, biochimie, CD4, charge virale VIH, EID…)
              <span className="block text-xs text-slate-500">Tarifs et valeurs de référence indicatifs, à valider par le biologiste responsable.</span>
            </span>
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Identifiant" required autoComplete="username" {...adminText('username')} />
          <TextField label="Nom complet" required {...adminText('fullName')} />
          <TextField label="E-mail" type="email" containerClassName="sm:col-span-2" {...adminText('email')} />
          <TextField label="Mot de passe" type="password" required autoComplete="new-password" hint="10 caractères au moins : majuscule, minuscule, chiffre et caractère spécial." {...adminText('password')} />
          <TextField label="Confirmation" type="password" required autoComplete="new-password" {...adminText('confirmPassword')} />
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep((x) => x - 1)}>
          Précédent
        </Button>
        <Button onClick={next} loading={verify.isPending || complete.isPending} disabled={step === 0 && (blocking || !token.trim())}>
          {step === 2 ? 'Terminer' : 'Suivant'}
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ children, version }: { children: React.ReactNode; version?: string }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-3 text-white">
          <div className="rounded-xl bg-white/10 p-3">
            <FlaskConical className="size-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Installation du système d’information de laboratoire</h1>
            <p className="text-sm text-brand-100/80">Premier démarrage — ces informations restent modifiables ensuite dans Paramètres.</p>
          </div>
        </div>
        <div className="rounded-lg bg-white p-6 shadow-xl">{children}</div>
        {version && <p className="mt-3 text-center text-xs text-brand-100/70">{version}</p>}
      </div>
    </div>
  );
}
