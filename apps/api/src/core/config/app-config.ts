import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Adresse d'écoute : 127.0.0.1 derrière Nginx (installation Ubuntu), 0.0.0.0 dans un conteneur. */
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().url('DATABASE_URL doit être une URL PostgreSQL valide.'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: booleanFromEnv,
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET doit contenir au moins 32 caractères.'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  COOKIE_SECURE: booleanFromEnv,
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Code d'installation exigé par l'assistant du premier démarrage (généré par scripts/setup.sh). */
  SETUP_TOKEN: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || v.length >= 16, 'SETUP_TOKEN doit contenir au moins 16 caractères.'),
  /** Clé AES-256 (32 octets, en base64 ou en hexadécimal) chiffrant les secrets des connexions DHIS2/VLSM/OpenHIM. */
  INTEROP_SECRET_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || decodeKey(v) !== null, 'INTEROP_SECRET_KEY doit faire 32 octets (64 caractères hexadécimaux ou 44 caractères base64).'),
});

/** Décode une clé de 32 octets donnée en hexadécimal ou en base64 ; null si elle est invalide. */
export function decodeKey(value: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
    const buf = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return buf.length === 32 ? buf : null;
  }
  return null;
}

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${lines}`);
  }
  const env = result.data;
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('Configuration invalide : COOKIE_SECURE doit valoir true en production.');
  }
  return env;
}

@Injectable()
export class AppConfig {
  private readonly env: Env;

  constructor() {
    this.env = parseEnv(process.env);
  }

  get nodeEnv() {
    return this.env.NODE_ENV;
  }
  get isProduction() {
    return this.env.NODE_ENV === 'production';
  }
  get host() {
    return this.env.HOST;
  }
  get port() {
    return this.env.PORT;
  }
  get databaseUrl() {
    return this.env.DATABASE_URL;
  }
  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }
  get trustProxy() {
    return this.env.TRUST_PROXY;
  }
  get jwtAccessSecret() {
    return this.env.JWT_ACCESS_SECRET;
  }
  get jwtAccessTtlSeconds() {
    return this.env.JWT_ACCESS_TTL_SECONDS;
  }
  get refreshTokenTtlMs() {
    return this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  }
  get cookieSecure() {
    return this.env.COOKIE_SECURE;
  }
  get loginMaxAttempts() {
    return this.env.LOGIN_MAX_ATTEMPTS;
  }
  /** Clé de chiffrement des secrets d'interopérabilité (null si non configurée). */
  get interopSecretKey(): Buffer | null {
    return this.env.INTEROP_SECRET_KEY ? decodeKey(this.env.INTEROP_SECRET_KEY) : null;
  }
  get setupToken(): string | null {
    return this.env.SETUP_TOKEN ?? null;
  }
  get loginLockMs() {
    return this.env.LOGIN_LOCK_MINUTES * 60 * 1000;
  }
}
