import { useEffect, useState } from 'react';
import {
  createParameterSchema,
  RESULT_TYPE_LABELS,
  RESULT_TYPES,
  updateParameterSchema,
  type ExamParameterDto,
  type ResultType,
} from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { useCreateParameter, useUpdateParameter } from '@/features/catalog';
import { ApiError } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/utils';

interface Values {
  code: string;
  name: string;
  resultType: ResultType;
  unit: string;
  decimals: string;
  choices: string;
  displayOrder: string;
}

const empty: Values = { code: '', name: '', resultType: 'NUMERIC', unit: '', decimals: '', choices: '', displayOrder: '0' };

export function ParameterFormModal({
  open,
  examId,
  parameter,
  onClose,
  onSaved,
}: {
  open: boolean;
  examId: string;
  parameter: ExamParameterDto | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const create = useCreateParameter();
  const update = useUpdateParameter();
  const [values, setValues] = useState<Values>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setValues(
      parameter
        ? {
            code: parameter.code,
            name: parameter.name,
            resultType: parameter.resultType,
            unit: parameter.unit ?? '',
            decimals: parameter.decimals === null ? '' : String(parameter.decimals),
            choices: parameter.choices.join('\n'),
            displayOrder: String(parameter.displayOrder),
          }
        : empty,
    );
  }, [open, parameter]);

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: '' }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const payload = {
      ...(parameter ? {} : { code: values.code }),
      name: values.name,
      resultType: values.resultType,
      unit: values.unit,
      decimals: values.resultType === 'NUMERIC' ? values.decimals : '',
      choices:
        values.resultType === 'CHOICE'
          ? values.choices
              .split('\n')
              .map((c) => c.trim())
              .filter(Boolean)
          : [],
      displayOrder: values.displayOrder,
    };
    const parsed = (parameter ? updateParameterSchema : createParameterSchema).safeParse(payload);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    try {
      if (parameter) {
        await update.mutateAsync({ id: parameter.id, body: parsed.data as never });
        onSaved(`Paramètre ${parameter.code} mis à jour.`);
      } else {
        const p = await create.mutateAsync({ examId, body: parsed.data as never });
        onSaved(`Paramètre ${p.code} ajouté. Définissez maintenant ses valeurs de référence.`);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.length > 0) {
        setErrors(zodFieldErrors(error.fieldErrors.map((f) => ({ path: [f.path], message: f.message }))));
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parameter ? `Modifier le paramètre ${parameter.code}` : 'Nouveau paramètre'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="parameter-form" loading={create.isPending || update.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="parameter-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <TextField
          label="Code"
          required
          value={values.code}
          onChange={set('code')}
          readOnly={!!parameter}
          className={parameter ? 'bg-slate-100 font-mono uppercase text-slate-500' : 'font-mono uppercase'}
          error={errors.code}
        />
        <TextField label="Libellé" required value={values.name} onChange={set('name')} error={errors.name} />
        <SelectField
          label="Type de résultat"
          value={values.resultType}
          onChange={set('resultType')}
          error={errors.resultType}
          hint={parameter && parameter.referenceRanges.length > 0 ? 'Non modifiable tant que des valeurs de référence existent.' : undefined}
          disabled={!!parameter && parameter.referenceRanges.length > 0}
        >
          {RESULT_TYPES.map((t) => (
            <option key={t} value={t}>
              {RESULT_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <TextField label="Unité" placeholder="g/dL, 10^3/µL, copies/mL" value={values.unit} onChange={set('unit')} error={errors.unit} />
        {values.resultType === 'NUMERIC' && (
          <TextField label="Décimales affichées" type="number" min={0} max={6} value={values.decimals} onChange={set('decimals')} error={errors.decimals} />
        )}
        <TextField label="Ordre d’affichage" type="number" min={0} value={values.displayOrder} onChange={set('displayOrder')} error={errors.displayOrder} />
        {values.resultType === 'CHOICE' && (
          <TextAreaField
            label="Valeurs possibles (une par ligne)"
            required
            containerClassName="sm:col-span-2"
            placeholder={'Négatif\nPositif'}
            value={values.choices}
            onChange={set('choices')}
            error={errors.choices}
          />
        )}
      </form>
    </Modal>
  );
}
