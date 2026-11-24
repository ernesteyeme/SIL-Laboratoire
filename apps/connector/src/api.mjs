// Client HTTP du SIL (fetch natif de Node ≥ 20). Clé d'automate dans l'en-tête X-Instrument-Key.

export class ApiError extends Error {
  constructor(status, message, retryable) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export function createApi({ apiUrl, instrumentKey, timeoutMs = 15_000 }) {
  const base = apiUrl.replace(/\/+$/, '');
  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: { 'X-Instrument-Key': instrumentKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ApiError(0, `SIL injoignable (${e.cause?.code ?? e.name}).`, true);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* réponse non JSON */
    }
    if (!res.ok) {
      // 401 : clé révoquée ou automate désactivé → on garde les messages (problème de configuration, pas de données).
      const retryable = res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500;
      throw new ApiError(res.status, json?.message ?? `Erreur HTTP ${res.status}`, retryable);
    }
    return json;
  }
  return {
    ping: () => request('GET', '/instrument-gateway/ping'),
    send: (message) => request('POST', '/instrument-gateway/messages', { message }),
    worklist: (specimens) => request('GET', `/instrument-gateway/worklist${specimens?.length ? `?specimens=${encodeURIComponent(specimens.join(','))}` : ''}`),
  };
}
