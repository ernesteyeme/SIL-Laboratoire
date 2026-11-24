import type { Dhis2ConflictDto, InteropRunStatus } from '@lims/shared';

/**
 * Lecture des réponses des systèmes distants. Fonctions pures, sans accès réseau ni base,
 * testées unitairement sur des réponses réelles de DHIS2 (2.36 → 2.41) et de VLSM/InteLIS (API v1.1).
 */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const asText = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : null);

export interface Dhis2ImportOutcome {
  status: InteropRunStatus;
  imported: number | null;
  updated: number | null;
  ignored: number | null;
  deleted: number | null;
  conflicts: Dhis2ConflictDto[];
  message: string;
}

export const MAX_STORED_CONFLICTS = 200;

/** Message lisible pour un code HTTP d'échec, quand le corps de réponse n'en fournit pas. */
export function httpFailureMessage(system: string, status: number): string {
  if (status === 401) return `${system} a refusé les identifiants (HTTP 401).`;
  if (status === 403) return `${system} refuse l’accès : droits insuffisants pour ce compte (HTTP 403).`;
  if (status === 404) return `Adresse introuvable sur ${system} (HTTP 404) : vérifiez l’URL de base ou le canal OpenHIM.`;
  if (status === 409) return `${system} a rejeté les données (HTTP 409).`;
  if (status >= 500) return `${system} a rencontré une erreur interne (HTTP ${status}).`;
  return `${system} a répondu HTTP ${status}.`;
}

/**
 * Interprète la réponse de POST /api/dataValueSets : WebMessage (DHIS2 ≥ 2.38, champ `response`)
 * ou ImportSummary direct (versions antérieures). Une importation avec conflits est un succès
 * partiel (WARNING) ; les valeurs inchangées (ignorées) ne le sont pas.
 */
export function parseDhis2ImportSummary(httpStatus: number, body: unknown): Dhis2ImportOutcome {
  const root = isObject(body) ? body : null;
  const summary = root && isObject(root.response) && root.response.responseType === 'ImportSummary' ? root.response : root?.responseType === 'ImportSummary' ? root : null;
  if (!summary) {
    const message = asText(root?.message) ?? (httpStatus >= 200 && httpStatus < 300 ? 'Réponse DHIS2 sans résumé d’importation.' : httpFailureMessage('DHIS2', httpStatus));
    return { status: httpStatus >= 200 && httpStatus < 300 ? 'WARNING' : 'ERROR', imported: null, updated: null, ignored: null, deleted: null, conflicts: [], message };
  }
  const count = isObject(summary.importCount) ? summary.importCount : {};
  const conflicts: Dhis2ConflictDto[] = (Array.isArray(summary.conflicts) ? summary.conflicts : [])
    .filter(isObject)
    .slice(0, MAX_STORED_CONFLICTS)
    .map((c) => ({ object: asText(c.object, 100), value: asText(c.value, 500) ?? '', errorCode: asText(c.errorCode, 20) }));
  const imported = asInt(count.imported);
  const updated = asInt(count.updated);
  const ignored = asInt(count.ignored);
  const deleted = asInt(count.deleted);
  const remote = String(summary.status ?? '').toUpperCase();
  let status: InteropRunStatus = remote === 'ERROR' ? 'ERROR' : remote === 'WARNING' ? 'WARNING' : 'SUCCESS';
  // Une valeur inchangée est « ignorée » par DHIS2 sans être une anomalie : seuls les conflits dégradent le statut.
  if (status === 'SUCCESS' && conflicts.length > 0) status = 'WARNING';
  if (httpStatus >= 400 && status === 'SUCCESS') status = 'ERROR';
  const parts = [`importées ${imported ?? 0}`, `mises à jour ${updated ?? 0}`, `ignorées ${ignored ?? 0}`, `supprimées ${deleted ?? 0}`];
  const description = asText(summary.description) ?? asText(root?.message);
  const message = `Valeurs ${parts.join(', ')}${conflicts.length ? ` — ${conflicts.length} conflit(s)` : ''}${description ? ` — ${description}` : ''}`.slice(0, 1000);
  return { status, imported, updated, ignored, deleted, conflicts, message };
}

