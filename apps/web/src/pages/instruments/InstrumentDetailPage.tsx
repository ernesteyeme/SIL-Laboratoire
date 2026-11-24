import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, KeyRound, ListChecks, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  INSTRUMENT_PROTOCOL_LABELS,
  INSTRUMENT_RESULT_STATUS_LABELS,
  instrumentMappingSchema,
  instrumentQcMaterialSchema,
  type IngestResultDto,
  type InstrumentApiKeyDto,
  type InstrumentDto,
  type InstrumentMappingDto,
  type InstrumentResultStatus,
} from '@lims/shared';
import { INSTRUMENT_CONFIG_ROLES, INSTRUMENT_KEY_ROLES, INSTRUMENT_OPERATE_ROLES } from '@/auth/navigation';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Alert, Badge, LoadingBlock } from '@/components/ui/feedback';
import { IconAction } from '@/components/ui/IconAction';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/PageHeader';
import { examQuery, useExams } from '@/features/catalog';
import { instrumentQuery, instrumentWorklistQuery, useRemoveQcLink, useRotateKey, useSaveMapping, useSaveQcLink, useUploadFile } from '@/features/instruments';
import { qcMaterialsQuery } from '@/features/quality';
import { cn, errorMessage, formatDateTime, zodFieldErrors } from '@/lib/utils';
import { NotFoundPage } from '../NotFoundPage';
import { InstrumentFormModal } from './InstrumentFormModal';

