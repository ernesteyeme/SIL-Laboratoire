import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  INTEROP_AUTH_MODE_LABELS,
  INTEROP_SYSTEM_LABELS,
  INTEROP_TRANSPORT_LABELS,
  interopEndpointSchema,
  type Dhis2Settings,
  type InteropAuthMode,
  type InteropEndpointDto,
  type InteropSystem,
  type InteropTransport,
  type VlsmSettings,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { sampleTypesQuery } from '@/features/catalog';
import { useSaveEndpoint } from '@/features/interop';
import { ApiError } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/utils';

interface FormState {
  code: string;
  name: string;
  system: InteropSystem;
  transport: InteropTransport;
  baseUrl: string;
  authMode: InteropAuthMode;
  username: string;
  secret: string;
  clearSecret: boolean;
  timeoutSeconds: string;
  isActive: boolean;
  dhis2: { orgUnit: string; dataSet: string; attributeOptionCombo: string; sendZeros: boolean };
  vlsm: { labId: string; facilityId: string; provinceId: string; reasonForVLTesting: string; defaultSpecimenType: string; specimenTypes: { sampleTypeId: string; vlsmSpecimenType: string }[] };
}

const EMPTY: FormState = {
  code: '',
  name: '',
  system: 'DHIS2',
  transport: 'DIRECT',
  baseUrl: '',
  authMode: 'BASIC',
  username: '',
  secret: '',
  clearSecret: false,
  timeoutSeconds: '30',
  isActive: true,
  dhis2: { orgUnit: '', dataSet: '', attributeOptionCombo: '', sendZeros: true },
  vlsm: { labId: '', facilityId: '', provinceId: '', reasonForVLTesting: '', defaultSpecimenType: '', specimenTypes: [] },
};

function fromEndpoint(e: InteropEndpointDto): FormState {
  const base = { ...EMPTY, code: e.code, name: e.name, system: e.system, transport: e.transport, baseUrl: e.baseUrl, authMode: e.authMode, username: e.username ?? '', timeoutSeconds: String(e.timeoutSeconds), isActive: e.isActive };
  if (e.system === 'DHIS2') {
    const s = e.settings as Dhis2Settings;
    return { ...base, dhis2: { orgUnit: s.orgUnit, dataSet: s.dataSet ?? '', attributeOptionCombo: s.attributeOptionCombo ?? '', sendZeros: s.sendZeros } };
  }
  const s = e.settings as VlsmSettings;
  return {
    ...base,
    vlsm: {
      labId: String(s.labId),
      facilityId: String(s.facilityId),
      provinceId: s.provinceId ? String(s.provinceId) : '',
      reasonForVLTesting: s.reasonForVLTesting,
      defaultSpecimenType: String(s.defaultSpecimenType),
      specimenTypes: s.specimenTypes.map((x) => ({ sampleTypeId: x.sampleTypeId, vlsmSpecimenType: String(x.vlsmSpecimenType) })),
    },
  };
}

const URL_HINTS: Record<InteropSystem, Record<InteropTransport, string>> = {
  DHIS2: { DIRECT: 'Racine de DHIS2, ex. https://dhis2.sante.gouv.cd', OPENHIM: 'URL du canal OpenHIM vers DHIS2, ex. https://openhim.pnls.cd:5000/dhis2' },
  VLSM: { DIRECT: 'API du STS, ex. https://vlsm.pnls.cd/api/v1.1', OPENHIM: 'URL du canal OpenHIM vers l’API VLSM, ex. https://openhim.pnls.cd:5000/vlsm' },
};