/** Version de DHIS2 renvoyée par /api/system/info. */
export function parseDhis2SystemInfo(body: unknown): string | null {
  if (!isObject(body)) return null;
  const version = asText(body.version, 40);
  if (!version) return null;
  const name = asText(body.systemName, 80);
  return name ? `DHIS2 ${version} — ${name}` : `DHIS2 ${version}`;
}

export type VlsmLoginOutcome = { ok: true; token: string } | { ok: false; message: string };

/** Réponse de POST /user/login.php : `status` vaut 1 (jeton émis), 2 (refus) ou « failed ». */
export function parseVlsmLogin(httpStatus: number, body: unknown): VlsmLoginOutcome {
  if (!isObject(body)) return { ok: false, message: httpStatus >= 400 ? httpFailureMessage('VLSM', httpStatus) : 'Réponse de connexion VLSM illisible.' };
  const token = isObject(body.data) ? asText(body.data.api_token, 500) : null;
  if ((body.status === 1 || body.status === '1') && token) return { ok: true, token };
  if (body.status === 2 || body.status === '2') return { ok: false, message: 'VLSM a refusé l’identifiant, le mot de passe ou l’accès API de ce compte.' };
  return { ok: false, message: asText(body.message) ?? (httpStatus >= 400 ? httpFailureMessage('VLSM', httpStatus) : 'Connexion VLSM impossible.') };
}

export interface VlsmRecordOutcome {
  appSampleCode: string | null;
  uniqueId: string | null;
  ok: boolean;
  sampleCode: string | null;
  message: string | null;
}

export interface VlsmSaveOutcome {
  /** Échec global (authentification, erreur serveur) : aucun enregistrement n'est considéré comme reçu. */
  globalError: string | null;
  records: VlsmRecordOutcome[];
  /** Jeton renouvelé par le serveur pendant l'appel (token_updated). */
  rotatedToken: string | null;
}

/** Réponse de POST /vl/save-request.php ou /eid/save-request.php : un résultat par enregistrement, dans l'ordre envoyé. */
export function parseVlsmSave(httpStatus: number, body: unknown): VlsmSaveOutcome {
  if (!isObject(body)) {
    return { globalError: httpStatus >= 400 ? httpFailureMessage('VLSM', httpStatus) : 'Réponse VLSM illisible.', records: [], rotatedToken: null };
  }
  const rotatedToken = body.token_updated === true ? asText(body.new_token, 500) ?? asText(body.token, 500) : null;
  const records: VlsmRecordOutcome[] = (Array.isArray(body.data) ? body.data : []).filter(isObject).map((r) => {
    const ok = String(r.status ?? '').toLowerCase() === 'success';
    return {
      appSampleCode: asText(r.appSampleCode, 100),
      uniqueId: asText(r.uniqueId, 64),
      ok,
      sampleCode: asText(r.sampleCode, 100),
      message: ok ? asText(r.action, 50) : asText(r.message) ?? asText(r.error) ?? 'Enregistrement refusé par VLSM.',
    };
  });
  const top = String(body.status ?? '').toLowerCase();
  if (httpStatus >= 400 || (top !== 'success' && records.length === 0)) {
    const detail = asText(body.message) ?? asText(body.error);
    return { globalError: detail ?? httpFailureMessage('VLSM', httpStatus), records, rotatedToken };
  }
  return { globalError: null, records, rotatedToken };
}

/** Version du serveur VLSM renvoyée par GET /version.php. */
export function parseVlsmVersion(body: unknown): string | null {
  return isObject(body) ? asText(body.version, 40) : null;
}
