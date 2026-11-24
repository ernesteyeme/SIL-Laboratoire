import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Paramètres Argon2id recommandés par l'OWASP (m = 19 Mio, t = 2, p = 1). */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  /** Hash factice calculé une fois, pour égaliser le temps de réponse sur un identifiant inconnu. */
  private dummyHashPromise: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plain);
    } catch {
      return false;
    }
  }

  /** Effectue une vérification sur un hash factice (protection contre l'énumération des comptes). */
  async verifyDummy(plain: string): Promise<void> {
    this.dummyHashPromise ??= this.hash('dummy-password-for-timing-equalisation');
    await this.verify(await this.dummyHashPromise, plain);
  }
}
