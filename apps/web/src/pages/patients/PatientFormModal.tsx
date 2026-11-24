import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, Hash, UserRoundSearch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  birthDateFromAge,
  computeAge,
  createPatientSchema,
  ERROR_CODES,
  SEX_LABELS,
  SEXES,
  todayIso,
  updatePatientSchema,
  type CreatePatientInput,
  type DuplicateCandidate,
  type PatientDto,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Badge, Spinner } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { checkDuplicates, useCreatePatient, useUpdatePatient } from '@/features/patients';
import { ApiError } from '@/lib/api';
import { applyApiFieldErrors, cn, errorMessage, formatDate } from '@/lib/utils';

interface Props {
  open: boolean;
  patient: PatientDto | null;
  onClose: () => void;
  onSaved: (patient: PatientDto, created: boolean) => void;
  onOpenExisting: (patient: PatientDto) => void;
}

type FormValues = Omit<CreatePatientInput, 'confirmNotDuplicate'>;

const FIELDS = ['lastName', 'middleName', 'firstName', 'sex', 'birthDate', 'phone', 'email', 'address', 'city', 'externalId', 'notes'] as const;

function emptyValues(p: PatientDto | null): FormValues {
  return {
    lastName: p?.lastName ?? '',
    middleName: p?.middleName ?? '',
    firstName: p?.firstName ?? '',
    sex: p?.sex ?? ('' as FormValues['sex']),
    birthDate: p?.birthDate ?? '',
    birthDateEstimated: p?.birthDateEstimated ?? false,
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    address: p?.address ?? '',
    city: p?.city ?? '',
    externalId: p?.externalId ?? '',
    notes: p?.notes ?? '',
  };
}

export function PatientFormModal({ open, patient, onClose, onSaved, onOpenExisting }: Props) {
  const isEdit = !!patient;
  const create = useCreatePatient();
  const update = useUpdatePatient();
  const [formError, setFormError] = useState<string | null>(null);
  const [ageMode, setAgeMode] = useState<'date' | 'age'>('date');
  const [ageYears, setAgeYears] = useState('');
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const [confirmNotDuplicate, setConfirmNotDuplicate] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(isEdit ? (updatePatientSchema as never) : (createPatientSchema as never)),
    defaultValues: emptyValues(patient),
  });
  const { register, handleSubmit, setError, setValue, reset, control, formState: { errors } } = form;

  useEffect(() => {
    if (!open) return;
    reset(emptyValues(patient));
    setAgeMode(patient?.birthDateEstimated ? 'age' : 'date');
    setAgeYears(patient?.birthDate && patient.birthDateEstimated ? String(computeAge(patient.birthDate).years) : '');
    setCandidates([]);
    setConfirmNotDuplicate(false);
    setFormError(null);
  }, [open, patient, reset]);

  // Âge approximatif → date de naissance estimée.
  useEffect(() => {
    if (ageMode !== 'age') return;
    const years = Number(ageYears);
    if (ageYears !== '' && Number.isInteger(years) && years >= 0 && years <= 130) {
      setValue('birthDate', birthDateFromAge(years));
      setValue('birthDateEstimated', true);
    } else {
      setValue('birthDate', '');
      setValue('birthDateEstimated', false);
    }
  }, [ageMode, ageYears, setValue]);

  const watched = useWatch({ control, name: ['lastName', 'middleName', 'firstName', 'sex', 'birthDate', 'phone', 'externalId'] });
  const [lastName, middleName, firstName, sex, birthDate, phone, externalId] = watched;
  const checkKey = JSON.stringify(watched);

  // Détection des doublons pendant la saisie (création uniquement), avec temporisation.
  useEffect(() => {
    if (!open || isEdit) return;
    const hasName = (lastName ?? '').trim().length >= 2 && ((middleName ?? '').trim() || (firstName ?? '').trim());
    const hasStrongKey = (phone ?? '').replace(/\D/g, '').length >= 6 || (externalId ?? '').trim().length >= 2;
    if (!hasName && !hasStrongKey) {
      setCandidates([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const result = await checkDuplicates(
          {
            lastName: (lastName ?? '').trim() || '-',
            middleName: middleName || null,
            firstName: firstName || null,
            sex: sex || undefined,
            birthDate: birthDate || null,
            phone: phone || null,
            externalId: externalId || null,
          },
          controller.signal,
        );
        setCandidates(result);
        setConfirmNotDuplicate(false);
      } catch {
        // Contrôle indicatif : une erreur ici n'empêche pas la saisie (le serveur revérifie à l'enregistrement).
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 450);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey, open, isEdit]);

  const agePreview = useMemo(() => {
    if (!birthDate || birthDate > todayIso() || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
    return computeAge(birthDate).label;
  }, [birthDate]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (!isEdit && candidates.length > 0 && !confirmNotDuplicate) {
      setFormError('Des dossiers ressemblants existent : ouvrez le bon dossier ou confirmez qu’il s’agit d’un nouveau patient.');
      return;
    }
    try {
      if (isEdit && patient) {
        const saved = await update.mutateAsync({ id: patient.id, body: values });
        onSaved(saved, false);
      } else {
        const saved = await create.mutateAsync({ ...values, confirmNotDuplicate } as CreatePatientInput);
        onSaved(saved, true);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === ERROR_CODES.DUPLICATE_SUSPECTED) {
        const found = (error.details as { candidates?: DuplicateCandidate[] } | undefined)?.candidates ?? [];
        setCandidates(found);
        setConfirmNotDuplicate(false);
        setFormError(error.message);
        return;
      }
      if (!applyApiFieldErrors(error, setError, FIELDS)) setFormError(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? `Modifier le dossier ${patient?.code}` : 'Nouveau patient'}
      description={isEdit ? 'Chaque modification est tracée.' : 'Le code patient est attribué automatiquement à l’enregistrement.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="patient-form" loading={create.isPending || update.isPending}>
            {isEdit ? 'Enregistrer' : 'Créer le dossier'}
          </Button>
        </>
      }
    >
      <form id="patient-form" onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert tone={candidates.length > 0 ? 'warning' : 'error'}>{formError}</Alert>}

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-700">Identité</legend>
          <TextField label="Nom" required autoFocus error={errors.lastName?.message} {...register('lastName')} />
          <TextField label="Postnom" error={errors.middleName?.message} {...register('middleName')} />
          <TextField label="Prénom" error={errors.firstName?.message} {...register('firstName')} />
          <SelectField label="Sexe" required error={errors.sex?.message} {...register('sex')}>
            <option value="">— Choisir —</option>
            {SEXES.map((s) => (
              <option key={s} value={s}>
                {SEX_LABELS[s]}
              </option>
            ))}
          </SelectField>

          <div className="sm:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Naissance</span>
              <div className="flex rounded-md border border-slate-300 p-0.5 text-xs">
                {(['date', 'age'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setAgeMode(m);
                      if (m === 'date') {
                        setValue('birthDateEstimated', false);
                      }
                    }}
                    className={cn('flex items-center gap-1 rounded px-2 py-1', ageMode === m ? 'bg-brand-700 text-white' : 'text-slate-600')}
                  >
                    {m === 'date' ? <CalendarDays className="size-3" /> : <Hash className="size-3" />}
                    {m === 'date' ? 'Date connue' : 'Âge seulement'}
                  </button>
                ))}
              </div>
            </div>
            {ageMode === 'date' ? (
              <TextField
                key="birth-date"
                label="Date de naissance"
                type="date"
                max={todayIso()}
                hint={agePreview ? `Âge : ${agePreview}` : undefined}
                error={errors.birthDate?.message}
                {...register('birthDate')}
              />
            ) : (
              <TextField
                key="age-years"
                label="Âge approximatif (années)"
                type="number"
                min={0}
                max={130}
                value={ageYears}
                onChange={(e) => setAgeYears(e.target.value)}
                hint={birthDate ? `Date estimée : ${formatDate(birthDate)}` : 'La date de naissance sera estimée.'}
                error={errors.birthDate?.message}
              />
            )}
          </div>
        </fieldset>

        {!isEdit && (checking || candidates.length > 0) && (
          <DuplicatePanel
            candidates={candidates}
            checking={checking}
            confirmed={confirmNotDuplicate}
            onConfirmChange={setConfirmNotDuplicate}
            onOpen={(p) => {
              onOpenExisting(p);
              onClose();
            }}
          />
        )}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-slate-700">Contact</legend>
          <TextField label="Téléphone" type="tel" placeholder="+243 …" error={errors.phone?.message} {...register('phone')} />
          <TextField label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
          <TextField label="Adresse" error={errors.address?.message} {...register('address')} />
          <TextField label="Ville / commune" error={errors.city?.message} {...register('city')} />
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-slate-700">Informations complémentaires</legend>
          <TextField
            label="Identifiant externe"
            hint="N° de dossier hospitalier, code TARV…"
            error={errors.externalId?.message}
            {...register('externalId')}
          />
          <TextAreaField label="Notes" containerClassName="sm:col-span-2" error={errors.notes?.message} {...register('notes')} />
        </fieldset>
      </form>
    </Modal>
  );
}

