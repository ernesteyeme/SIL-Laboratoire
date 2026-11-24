import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  DHIS2_MEASURE_LABELS,
  DHIS2_MEASURES,
  dhis2MappingSchema,
  VLSM_TEST_TYPE_LABELS,
  vlsmMappingSchema,
  type Dhis2Measure,
  type Dhis2MappingDto,
  type MappingParameterDto,
  type RangeSex,
  type VlsmMappingDto,
  type VlsmTestType,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { examQuery, useExams } from '@/features/catalog';
import { useSaveDhis2Mapping, useSaveVlsmMapping } from '@/features/interop';
import { ApiError } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/utils';

interface PickedParameter {
  id: string;
  label: string;
  resultType: string;
  choices: string[];
}

/** Choix d'un paramètre du catalogue : examen puis paramètre. */
function ParameterPicker({ current, value, onChange, error }: { current: MappingParameterDto | null; value: PickedParameter | null; onChange: (p: PickedParameter | null) => void; error?: string }) {
  const exams = useExams({ page: 1, pageSize: 100, status: 'active' });
  const [examId, setExamId] = useState('');
  const exam = useQuery({ ...examQuery(examId), enabled: !!examId });
  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
      <SelectField
        label="Examen"
        value={examId}
        onChange={(e) => {
          setExamId(e.target.value);
          onChange(null);
        }}
        hint={!examId && current ? `Actuel : ${current.examName} — ${current.name}` : undefined}
      >
        <option value="">{current ? '— conserver le paramètre actuel —' : '—'}</option>
        {(exams.data?.items ?? []).map((x) => (
          <option key={x.id} value={x.id}>
            {x.code} — {x.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Paramètre"
        required
        disabled={!examId}
        value={examId ? (value?.id ?? '') : ''}
        error={error}
        onChange={(e) => {
          const p = exam.data?.parameters.find((x) => x.id === e.target.value);
          onChange(p ? { id: p.id, label: `${exam.data!.name} — ${p.name}`, resultType: p.resultType, choices: p.choices } : null);
        }}
      >
        <option value="">{examId ? '—' : current ? current.name : 'Choisissez d’abord un examen'}</option>
        {(exam.data?.parameters ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.resultType === 'NUMERIC' ? p.unit ?? 'numérique' : p.resultType === 'CHOICE' ? p.choices.join(' / ') : 'texte'})
          </option>
        ))}
      </SelectField>
    </div>
  );
}

const fromParam = (p: MappingParameterDto): PickedParameter => ({ id: p.id, label: `${p.examName} — ${p.name}`, resultType: p.resultType, choices: p.choices });

// ---------------------------------------------------------------------------
// DHIS2
// ---------------------------------------------------------------------------

export function Dhis2MappingModal({ endpointId, mapping, onClose }: { endpointId: string; mapping: Dhis2MappingDto | 'new' | null; onClose: () => void }) {
  const save = useSaveDhis2Mapping();
  const existing = mapping && mapping !== 'new' ? mapping : null;
  const empty = { label: '', measure: 'VALIDATED_COUNT' as Dhis2Measure, threshold: '', textMatch: '', sex: 'ANY' as RangeSex, ageMinYears: '', ageMaxYears: '', dataElement: '', categoryOptionCombo: '', displayOrder: '0', isActive: true };
  const [form, setForm] = useState(empty);
  const [param, setParam] = useState<PickedParameter | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapping) return;
    setParam(existing ? fromParam(existing.parameter) : null);
    setForm(
      existing
        ? {
            label: existing.label,
            measure: existing.measure,
            threshold: existing.threshold === null ? '' : String(existing.threshold),
            textMatch: existing.textMatch ?? '',
            sex: existing.sex,
            ageMinYears: existing.ageMinYears === null ? '' : String(existing.ageMinYears),
            ageMaxYears: existing.ageMaxYears === null ? '' : String(existing.ageMaxYears),
            dataElement: existing.dataElement,
            categoryOptionCombo: existing.categoryOptionCombo ?? '',
            displayOrder: String(existing.displayOrder),
            isActive: existing.isActive,
          }
        : empty,
    );
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping]);

  const numeric = form.measure === 'NUMERIC_BELOW' || form.measure === 'NUMERIC_AT_OR_ABOVE';
  const bind = (k: 'label' | 'threshold' | 'textMatch' | 'ageMinYears' | 'ageMaxYears' | 'dataElement' | 'categoryOptionCombo' | 'displayOrder') => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
    error: errors[k],
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = dhis2MappingSchema.safeParse({
      ...form,
      parameterId: param?.id ?? '',
      threshold: numeric && form.threshold ? form.threshold.replace(',', '.') : null,
      textMatch: form.measure === 'TEXT_EQUALS' ? form.textMatch : null,
      ageMinYears: form.ageMinYears || null,
      ageMaxYears: form.ageMaxYears || null,
      categoryOptionCombo: form.categoryOptionCombo || null,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ endpointId, id: existing?.id, body: parsed.data });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])));
      setFormError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={!!mapping}
      onClose={onClose}
      size="lg"
      title={existing ? 'Modifier la correspondance DHIS2' : 'Nouvelle correspondance DHIS2'}
      description="Chaque règle calcule une cellule du formulaire DHIS2 (élément de données × combinaison de catégories) à partir des résultats validés du mois."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="dhis2-mapping-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="dhis2-mapping-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <TextField label="Libellé" required containerClassName="sm:col-span-2" placeholder="CV < 1000 copies/ml — femmes ≥ 15 ans" {...bind('label')} />
        <ParameterPicker current={existing?.parameter ?? null} value={param} onChange={(p) => setParam(p ?? (existing ? fromParam(existing.parameter) : null))} error={errors.parameterId} />
        <SelectField label="Mesure" value={form.measure} onChange={(e) => setForm((f) => ({ ...f, measure: e.target.value as Dhis2Measure }))}>
          {DHIS2_MEASURES.map((m) => (
            <option key={m} value={m}>
              {DHIS2_MEASURE_LABELS[m]}
            </option>
          ))}
        </SelectField>
        {numeric && <TextField label="Seuil" required inputMode="decimal" hint="« < 40 » compte sous un seuil de 1000 ; « < 2000 » est écarté (indéterminé)." {...bind('threshold')} />}
        {form.measure === 'TEXT_EQUALS' &&
          (param?.resultType === 'CHOICE' ? (
            <SelectField label="Texte attendu" required value={form.textMatch} error={errors.textMatch} onChange={(e) => setForm((f) => ({ ...f, textMatch: e.target.value }))}>
              <option value="">—</option>
              {param.choices.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
          ) : (
            <TextField label="Texte attendu" required hint="Comparaison sans accents ni majuscules." {...bind('textMatch')} />
          ))}
        <SelectField label="Sexe" value={form.sex} onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value as RangeSex }))}>
          <option value="ANY">Tous</option>
          <option value="MALE">Masculin</option>
          <option value="FEMALE">Féminin</option>
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Âge min. (inclus)" inputMode="numeric" hint="années" {...bind('ageMinYears')} />
          <TextField label="Âge max. (exclu)" inputMode="numeric" hint="< 15 ans → 15" {...bind('ageMaxYears')} />
        </div>
        <TextField label="Élément de données (UID)" required placeholder="Ex. fbfJHSPpUQD" {...bind('dataElement')} />
        <TextField label="Combinaison de catégories (UID)" hint="Vide = combinaison par défaut" {...bind('categoryOptionCombo')} />
        <TextField label="Ordre d’affichage" inputMode="numeric" {...bind('displayOrder')} />
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-700" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          Règle active
        </label>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// VLSM
