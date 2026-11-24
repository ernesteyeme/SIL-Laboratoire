/** Champs qui ne doivent jamais apparaître dans la piste d'audit. */
const SECRET_FIELDS = new Set(['passwordHash', 'tokenHash', 'password', 'temporaryPassword', 'currentPassword', 'newPassword']);

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Convertit une entité en JSON sûr pour l'audit :
 * dates → ISO 8601, Decimal/BigInt → chaîne, secrets retirés, clés triées.
 */
export function toAuditJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(toAuditJson);
  if (typeof value === 'object') {
    const maybeDecimal = value as { toFixed?: unknown; d?: unknown; e?: unknown; s?: unknown };
    if (typeof maybeDecimal.toFixed === 'function' && 'd' in maybeDecimal && 's' in maybeDecimal) {
      return String(value);
    }
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (SECRET_FIELDS.has(key)) continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || typeof v === 'function') continue;
      out[key] = toAuditJson(v);
    }
    return out;
  }
  return String(value);
}

/** Liste des champs dont la valeur diffère entre deux états (pour le motif automatique et l'affichage). */
export function changedFields(before: unknown, after: unknown): string[] {
  const b = (toAuditJson(before) ?? {}) as Record<string, Json>;
  const a = (toAuditJson(after) ?? {}) as Record<string, Json>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).sort();
}
