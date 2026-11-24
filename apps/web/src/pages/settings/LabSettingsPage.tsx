import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { labSettingsSchema, type LabSettingsDto, type LabSettingsInput } from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, LoadingBlock } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/PageHeader';
import { settingsQuery, useUpdateSettings } from '@/features/settings';
import { applyApiFieldErrors, errorMessage, formatDateTime } from '@/lib/utils';

const FIELDS = [
  'name',
  'shortName',
  'address',
  'city',
  'country',
  'phone',
  'email',
  'accreditationNumber',
  'accreditationBody',
  'directorName',
  'reportFooter',
  'currency',
  'timezone',
  'requirePaymentBeforeCollection',
  'secondaryCurrencyEnabled',
] as const;

function toFormValues(s: LabSettingsDto): LabSettingsInput {
  return {
    name: s.name,
    shortName: s.shortName ?? '',
    address: s.address ?? '',
    city: s.city ?? '',
    country: s.country ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    accreditationNumber: s.accreditationNumber ?? '',
    accreditationBody: s.accreditationBody ?? '',
    directorName: s.directorName ?? '',
    reportFooter: s.reportFooter ?? '',
    currency: s.currency,
    timezone: s.timezone,
    requirePaymentBeforeCollection: s.requirePaymentBeforeCollection,
    secondaryCurrencyEnabled: s.secondaryCurrencyEnabled,
  };
}

export function LabSettingsPage() {
  const { data, isLoading, isError, error } = useQuery(settingsQuery);
  const save = useUpdateSettings();
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<LabSettingsInput>({ resolver: zodResolver(labSettingsSchema) });

  useEffect(() => {
    if (data) reset(toFormValues(data));
  }, [data, reset]);

  if (isLoading) return <LoadingBlock />;
  if (isError || !data) return <Alert tone="error">{errorMessage(error)}</Alert>;

  const onSubmit = handleSubmit(async (values) => {
    setNotice(null);
    setFormError(null);
    try {
      const saved = await save.mutateAsync(values);
      reset(toFormValues(saved));
      setNotice('Paramètres enregistrés.');
    } catch (err) {
      if (!applyApiFieldErrors(err, setError, FIELDS)) setFormError(errorMessage(err));
    }
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Paramètres du laboratoire"
        description={`Ces informations figurent sur les comptes rendus et les factures. Dernière modification : ${formatDateTime(data.updatedAt)}.`}
      />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Identité</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Raison sociale" required error={errors.name?.message} containerClassName="sm:col-span-2" {...register('name')} />
            <TextField label="Nom court / sigle" error={errors.shortName?.message} {...register('shortName')} />
            <TextField label="Biologiste responsable" error={errors.directorName?.message} {...register('directorName')} />
            <TextField label="Adresse" error={errors.address?.message} containerClassName="sm:col-span-2" {...register('address')} />
            <TextField label="Ville" error={errors.city?.message} {...register('city')} />
            <TextField label="Pays" error={errors.country?.message} {...register('country')} />
            <TextField label="Téléphone" type="tel" error={errors.phone?.message} {...register('phone')} />
            <TextField label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Accréditation</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="N° d’accréditation" error={errors.accreditationNumber?.message} {...register('accreditationNumber')} />
            <TextField label="Organisme accréditeur" error={errors.accreditationBody?.message} {...register('accreditationBody')} />
            <TextAreaField
              label="Pied de page des comptes rendus"
              error={errors.reportFooter?.message}
              containerClassName="sm:col-span-2"
              {...register('reportFooter')}
            />
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Régionalisation</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Devise (ISO 4217)" required maxLength={3} hint="Ex. CDF, USD. Changer la devise ne convertit pas les tarifs existants du catalogue." error={errors.currency?.message} {...register('currency')} />
            <TextField label="Fuseau horaire (IANA)" required hint="Ex. Africa/Kinshasa, Africa/Lubumbashi" error={errors.timezone?.message} {...register('timezone')} />
          </div>
        </Card>

        {formError && <Alert tone="error">{formError}</Alert>}
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Accueil et caisse</h2>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" {...register('requirePaymentBeforeCollection')} />
            <span>
              <span className="font-medium text-slate-800">Exiger le paiement avant le prélèvement</span>
              <span className="block text-slate-500">
                La part patient doit être entièrement réglée pour enregistrer un prélèvement. Les demandes urgentes en sont dispensées.
              </span>
            </span>
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" {...register('secondaryCurrencyEnabled')} />
            <span>
              <span className="font-medium text-slate-800">Caisse bi-devise CDF / USD</span>
              <span className="block text-slate-500">
                Les tarifs restent dans la devise de base ; l’autre devise est acceptée à la caisse au taux du jour, saisi par un
                administrateur ou le comptable. Les fonds et comptages de caisse sont tenus séparément pour chaque devise.
              </span>
              {errors.secondaryCurrencyEnabled?.message && <span className="block text-red-700">{errors.secondaryCurrencyEnabled.message}</span>}
            </span>
          </label>
        </Card>

        <div className="flex items-center justify-end gap-4">
          {notice && !isDirty && <p className="text-sm text-emerald-700" role="status">{notice}</p>}
          <Button type="submit" icon={Save} loading={save.isPending} disabled={!isDirty}>
            Enregistrer
          </Button>
        </div>
      </form>
    </div>
  );
}
