import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CSV_DELIMITERS, INSTRUMENT_PROTOCOL_LABELS, INSTRUMENT_PROTOCOLS, instrumentSchema, type InstrumentDto, type InstrumentProtocol } from '@lims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Alert } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/Modal';
import { sectionsQuery } from '@/features/catalog';
import { useSaveInstrument } from '@/features/instruments';
import { ApiError } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/utils';

const DELIMITER_LABELS: Record<(typeof CSV_DELIMITERS)[number], string> = { ',': 'Virgule (,)', ';': 'Point-virgule (;)', '\t': 'Tabulation', '|': 'Barre verticale (|)' };

export function InstrumentFormModal({ open, instrument, onClose, onSaved }: { open: boolean; instrument: InstrumentDto | null; onClose: () => void; onSaved?: (i: InstrumentDto) => void }) {
  const save = useSaveInstrument();
  const sections = useQuery(sectionsQuery);
  const empty = {
    code: '',
    name: '',
    manufacturer: '',
    model: '',
    sectionId: '',
    protocol: 'ASTM' as InstrumentProtocol,
    isActive: true,
    csv: { delimiter: ';' as (typeof CSV_DELIMITERS)[number], hasHeader: true, specimenColumn: '', testColumn: '', valueColumn: '', unitColumn: '', flagsColumn: '', measuredAtColumn: '' },
  };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      instrument
        ? {
            code: instrument.code,
            name: instrument.name,
            manufacturer: instrument.manufacturer ?? '',
            model: instrument.model ?? '',
            sectionId: instrument.section?.id ?? '',
            protocol: instrument.protocol,
            isActive: instrument.isActive,
            csv: instrument.csvConfig
              ? {
                  ...instrument.csvConfig,
                  unitColumn: instrument.csvConfig.unitColumn ?? '',
                  flagsColumn: instrument.csvConfig.flagsColumn ?? '',
                  measuredAtColumn: instrument.csvConfig.measuredAtColumn ?? '',
                }
              : empty.csv,
          }
        : empty,
    );
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instrument]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const { csv, ...rest } = form;
    const parsed = instrumentSchema.safeParse({ ...rest, csvConfig: form.protocol === 'CSV' ? csv : null });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      const saved = await save.mutateAsync({ id: instrument?.id, body: parsed.data });
      onClose();
      onSaved?.(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])));
      setFormError(errorMessage(err));
    }
  };
  const bind = (k: 'code' | 'name' | 'manufacturer' | 'model' | 'sectionId') => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
    error: errors[k],
  });
  const csvBind = (k: 'specimenColumn' | 'testColumn' | 'valueColumn' | 'unitColumn' | 'flagsColumn' | 'measuredAtColumn') => ({
    value: form.csv[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, csv: { ...f.csv, [k]: e.target.value } })),
    error: errors[`csvConfig.${k}`],
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={instrument ? `Automate ${instrument.code}` : 'Déclarer un automate'}
      description="Un compte de service est créé pour l’automate : ses résultats et ses contrôles apparaissent à son nom dans la piste d’audit."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="instrument-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="instrument-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <TextField label="Code" required disabled={!!instrument} hint={instrument ? 'Le code ne se modifie pas.' : 'Ex. XN1000-HEMATO'} {...bind('code')} />
        <TextField label="Nom" required placeholder="Sysmex XN-1000 (paillasse hémato)" {...bind('name')} />
        <TextField label="Fabricant" {...bind('manufacturer')} />
        <TextField label="Modèle" {...bind('model')} />
        <SelectField label="Section" {...bind('sectionId')}>
          <option value="">—</option>
          {(sections.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Protocole" value={form.protocol} onChange={(e) => setForm((f) => ({ ...f, protocol: e.target.value as InstrumentProtocol }))}>
          {INSTRUMENT_PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {INSTRUMENT_PROTOCOL_LABELS[p]}
            </option>
          ))}
        </SelectField>
        {form.protocol === 'CSV' && (
          <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3 sm:col-span-2 sm:grid-cols-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Colonnes du fichier</legend>
            {errors.csvConfig && <p className="text-xs text-red-700 sm:col-span-3">{errors.csvConfig}</p>}
            <SelectField label="Séparateur" value={form.csv.delimiter} onChange={(e) => setForm((f) => ({ ...f, csv: { ...f.csv, delimiter: e.target.value as (typeof CSV_DELIMITERS)[number] } }))}>
              {CSV_DELIMITERS.map((d) => (
                <option key={d} value={d}>
                  {DELIMITER_LABELS[d]}
                </option>
              ))}
            </SelectField>
            <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4 accent-brand-700" checked={form.csv.hasHeader} onChange={(e) => setForm((f) => ({ ...f, csv: { ...f.csv, hasHeader: e.target.checked } }))} />
              Première ligne = en-tête (sinon, numéros de colonne 1, 2, 3…)
            </label>
            <TextField label="N° d’échantillon" required {...csvBind('specimenColumn')} />
            <TextField label="Code test" required {...csvBind('testColumn')} />
            <TextField label="Résultat" required {...csvBind('valueColumn')} />
            <TextField label="Unité" {...csvBind('unitColumn')} />
            <TextField label="Indicateurs" {...csvBind('flagsColumn')} />
            <TextField label="Date de mesure" {...csvBind('measuredAtColumn')} />
          </fieldset>
        )}
        {instrument && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-brand-700" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Automate actif (désactivé, sa clé de connecteur est refusée)
          </label>
        )}
      </form>
    </Modal>
  );
}
