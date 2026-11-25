import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthResponse } from '@lims/shared';
import type { User } from '../../generated/prisma/client';
import { AppConfig } from '../../core/config/app-config';
import type { Db } from '../../core/prisma/prisma.service';
import { AccessTokenService } from '../../core/security/access-token.service';
import { toAuthUser } from '../users/users.mapper';
import { SessionsRepository } from './sessions.repository';

export interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession {
  response: AuthResponse;
  /** Jeton de rafraîchissement en clair, à placer dans le cookie httpOnly. */
  refreshToken: string;
  refreshTokenId: string;
}

/**
 * Émission des sessions : jeton d'accès JWT + jeton de rafraîchissement opaque.
 * Format du jeton de rafraîchissement : `<uuid>.<secret base64url>` ; seul le SHA-256 du secret est stocké.
 */
@Injectable()
export class SessionTokensService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionsRepository,
    private readonly config: AppConfig,
  ) {}

  async issue(user: User, db: Db, client: ClientInfo, familyId: string = randomUUID()): Promise<IssuedSession> {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    await this.sessions.create(
      {
        id,
        userId: user.id,
        familyId,
        tokenHash: hashSecret(secret),
        expiresAt: new Date(Date.now() + this.config.refreshTokenTtlMs),
        ip: client.ip?.slice(0, 64) ?? null,
        userAgent: client.userAgent?.slice(0, 500) ?? null,
      },
      db,
    );

    const accessToken = await this.accessTokens.sign({ sub: user.id, username: user.username, ver: user.tokenVersion });

    return {
      response: {
        accessToken,
        expiresIn: this.accessTokens.ttlSeconds,
        user: toAuthUser(user, (await db.userSection.findMany({ where: { userId: user.id }, select: { sectionId: true } })).map((s) => s.sectionId)),
      },
      refreshToken: `${id}.${secret}`,
      refreshTokenId: id,
    };
  }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Découpe un jeton `<uuid>.<secret>` ; renvoie null s'il est mal formé. */
export function parseRefreshToken(raw: string | undefined | null): { id: string; secret: string } | null {
  if (!raw || raw.length > 200) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{40,}$/.test(secret)) return null;
  return { id, secret };
}

export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