// ---------------------------------------------------------------------------

export function VlsmMappingModal({ endpointId, mapping, onClose }: { endpointId: string; mapping: VlsmMappingDto | 'new' | null; onClose: () => void }) {
  const save = useSaveVlsmMapping();
  const existing = mapping && mapping !== 'new' ? mapping : null;
  const [param, setParam] = useState<PickedParameter | null>(null);
  const [form, setForm] = useState({ testType: 'VL' as VlsmTestType, eidPositive: '', eidNegative: '', eidIndeterminate: '', isActive: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapping) return;
    setParam(existing ? fromParam(existing.parameter) : null);
    setForm(
      existing
        ? { testType: existing.testType, eidPositive: existing.eidPositive ?? '', eidNegative: existing.eidNegative ?? '', eidIndeterminate: existing.eidIndeterminate ?? '', isActive: existing.isActive }
        : { testType: 'VL', eidPositive: '', eidNegative: '', eidIndeterminate: '', isActive: true },
    );
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = vlsmMappingSchema.safeParse({ ...form, parameterId: param?.id ?? '' });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ endpointId, id: existing?.id, body: parsed.data });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const choiceField = (k: 'eidPositive' | 'eidNegative' | 'eidIndeterminate', label: string, required: boolean) =>
    param?.resultType === 'CHOICE' ? (
      <SelectField label={label} required={required} value={form[k]} error={errors[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}>
        <option value="">—</option>
        {param.choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </SelectField>
    ) : (
      <TextField label={label} required={required} value={form[k]} error={errors[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
    );

  return (
    <Modal
      open={!!mapping}
      onClose={onClose}
      title={existing ? 'Modifier le paramètre transmis' : 'Paramètre transmis à VLSM'}
      description="La charge virale (VL) est envoyée sur /vl/save-request.php, la PCR ADN du nourrisson (EID) sur /eid/save-request.php."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="vlsm-mapping-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="vlsm-mapping-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <ParameterPicker current={existing?.parameter ?? null} value={param} onChange={(p) => setParam(p ?? (existing ? fromParam(existing.parameter) : null))} error={errors.parameterId} />
        <SelectField label="Type de test VLSM" value={form.testType} onChange={(e) => setForm((f) => ({ ...f, testType: e.target.value as VlsmTestType }))}>
          {(['VL', 'EID'] as const).map((t) => (
            <option key={t} value={t}>
              {VLSM_TEST_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-700" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          Transmission active
        </label>
        {form.testType === 'EID' && (
          <>
            {choiceField('eidPositive', 'Valeur « positive »', true)}
            {choiceField('eidNegative', 'Valeur « negative »', true)}
            {choiceField('eidIndeterminate', 'Valeur « indeterminate »', false)}
          </>
        )}
      </form>
    </Modal>
  );
}
