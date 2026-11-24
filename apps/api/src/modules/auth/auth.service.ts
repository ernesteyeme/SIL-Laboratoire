import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, type AuthUser, type ChangePasswordInput, type LoginInput } from '@lims/shared';
import type { User } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfig } from '../../core/config/app-config';
import type { RequestUser } from '../../core/context/request-context';
import { DomainException } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PasswordService } from '../../core/security/password.service';
import { toAuthUser } from '../users/users.mapper';
import { UsersRepository } from '../users/users.repository';
import { SessionsRepository } from './sessions.repository';
import {
  SessionTokensService,
  parseRefreshToken,
  secretMatches,
  type ClientInfo,
  type IssuedSession,
} from './session-tokens.service';

/** Délai pendant lequel une double rotation (deux onglets) n'est pas considérée comme un vol de jeton. */
const ROTATION_GRACE_MS = 15_000;

const invalidCredentials = () =>
  new DomainException(HttpStatus.UNAUTHORIZED, ERROR_CODES.INVALID_CREDENTIALS, 'Identifiant ou mot de passe incorrect.');

const invalidRefresh = () =>
  new DomainException(
    HttpStatus.UNAUTHORIZED,
    ERROR_CODES.REFRESH_INVALID,
    'Session expirée. Veuillez vous reconnecter.',
  );

