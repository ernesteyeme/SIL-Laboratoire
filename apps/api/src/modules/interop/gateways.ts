import { Injectable } from '@nestjs/common';
import type { Dhis2DataValueSet } from '@lims/shared';
import { InteropHttpClient, InteropTransportError, type ConnectionProfile, type HttpReply } from './interop-http';
import {
  httpFailureMessage,
  parseDhis2ImportSummary,
  parseDhis2SystemInfo,
  parseVlsmLogin,
  parseVlsmSave,
  parseVlsmVersion,
  type Dhis2ImportOutcome,
  type VlsmSaveOutcome,
} from './protocols';

export interface ExchangeTrace {
  httpStatus: number | null;
  openhimTransactionId: string | null;
  durationMs: number;
}

export interface ConnectionCheck extends ExchangeTrace {
  ok: boolean;
  message: string;
}

const trace = (r: HttpReply): ExchangeTrace => ({ httpStatus: r.status, openhimTransactionId: r.openhimTransactionId, durationMs: r.durationMs });

/** Échanges avec DHIS2 (API Web, ressource dataValueSets). */
@Injectable()
export class Dhis2Gateway {
  constructor(private readonly http: InteropHttpClient) {}

  async check(profile: ConnectionProfile): Promise<ConnectionCheck> {
    const r = await this.http.send(profile, { method: 'GET', path: '/api/system/info' });
    if (r.status !== 200) return { ok: false, message: httpFailureMessage('DHIS2', r.status), ...trace(r) };
    const version = parseDhis2SystemInfo(r.json);
    return version ? { ok: true, message: version, ...trace(r) } : { ok: false, message: 'Le serveur a répondu mais ne ressemble pas à DHIS2 (/api/system/info sans version).', ...trace(r) };
  }

  /** POST /api/dataValueSets (création ou mise à jour), en simulation si `dryRun`. */
  async postDataValueSet(profile: ConnectionProfile, set: Dhis2DataValueSet, dryRun: boolean): Promise<{ outcome: Dhis2ImportOutcome } & ExchangeTrace> {
    const r = await this.http.send(profile, {
      method: 'POST',
      path: '/api/dataValueSets',
      query: { dryRun: String(dryRun), importStrategy: 'CREATE_AND_UPDATE', async: 'false' },
      body: set,
    });
    return { outcome: parseDhis2ImportSummary(r.status, r.json), ...trace(r) };
  }
}

/** Échanges avec VLSM / InteLIS (API REST v1.1 du Sample Tracking System). */
@Injectable()
export class VlsmGateway {
  constructor(private readonly http: InteropHttpClient) {}

  /**
   * Jeton Bearer pour la suite de l'échange : connexion /user/login.php (identifiant et mot de passe),
   * ou aucun (jeton statique, ou authentification portée par le canal OpenHIM).
   */
  async bearer(profile: ConnectionProfile): Promise<{ token: string | undefined; trace: ExchangeTrace | null }> {
    if (profile.transport === 'OPENHIM' || profile.authMode === 'TOKEN') return { token: undefined, trace: null };
    const r = await this.http.send(profile, { method: 'POST', path: '/user/login.php', body: { userName: profile.username, password: profile.secret } });
    const login = parseVlsmLogin(r.status, r.json);
    if (!login.ok) throw new VlsmAuthError(login.message, trace(r));
    return { token: login.token, trace: trace(r) };
  }

  async check(profile: ConnectionProfile): Promise<ConnectionCheck> {
    let loginTrace: ExchangeTrace | null = null;
    try {
      loginTrace = (await this.bearer(profile)).trace;
    } catch (e) {
      if (e instanceof VlsmAuthError) return { ok: false, message: e.message, ...e.trace };
      throw e;
    }
    const r = await this.http.send(profile, { method: 'GET', path: '/version.php' });
    if (r.status !== 200) return { ok: false, message: httpFailureMessage('VLSM', r.status), ...trace(r), durationMs: r.durationMs + (loginTrace?.durationMs ?? 0) };
    const version = parseVlsmVersion(r.json);
    if (!version) return { ok: false, message: 'Le serveur a répondu mais ne ressemble pas à VLSM/InteLIS (/version.php sans version).', ...trace(r) };
    const auth = loginTrace ? ' — connexion API réussie' : profile.transport === 'OPENHIM' ? ' — via OpenHIM' : ' — jeton d’API';
    return { ok: true, message: `VLSM/InteLIS ${version}${auth}`, ...trace(r), durationMs: r.durationMs + (loginTrace?.durationMs ?? 0) };
  }

  async saveRequests(profile: ConnectionProfile, token: string | undefined, testType: 'VL' | 'EID', records: Record<string, unknown>[], appVersion: string): Promise<{ outcome: VlsmSaveOutcome } & ExchangeTrace> {
    const r = await this.http.send(profile, {
      method: 'POST',
      path: testType === 'VL' ? '/vl/save-request.php' : '/eid/save-request.php',
      bearer: token,
      body: { appVersion, data: records },
    });
    return { outcome: parseVlsmSave(r.status, r.json), ...trace(r) };
  }
}

export class VlsmAuthError extends Error {
  constructor(
    message: string,
    readonly trace: ExchangeTrace,
  ) {
    super(message);
  }
}

export { InteropTransportError };