export function EndpointFormModal({ open, endpoint, onClose }: { open: boolean; endpoint: InteropEndpointDto | null; onClose: () => void }) {
  const save = useSaveEndpoint();
  const sampleTypes = useQuery({ ...sampleTypesQuery, enabled: open });
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(endpoint ? fromEndpoint(endpoint) : EMPTY);
    setErrors({});
    setFormError(null);
  }, [open, endpoint]);

  const via = form.transport === 'OPENHIM';
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: 'code' | 'name' | 'baseUrl' | 'username' | 'secret' | 'timeoutSeconds') => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
    error: errors[k],
  });
  const dhis = (k: 'orgUnit' | 'dataSet' | 'attributeOptionCombo') => ({
    value: form.dhis2[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, dhis2: { ...f.dhis2, [k]: e.target.value.trim() } })),
    error: errors[`settings.${k}`],
  });
  const vl = (k: 'labId' | 'facilityId' | 'provinceId' | 'reasonForVLTesting' | 'defaultSpecimenType') => ({
    value: form.vlsm[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, vlsm: { ...f.vlsm, [k]: e.target.value } })),
    error: errors[`settings.${k}`],
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const settings =
      form.system === 'DHIS2'
        ? { orgUnit: form.dhis2.orgUnit, dataSet: form.dhis2.dataSet || null, attributeOptionCombo: form.dhis2.attributeOptionCombo || null, sendZeros: form.dhis2.sendZeros }
        : {
            labId: form.vlsm.labId,
            facilityId: form.vlsm.facilityId,
            provinceId: form.vlsm.provinceId || null,
            reasonForVLTesting: form.vlsm.reasonForVLTesting,
            defaultSpecimenType: form.vlsm.defaultSpecimenType,
            specimenTypes: form.vlsm.specimenTypes.filter((s) => s.sampleTypeId),
          };
    const parsed = interopEndpointSchema.safeParse({
      code: form.code,
      name: form.name,
      system: form.system,
      transport: form.transport,
      baseUrl: form.baseUrl,
      authMode: via ? 'BASIC' : form.authMode,
      username: form.username,
      secret: form.secret || undefined,
      clearSecret: form.clearSecret || undefined,
      timeoutSeconds: form.timeoutSeconds,
      isActive: form.isActive,
      settings,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ id: endpoint?.id, body: parsed.data });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])));
      setFormError(errorMessage(err));
    }
  };

  const secretLabel = via ? 'Mot de passe du client OpenHIM' : form.authMode === 'TOKEN' ? (form.system === 'DHIS2' ? 'Jeton d’accès personnel (d2pat_…)' : 'Jeton d’API VLSM') : 'Mot de passe';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={endpoint ? `Connexion ${endpoint.code}` : 'Nouvelle connexion'}
      description="Les mots de passe et jetons sont chiffrés (AES-256-GCM) sur le serveur et ne sont jamais réaffichés."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="endpoint-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="endpoint-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <SelectField label="Système" required disabled={!!endpoint} value={form.system} onChange={(e) => set('system', e.target.value as InteropSystem)} hint={endpoint ? 'Le système ne se modifie pas.' : undefined}>
          {(['DHIS2', 'VLSM'] as const).map((s) => (
            <option key={s} value={s}>
              {INTEROP_SYSTEM_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Acheminement" value={form.transport} onChange={(e) => set('transport', e.target.value as InteropTransport)}>
          {(['DIRECT', 'OPENHIM'] as const).map((t) => (
            <option key={t} value={t}>
              {INTEROP_TRANSPORT_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <TextField label="Code" required disabled={!!endpoint} hint={endpoint ? 'Le code ne se modifie pas.' : 'Ex. DHIS2-NATIONAL'} {...text('code')} />
        <TextField label="Nom" required placeholder="DHIS2 national — PNLS" {...text('name')} />
        <TextField label="Adresse de base" required containerClassName="sm:col-span-2" hint={URL_HINTS[form.system][form.transport]} {...text('baseUrl')} />
        {!via && (
          <SelectField label="Authentification" value={form.authMode} onChange={(e) => set('authMode', e.target.value as InteropAuthMode)}>
            {(['BASIC', 'TOKEN'] as const).map((m) => (
              <option key={m} value={m}>
                {INTEROP_AUTH_MODE_LABELS[m]}
              </option>
            ))}
          </SelectField>
        )}
        {(via || form.authMode === 'BASIC') && <TextField label={via ? 'Identifiant du client OpenHIM' : 'Identifiant'} required autoComplete="off" {...text('username')} />}
        <TextField
          label={secretLabel}
          type="password"
          autoComplete="new-password"
          required={!endpoint}
          disabled={form.clearSecret}
          placeholder={endpoint?.hasSecret ? '•••••••• (inchangé)' : ''}
          hint={endpoint ? 'Laisser vide pour conserver le secret enregistré.' : undefined}
          {...text('secret')}
        />
        <TextField label="Délai de réponse (s)" inputMode="numeric" {...text('timeoutSeconds')} />
        {via && (
          <Alert tone="info" className="sm:col-span-2">
            Via OpenHIM, le LIMS s’authentifie comme client OpenHIM ; les identifiants du système cible ({form.system}) sont portés par la route ou le médiateur du canal. L’identifiant de transaction OpenHIM est conservé au journal.
          </Alert>
        )}

        {form.system === 'DHIS2' ? (
          <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3 sm:col-span-2 sm:grid-cols-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Rapport DHIS2</legend>
            <TextField label="Unité d’organisation (UID)" required placeholder="Ex. ImspTQPwCqd" {...dhis('orgUnit')} />
            <TextField label="Ensemble de données (UID)" {...dhis('dataSet')} />
            <TextField label="Combinaison d’attributs (UID)" hint="Ex. partenaire / financement" {...dhis('attributeOptionCombo')} />
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" className="size-4 accent-brand-700" checked={form.dhis2.sendZeros} onChange={(e) => setForm((f) => ({ ...f, dhis2: { ...f.dhis2, sendZeros: e.target.checked } }))} />
              Transmettre les valeurs nulles (0 = « aucun cas », distinct de « non rapporté »)
            </label>
          </fieldset>
        ) : (
          <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3 sm:col-span-2 sm:grid-cols-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Identifiants VLSM</legend>
            <TextField label="Laboratoire (labId)" required inputMode="numeric" {...vl('labId')} />
            <TextField label="Structure par défaut (facilityId)" required inputMode="numeric" {...vl('facilityId')} />
            <TextField label="Province (provinceId)" inputMode="numeric" {...vl('provinceId')} />
            <TextField label="Motif de la demande" required hint="reasonForVLTesting (identifiant VLSM)" {...vl('reasonForVLTesting')} />
            <TextField label="Type d’échantillon par défaut" required inputMode="numeric" hint="specimenType VLSM" {...vl('defaultSpecimenType')} />
            <div className="sm:col-span-3">
              <p className="mb-2 text-sm font-medium text-slate-700">Types d’échantillon du laboratoire → VLSM</p>
              {errors['settings.specimenTypes'] && <p className="mb-2 text-xs text-red-700">{errors['settings.specimenTypes']}</p>}
              <div className="flex flex-col gap-2">
                {form.vlsm.specimenTypes.map((row, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <SelectField
                      label="Type d’échantillon"
                      containerClassName="flex-1"
                      value={row.sampleTypeId}
                      onChange={(e) => setForm((f) => ({ ...f, vlsm: { ...f.vlsm, specimenTypes: f.vlsm.specimenTypes.map((x, j) => (j === i ? { ...x, sampleTypeId: e.target.value } : x)) } }))}
                    >
                      <option value="">—</option>
                      {(sampleTypes.data ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </SelectField>
                    <TextField
                      label="specimenType VLSM"
                      containerClassName="w-40"
                      inputMode="numeric"
                      value={row.vlsmSpecimenType}
                      onChange={(e) => setForm((f) => ({ ...f, vlsm: { ...f.vlsm, specimenTypes: f.vlsm.specimenTypes.map((x, j) => (j === i ? { ...x, vlsmSpecimenType: e.target.value } : x)) } }))}
                    />
                    <IconAction icon={Trash2} label="Retirer" onClick={() => setForm((f) => ({ ...f, vlsm: { ...f.vlsm, specimenTypes: f.vlsm.specimenTypes.filter((_, j) => j !== i) } }))} />
                  </div>
                ))}
              </div>
              <Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => setForm((f) => ({ ...f, vlsm: { ...f.vlsm, specimenTypes: [...f.vlsm.specimenTypes, { sampleTypeId: '', vlsmSpecimenType: '' }] } }))}>
                Ajouter une correspondance
              </Button>
            </div>
          </fieldset>
        )}

        <div className="flex flex-col gap-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-700" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            Connexion active (une connexion inactive ne transmet rien)
          </label>
          {endpoint?.hasSecret && (
            <label className="flex items-center gap-2 text-sm text-red-700">
              <input type="checkbox" className="size-4 accent-red-600" checked={form.clearSecret} onChange={(e) => setForm((f) => ({ ...f, clearSecret: e.target.checked, secret: '' }))} />
              Effacer le secret enregistré
            </label>
          )}
        </div>
      </form>
    </Modal>
  );
}
