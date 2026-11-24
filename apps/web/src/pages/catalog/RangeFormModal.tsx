import { useEffect, useState } from 'react';
import {
  AGE_UNIT_LABELS,
  AGE_UNITS,
  ageToDays,
  daysToAge,
  RANGE_SEX_LABELS,
  RANGE_SEXES,
  referenceRangeSchema,
  type AgeUnit,
  type ExamParameterDto,
  type RangeSex,
  type ReferenceRangeDto,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { useSaveRange } from '@/features/catalog';
import { ApiError } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/utils';

interface Values {
  sex: RangeSex;
  ageMin: string;
  ageMinUnit: AgeUnit;
  ageMax: string;
  ageMaxUnit: AgeUnit;
  low: string;
  high: string;
  criticalLow: string;
  criticalHigh: string;
  normalText: string;
  comment: string;
  reason: string;
}

function toValues(r: ReferenceRangeDto | null): Values {
  const min = r ? daysToAge(r.ageMinDays) : { value: 0, unit: 'YEARS' as AgeUnit };
  const max = r?.ageMaxDays != null ? daysToAge(r.ageMaxDays) : null;
  const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  return {
    sex: r?.sex ?? 'ANY',
    ageMin: String(min.value),
    ageMinUnit: min.unit,
    ageMax: max ? String(max.value) : '',
    ageMaxUnit: max?.unit ?? 'YEARS',
    low: num(r?.low),
    high: num(r?.high),
    criticalLow: num(r?.criticalLow),
    criticalHigh: num(r?.criticalHigh),
    normalText: r?.normalText ?? '',
    comment: r?.comment ?? '',
    reason: '',
  };
}

/** Saisie d'une valeur de référence : âges en jours / mois / ans (convertis en jours), bornes ou valeur normale selon le type. */
export function RangeFormModal({
  target,
  onClose,
  onSaved,
}: {
  target: { parameter: ExamParameterDto; range: ReferenceRangeDto | null } | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const save = useSaveRange();
  const [values, setValues] = useState<Values>(toValues(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const parameter = target?.parameter;
  const editing = !!target?.range;
  const numeric = parameter?.resultType === 'NUMERIC';

  useEffect(() => {
    if (!target) return;
    setValues(toValues(target.range));
    setErrors({});
    setFormError(null);
  }, [target]);

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: '' }));
  };

  const toNumber = (s: string) => Number(s.replace(',', '.'));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !parameter) return;
    setFormError(null);
    const ageMinValid = values.ageMin.trim() !== '' && Number.isFinite(toNumber(values.ageMin));
    const payload = {
      sex: values.sex,
      ageMinDays: ageMinValid ? ageToDays(toNumber(values.ageMin), values.ageMinUnit) : -1,
      ageMaxDays: values.ageMax.trim() === '' ? null : ageToDays(toNumber(values.ageMax), values.ageMaxUnit),
      low: numeric ? values.low : '',
      high: numeric ? values.high : '',
      criticalLow: numeric ? values.criticalLow : '',
      criticalHigh: numeric ? values.criticalHigh : '',
      normalText: numeric ? '' : values.normalText,
      comment: values.comment,
      reason: values.reason.trim() === '' ? undefined : values.reason,
    };
    const parsed = referenceRangeSchema.safeParse(payload);
    const rename = { ageMinDays: 'ageMin', ageMaxDays: 'ageMax' };
    const errs = parsed.success ? {} : zodFieldErrors(parsed.error.issues, rename);
    if (editing && !payload.reason) errs.reason = 'Un motif est obligatoire pour modifier une valeur de référence.';
    if (!parsed.success || Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    try {
      await save.mutateAsync({ parameterId: parameter.id, rangeId: target.range?.id, body: parsed.data });
      onSaved(editing ? 'Valeur de référence modifiée.' : `Valeur de référence ajoutée pour ${parameter.code}.`);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.length > 0) {
        setErrors(zodFieldErrors(error.fieldErrors.map((f) => ({ path: [f.path], message: f.message })), rename));
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  const unitSelect = (key: 'ageMinUnit' | 'ageMaxUnit') => (
    <select
      aria-label="Unité d’âge"
      value={values[key]}
      onChange={set(key)}
      className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm"
    >
      {AGE_UNITS.map((u) => (
        <option key={u} value={u}>
          {AGE_UNIT_LABELS[u]}
        </option>
      ))}
    </select>
  );

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      size="lg"
      title={`${editing ? 'Modifier' : 'Nouvelle'} valeur de référence — ${parameter?.name ?? ''}`}
      description="Tranche d’âge : borne minimale incluse, borne maximale exclue. Une plage « Tous » s’applique quand aucune plage spécifique au sexe ne correspond."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="range-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="range-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Sexe" value={values.sex} onChange={set('sex')} error={errors.sex}>
            {RANGE_SEXES.map((s) => (
              <option key={s} value={s}>
                {RANGE_SEX_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <div className="flex items-end gap-2">
            <TextField label="Âge à partir de" type="number" min={0} value={values.ageMin} onChange={set('ageMin')} error={errors.ageMin} containerClassName="flex-1" />
            <div className={errors.ageMin ? 'mb-5' : ''}>{unitSelect('ageMinUnit')}</div>
          </div>
          <div className="flex items-end gap-2">
            <TextField
              label="Jusqu’à (exclu)"
              type="number"
              min={1}
              placeholder="sans limite"
              value={values.ageMax}
              onChange={set('ageMax')}
              error={errors.ageMax}
              containerClassName="flex-1"
            />
            <div className={errors.ageMax ? 'mb-5' : ''}>{unitSelect('ageMaxUnit')}</div>
          </div>
        </div>

        {numeric ? (
          <div className="grid gap-4 sm:grid-cols-4">
            <TextField label={`Borne basse${parameter?.unit ? ` (${parameter.unit})` : ''}`} inputMode="decimal" value={values.low} onChange={set('low')} error={errors.low} />
            <TextField label="Borne haute" inputMode="decimal" value={values.high} onChange={set('high')} error={errors.high} />
            <TextField label="Seuil critique bas" inputMode="decimal" value={values.criticalLow} onChange={set('criticalLow')} error={errors.criticalLow} />
            <TextField label="Seuil critique haut" inputMode="decimal" value={values.criticalHigh} onChange={set('criticalHigh')} error={errors.criticalHigh} />
          </div>
        ) : parameter?.resultType === 'CHOICE' ? (
          <SelectField label="Valeur normale attendue" required value={values.normalText} onChange={set('normalText')} error={errors.normalText ?? errors.low}>
            <option value="">— Choisir —</option>
            {parameter.choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField label="Valeur normale attendue" required value={values.normalText} onChange={set('normalText')} error={errors.normalText ?? errors.low} />
        )}

        <TextAreaField label="Commentaire (affiché sur le compte rendu)" value={values.comment} onChange={set('comment')} error={errors.comment} />
        {editing && (
          <TextAreaField
            label="Motif de la modification (consigné dans la piste d’audit)"
            required
            placeholder="Ex. : changement de lot de réactif, nouvelle notice fournisseur"
            value={values.reason}
            onChange={set('reason')}
            error={errors.reason}
          />
        )}
      </form>
    </Modal>
  );
}
