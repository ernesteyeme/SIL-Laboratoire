import type { ApiErrorBody, AuthResponse, ValidationIssue } from '@lims/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

/** Erreur normalisée renvoyée par l'API (voir AllExceptionsFilter côté serveur). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Erreurs de validation par champ, si l'API en a fourni. */
  get fieldErrors(): ValidationIssue[] {
    return Array.isArray(this.details)
      ? (this.details as ValidationIssue[]).filter((d) => typeof d?.path === 'string' && typeof d?.message === 'string')
      : [];
  }
}

// --- Gestion du jeton d'accès (en mémoire uniquement, jamais dans localStorage) ---

let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse | null> | null = null;
const sessionListeners = new Set<(session: AuthResponse | null) => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Notifie le fournisseur d'authentification quand la session change (rafraîchie ou perdue). */
export function onSessionChange(listener: (session: AuthResponse | null) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/**
 * Rafraîchit la session via le cookie httpOnly.
 * Un seul appel à la fois : les requêtes concurrentes partagent la même promesse
 * (indispensable car le serveur fait une rotation du jeton à chaque appel).
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const session = (await res.json()) as AuthResponse;
      setAccessToken(session.accessToken);
      return session;
    } catch {
      return null;
    } finally {
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })().then((session) => {
    sessionListeners.forEach((l) => l(session));
    return session;
  });
  return refreshInFlight;
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Ne pas tenter de rafraîchir la session sur 401 (routes d'authentification). */
  skipRefresh?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    return new ApiError(
      res.status,
      body.code ?? `HTTP_${res.status}`,
      body.message ?? 'Erreur inattendue.',
      body.details,
      body.requestId,
    );
  } catch {
    return new ApiError(res.status, `HTTP_${res.status}`, 'Le serveur a renvoyé une réponse inattendue.');
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = () =>
    fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      credentials: 'include',
      signal: options.signal,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res: Response;
  try {
    res = await send();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Serveur injoignable. Vérifiez votre connexion réseau.');
  }

  if (res.status === 401 && !options.skipRefresh) {
    const session = await refreshSession();
    if (session) {
      res = await send();
    }
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  // Un contrôleur qui renvoie null produit une réponse vide : on la restitue en null.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Téléchargement d'un fichier protégé (PDF…) : même authentification et même rafraîchissement de session que api(). */
export async function apiBlob(path: string): Promise<{ blob: Blob; headers: Headers }> {
  const send = () =>
    fetch(buildUrl(path), { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Serveur injoignable. Vérifiez votre connexion réseau.');
  }
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) throw await toApiError(res);
  return { blob: await res.blob(), headers: res.headers };
}