export function InstrumentDetailPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();
  const canConfig = hasRole(...INSTRUMENT_CONFIG_ROLES);
  const { data: inst, isLoading, isError, error } = useQuery(instrumentQuery(id));
  const [editing, setEditing] = useState(false);
  const [mapping, setMapping] = useState<InstrumentMappingDto | 'new' | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (isError) return (error as { status?: number })?.status === 404 ? <NotFoundPage /> : <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!inst) return null;

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/automates?onglet=instruments" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="size-4" /> Automates
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
            {inst.name} {!inst.isActive && <Badge>Inactif</Badge>}
          </h1>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{inst.code}</span> · {INSTRUMENT_PROTOCOL_LABELS[inst.protocol]}
            {inst.manufacturer && ` · ${inst.manufacturer}`}
            {inst.model && ` ${inst.model}`}
            {inst.section && ` · ${inst.section.name}`} · dernier message : {inst.lastMessageAt ? formatDateTime(inst.lastMessageAt) : 'jamais'}
          </p>
        </div>
        <div className="flex gap-2">
          {inst.pendingCount > 0 && (
            <Link to={`/automates?`} className="inline-flex items-center rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200">
              {inst.pendingCount} résultat(s) à traiter
            </Link>
          )}
          {canConfig && (
            <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
              Modifier
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Correspondance des codes tests</h2>
                <p className="text-xs text-slate-500">Code envoyé par l’automate → paramètre du catalogue. Un code inconnu part dans la file « à traiter ».</p>
              </div>
              {canConfig && (
                <Button size="sm" icon={Plus} onClick={() => setMapping('new')}>
                  Ajouter
                </Button>
              )}
            </div>
            {inst.mappings.length === 0 ? (
              <p className="text-sm text-slate-500">Aucune correspondance : aucun résultat ne pourra être intégré.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="py-1.5 pr-3">Code automate</th>
                    <th className="py-1.5 pr-3">Paramètre</th>
                    <th className="py-1.5 pr-3">Conversion</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inst.mappings.map((m) => (
                    <tr key={m.id} className={cn(!m.isActive && 'text-slate-400')}>
                      <td className="py-1.5 pr-3 font-mono font-semibold">{m.instrumentCode}</td>
                      <td className="py-1.5 pr-3">
                        {m.parameter.name} <span className="text-xs text-slate-400">({m.parameter.examCode}{m.parameter.unit ? `, ${m.parameter.unit}` : ''})</span>
                        {!m.isActive && <span className="ml-1 text-xs">· inactive</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-xs text-slate-600">
                        {m.factor !== 1 && <span className="mr-2">× {String(m.factor).replace('.', ',')}</span>}
                        {Object.entries(m.valueMap).map(([k, v]) => (
                          <span key={k} className="mr-2 whitespace-nowrap">
                            « {k} » → « {v} »
                          </span>
                        ))}
                        {m.factor === 1 && Object.keys(m.valueMap).length === 0 && '—'}
                      </td>
                      <td className="py-1.5 text-right">{canConfig && <IconAction label="Modifier" icon={Pencil} onClick={() => setMapping(m)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <QcLinksCard inst={inst} canConfig={canConfig} />
          {hasRole(...INSTRUMENT_OPERATE_ROLES) && <UploadCard inst={inst} />}
        </div>
        <aside className="space-y-4">
          <ConnectorCard inst={inst} />
          <WorklistCard id={inst.id} />
        </aside>
      </div>
      <InstrumentFormModal open={editing} instrument={inst} onClose={() => setEditing(false)} />
      <MappingModal inst={inst} mapping={mapping} onClose={() => setMapping(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function MappingModal({ inst, mapping, onClose }: { inst: InstrumentDto; mapping: InstrumentMappingDto | 'new' | null; onClose: () => void }) {
  const save = useSaveMapping();
  const exams = useExams({ page: 1, pageSize: 100, status: 'active' });
  const existing = mapping && mapping !== 'new' ? mapping : null;
  const [examId, setExamId] = useState('');
  const exam = useQuery({ ...examQuery(examId), enabled: !!examId });
  const [form, setForm] = useState({ instrumentCode: '', parameterId: '', factor: '1', valueMap: '', isActive: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapping) return;
    setExamId('');
    setForm(
      existing
        ? {
            instrumentCode: existing.instrumentCode,
            parameterId: existing.parameter.id,
            factor: String(existing.factor).replace('.', ','),
            valueMap: Object.entries(existing.valueMap).map(([k, v]) => `${k} = ${v}`).join('\n'),
            isActive: existing.isActive,
          }
        : { instrumentCode: '', parameterId: '', factor: '1', valueMap: '', isActive: true },
    );
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const valueMap: Record<string, string> = {};
    for (const line of form.valueMap.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const i = line.indexOf('=');
      if (i <= 0) {
        setErrors({ valueMap: `Ligne « ${line} » : format « valeur reçue = valeur à enregistrer » attendu.` });
        return;
      }
      valueMap[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const parsed = instrumentMappingSchema.safeParse({ ...form, valueMap });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ id: inst.id, body: parsed.data });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <Modal
      open={!!mapping}
      onClose={onClose}
      title={existing ? `Code « ${existing.instrumentCode} »` : 'Nouvelle correspondance'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="mapping-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="mapping-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <TextField label="Code envoyé par l’automate" required disabled={!!existing} placeholder="HGB, GLU, HIV1VL…" value={form.instrumentCode} onChange={(e) => setForm((f) => ({ ...f, instrumentCode: e.target.value }))} error={errors.instrumentCode} containerClassName="sm:col-span-2" />
        {existing && (
          <p className="text-sm text-slate-600 sm:col-span-2">
            Paramètre actuel : <strong>{existing.parameter.name}</strong> ({existing.parameter.examCode}). Choisissez un autre examen pour le changer.
          </p>
        )}
        <SelectField label="Examen" value={examId} onChange={(e) => { setExamId(e.target.value); setForm((f) => ({ ...f, parameterId: existing && !e.target.value ? existing.parameter.id : '' })); }}>
          <option value="">{existing ? 'Conserver' : 'Choisir…'}</option>
          {(exams.data?.items ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.code} — {x.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Paramètre" required value={form.parameterId} onChange={(e) => setForm((f) => ({ ...f, parameterId: e.target.value }))} disabled={!examId} error={errors.parameterId}>
          {!examId && existing ? <option value={existing.parameter.id}>{existing.parameter.name}</option> : <option value="">Choisir…</option>}
          {(exam.data?.parameters ?? []).filter((p) => p.isActive).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.unit ? ` (${p.unit})` : ''}
            </option>
          ))}
        </SelectField>
        <TextField label="Facteur de conversion" inputMode="decimal" hint="Valeur enregistrée = valeur reçue × facteur (ex. glucose mmol/L → g/L : 0,18016). 1 = aucune conversion." value={form.factor} onChange={(e) => setForm((f) => ({ ...f, factor: e.target.value }))} error={errors.factor} containerClassName="sm:col-span-2" />
        <TextAreaField
          label="Correspondance des valeurs"
          placeholder={'Target Not Detected = <40\nPOS = Positif\nNEG = Négatif'}
          hint="Une ligne par valeur : « valeur reçue = valeur à enregistrer » (casse ignorée)."
          value={form.valueMap}
          onChange={(e) => setForm((f) => ({ ...f, valueMap: e.target.value }))}
          error={errors.valueMap}
          containerClassName="sm:col-span-2"
        />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-4 accent-brand-700" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          Correspondance active
        </label>
      </form>
    </Modal>
  );
}

function QcLinksCard({ inst, canConfig }: { inst: InstrumentDto; canConfig: boolean }) {
  const materials = useQuery(qcMaterialsQuery(false));
  const save = useSaveQcLink();
  const remove = useRemoveQcLink();
  const [form, setForm] = useState({ specimenId: '', materialId: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">Contrôles qualité transmis par l’automate</h2>
      <p className="mb-3 text-xs text-slate-500">Identifiant d’échantillon que l’automate envoie pour un contrôle → lot de contrôle. Ces résultats alimentent directement le CIQ (règles de Westgard).</p>
      {inst.qcMaterials.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {inst.qcMaterials.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-mono font-semibold">{q.specimenId}</span> → {q.material.name} — {q.material.level} <span className="text-xs text-slate-400">lot {q.material.lotNumber}</span>
                {!q.material.isActive && <Badge>lot inactif</Badge>}
              </span>
              {canConfig && <IconAction label="Retirer" icon={Trash2} danger onClick={() => void remove.mutateAsync({ id: inst.id, linkId: q.id })} />}
            </li>
          ))}
        </ul>
      )}
      {canConfig && (
        <form
          className="flex flex-wrap items-end gap-2"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const parsed = instrumentQcMaterialSchema.safeParse(form);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.');
              return;
            }
            try {
              await save.mutateAsync({ id: inst.id, body: parsed.data });
              setForm({ specimenId: '', materialId: '' });
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <TextField label="Identifiant envoyé" placeholder="QC-N1" value={form.specimenId} onChange={(e) => setForm((f) => ({ ...f, specimenId: e.target.value }))} containerClassName="w-40" />
          <SelectField label="Lot de contrôle" value={form.materialId} onChange={(e) => setForm((f) => ({ ...f, materialId: e.target.value }))} containerClassName="min-w-64 flex-1">
            <option value="">Choisir…</option>
            {(materials.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.level} (lot {m.lotNumber})
              </option>
            ))}
          </SelectField>
          <Button type="submit" size="sm" icon={Plus} loading={save.isPending}>
            Relier
          </Button>
          {error && <p className="w-full text-xs text-red-700">{error}</p>}
        </form>
      )}
    </Card>
  );
}

function UploadCard({ inst }: { inst: InstrumentDto }) {
  const upload = useUploadFile();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<IngestResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    if (file.size > 2_000_000) {
      setError('Fichier trop volumineux (2 Mo maximum).');
      return;
    }
    const buf = await file.arrayBuffer();
    // Les automates exportent souvent en Windows-1252 : on garde l'UTF-8 s'il est valide.
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      content = new TextDecoder('windows-1252').decode(buf);
    }
    try {
      setResult(await upload.mutateAsync({ id: inst.id, content, filename: file.name }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  const counts = result ? (Object.entries(result.counts) as [InstrumentResultStatus, number][]) : [];
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">Importer un fichier de l’automate</h2>
      <p className="mb-3 text-xs text-slate-500">Export {INSTRUMENT_PROTOCOL_LABELS[inst.protocol]} récupéré sur clé USB ou dossier partagé. Un fichier déjà importé est reconnu et n’est pas réintégré.</p>
      <input ref={input} type="file" accept=".txt,.csv,.astm,.hl7,.dat" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      <Button size="sm" variant="secondary" icon={Upload} loading={upload.isPending} onClick={() => input.current?.click()} disabled={!inst.isActive}>
        Choisir un fichier
      </Button>
      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
      {result && (
        <Alert tone={result.status === 'FAILED' ? 'error' : result.status === 'PARTIAL' ? 'warning' : 'success'} className="mt-3" title={result.duplicate ? 'Fichier déjà importé : rien n’a été réintégré.' : result.status === 'FAILED' ? 'Fichier illisible' : 'Fichier importé'}>
          {counts.length > 0 && <p>{counts.map(([k, v]) => `${INSTRUMENT_RESULT_STATUS_LABELS[k]} : ${v}`).join(' · ')}</p>}
          {result.warnings.map((w) => (
            <p key={w} className="text-xs">
              {w}
            </p>
          ))}
          {result.status === 'PARTIAL' && (
            <Link to="/automates" className="text-xs font-medium underline">
              Voir les résultats à traiter
            </Link>
          )}
        </Alert>
      )}
    </Card>
  );
}

function ConnectorCard({ inst }: { inst: InstrumentDto }) {
  const { hasRole } = useAuth();
  const rotate = useRotateKey();
  const [shown, setShown] = useState<InstrumentApiKeyDto | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiUrl = `${window.location.origin}/api`;
  const config = shown
    ? JSON.stringify(
        {
          apiUrl,
          instrumentKey: shown.apiKey,
          protocol: inst.protocol === 'HL7' ? 'hl7' : inst.protocol === 'CSV' ? 'file' : 'astm',
          mode: inst.protocol === 'CSV' ? 'folder' : 'tcp-server',
          ...(inst.protocol === 'CSV' ? { folder: 'depot', pollSeconds: 10 } : { host: '0.0.0.0', port: 5000 }),
          encoding: 'latin1',
        },
        null,
        2,
      )
    : '';
  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <KeyRound className="size-4 text-brand-700" aria-hidden /> Connecteur de poste
      </h2>
      <p className="mt-1 text-xs text-slate-500">Programme installé sur le PC relié à l’automate (TCP, HL7 MLLP ou dossier d’export) ; il garde les messages en file d’attente si le réseau tombe.</p>
      <p className="mt-2 text-sm">
        Clé : {inst.apiKeyPrefix ? <span className="font-mono text-xs">{inst.apiKeyPrefix}</span> : <span className="text-amber-700">non émise</span>}
        {inst.apiKeyRotatedAt && <span className="block text-xs text-slate-500">émise le {formatDateTime(inst.apiKeyRotatedAt)}</span>}
      </p>
      {hasRole(...INSTRUMENT_KEY_ROLES) && (
        <Button size="sm" variant="secondary" icon={KeyRound} className="mt-2" onClick={() => setConfirm(true)}>
          {inst.apiKeyPrefix ? 'Renouveler la clé' : 'Émettre la clé'}
        </Button>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={inst.apiKeyPrefix ? 'Renouveler la clé du connecteur' : 'Émettre la clé du connecteur'}
        description={inst.apiKeyPrefix ? 'L’ancienne clé sera refusée immédiatement : le connecteur en place s’arrêtera de transmettre jusqu’à la mise à jour de sa configuration.' : 'La clé ne sera affichée qu’une seule fois.'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Annuler
            </Button>
            <Button
              loading={rotate.isPending}
              onClick={async () => {
                setError(null);
                try {
                  setShown(await rotate.mutateAsync(inst.id));
                  setConfirm(false);
                } catch (err) {
                  setError(errorMessage(err));
                  setConfirm(false);
                }
              }}
            >
              Confirmer
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Automate {inst.code}.</p>
      </Modal>
      <Modal open={!!shown} onClose={() => setShown(null)} size="lg" title="Clé du connecteur" description="Copiez-la maintenant : elle ne sera plus jamais affichée. Seule son empreinte est conservée par le SIL.">
        {shown && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md bg-slate-100 p-3 font-mono text-xs break-all">
              {shown.apiKey}
              <IconAction
                label="Copier la clé"
                icon={Copy}
                onClick={() => {
                  void navigator.clipboard?.writeText(shown.apiKey);
                  setCopied(true);
                }}
              />
            </div>
            {copied && <p className="text-xs text-emerald-700">Clé copiée.</p>}
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Fichier config.json du connecteur (à adapter : port, dossier, encodage)</p>
              <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-100">{config}</pre>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function WorklistCard({ id }: { id: string }) {
  const { data, isLoading } = useQuery(instrumentWorklistQuery(id));
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <ListChecks className="size-4 text-brand-700" aria-hidden /> Liste de travail
      </h2>
      <p className="mt-1 text-xs text-slate-500">Échantillons reçus en attente de tests réalisables par cet automate (transmise à l’automate sur requête hôte ASTM).</p>
      {isLoading ? (
        <LoadingBlock />
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{data?.orders.length ?? 0}</p>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
            {(data?.orders ?? []).slice(0, 30).map((o) => (
              <li key={o.sampleNumber} className="flex justify-between gap-2">
                <span className="font-mono">
                  {o.sampleNumber}
                  {o.priority === 'URGENT' && <span className="ml-1 font-sans font-semibold text-red-700">urgent</span>}
                </span>
                <span className="text-slate-500">{o.tests.join(', ')}</span>
              </li>
            ))}
          </ul>
          {data && data.orders.length > 0 && (
            <button className="mt-2 text-xs font-medium text-brand-700 hover:underline" onClick={() => setOpen((v) => !v)}>
              {open ? 'Masquer' : 'Voir'} le message ASTM
            </button>
          )}
          {open && <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-slate-900 p-2 text-[10px] text-slate-100">{data?.astm.replace(/\r/g, '\n')}</pre>}
        </>
      )}
    </Card>
  );
}
