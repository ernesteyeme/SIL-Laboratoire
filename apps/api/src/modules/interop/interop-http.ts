import { Injectable } from '@nestjs/common';
import type { InteropAuthMode, InteropSystem, InteropTransport } from '@lims/shared';

/** Taille maximale acceptée pour une réponse distante (5 Mo). */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface ConnectionProfile {
  system: InteropSystem;
  transport: InteropTransport;
  baseUrl: string;
  authMode: InteropAuthMode;
  username: string | null;
  /** Secret déchiffré, en mémoire le temps de l'échange. */
  secret: string | null;
  timeoutSeconds: number;
}

export interface HttpRequest {
  method: 'GET' | 'POST';
  /** Chemin relatif à l'URL de base, ex. « /api/dataValueSets ». */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Jeton Bearer obtenu après connexion (VLSM). */
  bearer?: string;
}

export interface HttpReply {
  status: number;
  json: unknown;
  text: string;
  openhimTransactionId: string | null;
  durationMs: number;
}

/** Échec de transport (réseau, délai, réponse trop volumineuse) : le système distant n'a pas répondu. */
export class InteropTransportError extends Error {
  constructor(
    message: string,
    readonly durationMs: number,
  ) {
    super(message);
  }
}

const basic = (user: string, secret: string) => `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;

/**
 * En-tête d'authentification selon le transport :
 * - via OpenHIM, l'appelant est un client OpenHIM (Basic) ; les identifiants du système cible sont portés par le canal ;
 * - DHIS2 en direct : Basic, ou jeton d'accès personnel (« ApiToken d2pat_… ») ;
 * - VLSM en direct : Bearer (jeton d'API statique, ou jeton obtenu par /user/login.php).
 */
export function authorizationHeader(profile: ConnectionProfile, bearer?: string): string | null {
  if (profile.transport === 'OPENHIM') return profile.username && profile.secret ? basic(profile.username, profile.secret) : null;
  if (profile.system === 'DHIS2') {
    if (!profile.secret) return null;
    return profile.authMode === 'TOKEN' ? `ApiToken ${profile.secret}` : profile.username ? basic(profile.username, profile.secret) : null;
  }
  const token = bearer ?? (profile.authMode === 'TOKEN' ? profile.secret : null);
  return token ? `Bearer ${token}` : null;
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, string>): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

function describeNetworkError(e: unknown, timeoutSeconds: number): string {
  const err = e as { name?: string; cause?: { code?: string; message?: string }; message?: string };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `Délai de ${timeoutSeconds} s dépassé sans réponse du serveur distant.`;
  const code = err?.cause?.code;
  if (code === 'ECONNREFUSED') return 'Connexion refusée par le serveur distant (service arrêté ou port fermé).';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Nom de serveur introuvable (DNS) : vérifiez l’adresse.';
  if (code === 'ECONNRESET') return 'Connexion interrompue par le serveur distant.';
  if (code && /CERT|SSL|TLS/.test(code)) return `Certificat TLS du serveur distant refusé (${code}).`;
  return `Échec réseau : ${err?.cause?.message ?? err?.message ?? 'erreur inconnue'}.`.slice(0, 300);
}

/** Client HTTP des échanges sortants (fetch natif de Node, délai borné, taille de réponse bornée). */
@Injectable()
export class InteropHttpClient {
  async send(profile: ConnectionProfile, req: HttpRequest): Promise<HttpReply> {
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'LIMS-ISO15189/1.0' };
    const auth = authorizationHeader(profile, req.bearer);
    if (auth) headers.Authorization = auth;
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(buildUrl(profile.baseUrl, req.path, req.query), {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        redirect: 'manual',
        signal: AbortSignal.timeout(profile.timeoutSeconds * 1000),
      });
    } catch (e) {
      throw new InteropTransportError(describeNetworkError(e, profile.timeoutSeconds), Date.now() - started);
    }
    let buffer: ArrayBuffer;
    try {
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_RESPONSE_BYTES) throw new Error('too-large');
      buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error('too-large');
    } catch (e) {
      const tooLarge = (e as Error).message === 'too-large';
      throw new InteropTransportError(tooLarge ? 'Réponse du serveur distant trop volumineuse (> 5 Mo).' : describeNetworkError(e, profile.timeoutSeconds), Date.now() - started);
    }
    const text = new TextDecoder('utf-8').decode(buffer);
    let json: unknown = null;
    if (text.trim() !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (res.status >= 300 && res.status < 400) {
      throw new InteropTransportError(`Redirection HTTP ${res.status} refusée${res.headers.get('location') ? ` vers ${res.headers.get('location')}` : ''} : indiquez l’adresse finale (https).`, Date.now() - started);
    }
    return {
      status: res.status,
      json,
      text: text.slice(0, 2000),
      openhimTransactionId: res.headers.get('x-openhim-transactionid')?.slice(0, 100) ?? null,
      durationMs: Date.now() - started,
    };
  }
}
