import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../core/config/app-config';
import { BusinessRuleError } from '../../core/errors/domain.exception';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Chiffrement AES-256-GCM d'un secret, lié par données authentifiées (AAD) au code de la connexion. */
export function sealSecret(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

/** Déchiffrement ; lève une erreur si la clé, le contexte ou le contenu ne correspondent pas. */
export function openSecret(key: Buffer, sealed: string, context: string): string {
  const [version, payload] = sealed.split(':', 2);
  if (version !== VERSION || !payload) throw new Error('Format de secret inconnu.');
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('Secret tronqué.');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}

/**
 * Coffre des secrets d'interopérabilité (mots de passe, jetons d'API, mots de passe de client OpenHIM).
 * Les secrets sont chiffrés au repos et ne quittent jamais le serveur.
 */
@Injectable()
export class SecretBox {
  constructor(private readonly config: AppConfig) {}

  get ready(): boolean {
    return this.config.interopSecretKey !== null;
  }

  private key(): Buffer {
    const key = this.config.interopSecretKey;
    if (!key) {
      throw new BusinessRuleError('INTEROP_KEY_MISSING', 'La clé de chiffrement INTEROP_SECRET_KEY n’est pas configurée sur le serveur : impossible d’enregistrer ou d’utiliser un secret.');
    }
    return key;
  }

  seal(plaintext: string, endpointCode: string): string {
    return sealSecret(this.key(), plaintext, `interop:${endpointCode}`);
  }

  open(sealed: string, endpointCode: string): string {
    try {
      return openSecret(this.key(), sealed, `interop:${endpointCode}`);
    } catch {
      throw new BusinessRuleError('INTEROP_SECRET_UNREADABLE', 'Le secret enregistré ne peut pas être déchiffré (clé INTEROP_SECRET_KEY changée ?) : saisissez-le à nouveau.');
    }
  }
}