function DuplicatePanel({
  candidates,
  checking,
  confirmed,
  onConfirmChange,
  onOpen,
}: {
  candidates: DuplicateCandidate[];
  checking: boolean;
  confirmed: boolean;
  onConfirmChange: (v: boolean) => void;
  onOpen: (p: PatientDto) => void;
}) {
  if (checking && candidates.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Spinner className="size-3.5" /> Recherche de dossiers existants…
      </p>
    );
  }
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-900">
        <UserRoundSearch className="size-4" aria-hidden />
        {candidates.length} dossier(s) existant(s) ressemblent à ce patient
      </p>
      <ul className="space-y-2">
        {candidates.map((c) => (
          <li key={c.patient.id} className="flex flex-wrap items-center gap-3 rounded border border-amber-200 bg-white p-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">
                {c.patient.fullName} <span className="font-mono text-xs text-slate-500">{c.patient.code}</span>
              </p>
              <p className="text-xs text-slate-500">
                {SEX_LABELS[c.patient.sex]}
                {c.patient.birthDate && ` · né(e) le ${formatDate(c.patient.birthDate)}${c.patient.birthDateEstimated ? ' (estimé)' : ''}`}
                {c.patient.phone && ` · ${c.patient.phone}`}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.reasons.map((r) => (
                  <Badge key={r} tone="warning">
                    {r}
                  </Badge>
                ))}
              </div>
            </div>
            <Badge tone={c.score >= 0.8 ? 'danger' : 'warning'}>{Math.round(c.score * 100)} %</Badge>
            <Button size="sm" variant="secondary" onClick={() => onOpen(c.patient)}>
              Ouvrir ce dossier
            </Button>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
        <input type="checkbox" className="mt-0.5 accent-brand-700" checked={confirmed} onChange={(e) => onConfirmChange(e.target.checked)} />
        J’ai vérifié l’identité : il ne s’agit d’aucun de ces patients. Créer un nouveau dossier.
      </label>
    </div>
  );
}