const actorOf = (user: User) => ({ id: user.id, username: user.username, roles: user.roles });

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly sessionTokens: SessionTokensService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async login(input: LoginInput, client: ClientInfo): Promise<IssuedSession> {
    const user = await this.users.findByUsername(input.username);

    if (!user) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record(this.prisma, {
        action: 'LOGIN_FAILURE',
        entity: 'Session',
        entityId: input.username,
        after: { username: input.username, cause: 'UNKNOWN_USER' },
        actor: null,
      });
      throw invalidCredentials();
    }

    // Un compte de service (automate) ne peut jamais ouvrir de session interactive.
    if (!user.isActive || user.isServiceAccount) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record(this.prisma, {
        action: 'LOGIN_FAILURE',
        entity: 'Session',
        entityId: user.id,
        after: { username: user.username, cause: user.isServiceAccount ? 'SERVICE_ACCOUNT' : 'ACCOUNT_DISABLED' },
        actor: actorOf(user),
      });
      throw invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit.record(this.prisma, {
        action: 'LOGIN_FAILURE',
        entity: 'Session',
        entityId: user.id,
        after: { username: user.username, cause: 'ACCOUNT_LOCKED' },
        actor: actorOf(user),
      });
      throw this.lockedError(user.lockedUntil);
    }

    const valid = await this.passwords.verify(user.passwordHash, input.password);

    if (!valid) {
      const lockedUntil = await this.registerFailedAttempt(user);
      if (lockedUntil) throw this.lockedError(lockedUntil);
      throw invalidCredentials();
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.users.update(
        user.id,
        { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
        tx,
      );
      const session = await this.sessionTokens.issue(updated, tx, client);
      await this.audit.record(tx, {
        action: 'LOGIN_SUCCESS',
        entity: 'Session',
        entityId: session.refreshTokenId,
        after: { userId: user.id, username: user.username },
        actor: actorOf(updated),
      });
      return session;
    });
  }

  async refresh(rawToken: string | undefined, client: ClientInfo): Promise<IssuedSession> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) throw invalidRefresh();

    const stored = await this.sessions.findByIdWithUser(parsed.id);
    if (!stored || !secretMatches(parsed.secret, stored.tokenHash)) throw invalidRefresh();

    const now = Date.now();

    if (stored.revokedAt) {
      const isRecentRotation =
        stored.revokedReason === 'ROTATED' && now - stored.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (stored.revokedReason === 'ROTATED' && !isRecentRotation) {
        await this.handleTokenReuse(stored.familyId, stored.user);
      }
      throw invalidRefresh();
    }

    if (stored.expiresAt.getTime() <= now) throw invalidRefresh();

    if (!stored.user.isActive) {
      await this.sessions.revokeFamily(stored.familyId, 'DEACTIVATED');
      throw invalidRefresh();
    }

    return this.prisma.$transaction(async (tx) => {
      const session = await this.sessionTokens.issue(stored.user, tx, client, stored.familyId);
      const revoked = await this.sessions.revokeIfActive(stored.id, 'ROTATED', session.refreshTokenId, tx);
      if (!revoked) {
        // Rotation concurrente : l'autre requête a gagné, on annule celle-ci.
        throw invalidRefresh();
      }
      return session;
    });
  }

  async logout(rawToken: string | undefined): Promise<void> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) return;
    const stored = await this.sessions.findByIdWithUser(parsed.id);
    if (!stored || !secretMatches(parsed.secret, stored.tokenHash)) return;

    await this.prisma.$transaction(async (tx) => {
      const count = await this.sessions.revokeFamily(stored.familyId, 'LOGOUT', tx);
      if (count > 0) {
        await this.audit.record(tx, {
          action: 'LOGOUT',
          entity: 'Session',
          entityId: stored.familyId,
          after: { userId: stored.userId, username: stored.user.username },
          actor: actorOf(stored.user),
        });
      }
    });
  }

  async me(current: RequestUser): Promise<AuthUser> {
    const user = await this.users.findById(current.id);
    if (!user) throw invalidRefresh();
    return toAuthUser(user);
  }

  async changePassword(current: RequestUser, input: ChangePasswordInput, client: ClientInfo): Promise<IssuedSession> {
    const user = await this.users.findById(current.id);
    if (!user || !user.isActive) throw invalidRefresh();

    const valid = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!valid) {
      const lockedUntil = await this.registerFailedAttempt(user);
      if (lockedUntil) throw this.lockedError(lockedUntil);
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.CURRENT_PASSWORD_INVALID,
        'Le mot de passe actuel est incorrect.',
        [{ path: 'currentPassword', message: 'Le mot de passe actuel est incorrect.' }],
      );
    }

    const newHash = await this.passwords.hash(input.newPassword);

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.users.update(
        user.id,
        {
          passwordHash: newHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
        tx,
      );
      await this.sessions.revokeAllForUser(user.id, 'PASSWORD_CHANGE', tx);
      const session = await this.sessionTokens.issue(updated, tx, client);
      await this.audit.record(tx, {
        action: 'PASSWORD_CHANGE',
        entity: 'User',
        entityId: user.id,
        before: { mustChangePassword: user.mustChangePassword },
        after: { mustChangePassword: false },
        reason: 'Changement par l’utilisateur',
        actor: actorOf(user),
      });
      return session;
    });
  }

  /** Incrémente le compteur d'échecs ; verrouille le compte au-delà du seuil. Renvoie la date de fin de verrouillage. */
  private async registerFailedAttempt(user: User): Promise<Date | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.users.lockForUpdate(user.id, tx);
      const fresh = await this.users.findById(user.id, tx);
      if (!fresh) return null;

      const attempts = fresh.failedLoginCount + 1;
      const shouldLock = attempts >= this.config.loginMaxAttempts;
      const lockedUntil = shouldLock ? new Date(Date.now() + this.config.loginLockMs) : null;

      await this.users.update(
        user.id,
        shouldLock ? { failedLoginCount: 0, lockedUntil } : { failedLoginCount: attempts },
        tx,
      );

      await this.audit.record(tx, {
        action: 'LOGIN_FAILURE',
        entity: 'Session',
        entityId: user.id,
        after: { username: user.username, cause: 'INVALID_PASSWORD', attempt: attempts },
        actor: actorOf(user),
      });

      if (shouldLock) {
        await this.audit.record(tx, {
          action: 'ACCOUNT_LOCKED',
          entity: 'User',
          entityId: user.id,
          after: { lockedUntil },
          reason: `${attempts} échecs de connexion consécutifs`,
          actor: actorOf(user),
        });
        this.logger.warn(`Compte « ${user.username} » verrouillé après ${attempts} échecs.`);
      }
      return lockedUntil;
    });
  }

  private async handleTokenReuse(familyId: string, user: User): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const count = await this.sessions.revokeFamily(familyId, 'REUSE_DETECTED', tx);
      await this.audit.record(tx, {
        action: 'TOKEN_REUSE_DETECTED',
        entity: 'Session',
        entityId: familyId,
        after: { userId: user.id, username: user.username, revokedTokens: count },
        reason: 'Jeton de rafraîchissement déjà utilisé présenté à nouveau : session révoquée par précaution',
        actor: actorOf(user),
      });
    });
    this.logger.warn(`Réutilisation de jeton détectée pour « ${user.username} » : famille ${familyId} révoquée.`);
  }

  private lockedError(lockedUntil: Date): DomainException {
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
    return new DomainException(
      HttpStatus.UNAUTHORIZED,
      ERROR_CODES.ACCOUNT_LOCKED,
      `Compte temporairement verrouillé suite à plusieurs échecs. Réessayez dans ${minutes} minute(s) ou contactez un administrateur.`,
      { lockedUntil: lockedUntil.toISOString() },
    );
  }
}
