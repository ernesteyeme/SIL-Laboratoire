import type { User } from '../../generated/prisma/client';
import type { AuditService } from '../../core/audit/audit.service';
import type { AppConfig } from '../../core/config/app-config';
import { DomainException } from '../../core/errors/domain.exception';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { PasswordService } from '../../core/security/password.service';
import type { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';
import type { SessionsRepository } from './sessions.repository';
import { hashSecret, type SessionTokensService } from './session-tokens.service';

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f',
    username: 'jdoe',
    email: null,
    fullName: 'Jean Doe',
    passwordHash: 'hash',
    isServiceAccount: false,
    roles: ['TECHNICIEN'],
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    passwordChangedAt: now,
    createdAt: now,
    updatedAt: now,
    createdById: null,
    deactivatedAt: null,
    deactivatedById: null,
    deactivationReason: null,
    ...overrides,
  };
}

const session = {
  response: { accessToken: 'jwt', expiresIn: 900, user: {} },
  refreshToken: 'id.secret',
  refreshTokenId: 'rt-1',
};

function setup(user: User | null) {
  const tx = { tx: true };
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const users = {
    findByUsername: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    update: jest.fn((_id: string, data: Partial<User>) => Promise.resolve({ ...user, ...data })),
    lockForUpdate: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<UsersRepository>;
  const sessions = {
    findByIdWithUser: jest.fn(),
    revokeIfActive: jest.fn().mockResolvedValue(true),
    revokeFamily: jest.fn().mockResolvedValue(2),
    revokeAllForUser: jest.fn().mockResolvedValue(1),
  } as unknown as jest.Mocked<SessionsRepository>;
  const sessionTokens = { issue: jest.fn().mockResolvedValue(session) } as unknown as jest.Mocked<SessionTokensService>;
  const passwords = {
    verify: jest.fn(),
    verifyDummy: jest.fn().mockResolvedValue(undefined),
    hash: jest.fn().mockResolvedValue('new-hash'),
  } as unknown as jest.Mocked<PasswordService>;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;
  const config = { loginMaxAttempts: 3, loginLockMs: 15 * 60_000 } as AppConfig;

  const service = new AuthService(prisma, users, sessions, sessionTokens, passwords, audit, config);
  return { service, users, sessions, sessionTokens, passwords, audit, tx };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(DomainException);
  await promise.catch((e: DomainException) => {
    expect((e.getResponse() as { code: string }).code).toBe(code);
  });
}

describe('AuthService.login', () => {
  const client = { ip: '10.0.0.1', userAgent: 'jest' };

  it('ouvre une session et journalise LOGIN_SUCCESS avec un mot de passe correct', async () => {
    const ctx = setup(makeUser({ failedLoginCount: 2 }));
    ctx.passwords.verify.mockResolvedValue(true);

    const result = await ctx.service.login({ username: 'jdoe', password: 'ok' }, client);

    expect(result).toBe(session);
    expect(ctx.users.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
      ctx.tx,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(ctx.tx, expect.objectContaining({ action: 'LOGIN_SUCCESS' }));
  });

  it('refuse un identifiant inconnu sans révéler son inexistence', async () => {
    const ctx = setup(null);
    await expectCode(ctx.service.login({ username: 'ghost', password: 'x' }, client), 'INVALID_CREDENTIALS');
    expect(ctx.passwords.verifyDummy).toHaveBeenCalled();
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'LOGIN_FAILURE', after: expect.objectContaining({ cause: 'UNKNOWN_USER' }) }),
    );
  });

  it('refuse un compte désactivé avec le même message générique', async () => {
    const ctx = setup(makeUser({ isActive: false }));
    await expectCode(ctx.service.login({ username: 'jdoe', password: 'ok' }, client), 'INVALID_CREDENTIALS');
    expect(ctx.passwords.verify).not.toHaveBeenCalled();
  });

  it('incrémente le compteur d’échecs sur mauvais mot de passe', async () => {
    const ctx = setup(makeUser({ failedLoginCount: 0 }));
    ctx.passwords.verify.mockResolvedValue(false);

    await expectCode(ctx.service.login({ username: 'jdoe', password: 'bad' }, client), 'INVALID_CREDENTIALS');
    expect(ctx.users.update).toHaveBeenCalledWith(expect.any(String), { failedLoginCount: 1 }, ctx.tx);
  });

  it('verrouille le compte quand le seuil est atteint', async () => {
    const ctx = setup(makeUser({ failedLoginCount: 2 }));
    ctx.passwords.verify.mockResolvedValue(false);

    await expectCode(ctx.service.login({ username: 'jdoe', password: 'bad' }, client), 'ACCOUNT_LOCKED');
    expect(ctx.users.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ failedLoginCount: 0, lockedUntil: expect.any(Date) }),
      ctx.tx,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(ctx.tx, expect.objectContaining({ action: 'ACCOUNT_LOCKED' }));
  });

  it('refuse un compte verrouillé sans vérifier le mot de passe', async () => {
    const ctx = setup(makeUser({ lockedUntil: new Date(Date.now() + 60_000) }));
    await expectCode(ctx.service.login({ username: 'jdoe', password: 'ok' }, client), 'ACCOUNT_LOCKED');
    expect(ctx.passwords.verify).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  const client = { ip: null, userAgent: null };
  const tokenId = '0b4f7a62-1c2d-4e3f-9a8b-7c6d5e4f3a2b';
  const secret = 'A'.repeat(43);

  it('rejette un jeton mal formé', async () => {
    const ctx = setup(makeUser());
    await expectCode(ctx.service.refresh('nimporte-quoi', client), 'REFRESH_INVALID');
  });

  it('effectue la rotation d’un jeton valide dans la même famille', async () => {
    const user = makeUser();
    const ctx = setup(user);
    ctx.sessions.findByIdWithUser.mockResolvedValue({
      id: tokenId,
      familyId: 'fam-1',
      tokenHash: hashSecret(secret),
      revokedAt: null,
      revokedReason: null,
      expiresAt: new Date(Date.now() + 60_000),
      user,
    } as never);

    await ctx.service.refresh(`${tokenId}.${secret}`, client);

    expect(ctx.sessionTokens.issue).toHaveBeenCalledWith(user, ctx.tx, client, 'fam-1');
    expect(ctx.sessions.revokeIfActive).toHaveBeenCalledWith(tokenId, 'ROTATED', 'rt-1', ctx.tx);
  });

  it('révoque toute la famille si un jeton déjà tourné est réutilisé', async () => {
    const user = makeUser();
    const ctx = setup(user);
    ctx.sessions.findByIdWithUser.mockResolvedValue({
      id: tokenId,
      familyId: 'fam-1',
      tokenHash: hashSecret(secret),
      revokedAt: new Date(Date.now() - 60 * 60_000),
      revokedReason: 'ROTATED',
      expiresAt: new Date(Date.now() + 60_000),
      user,
    } as never);

    await expectCode(ctx.service.refresh(`${tokenId}.${secret}`, client), 'REFRESH_INVALID');
    expect(ctx.sessions.revokeFamily).toHaveBeenCalledWith('fam-1', 'REUSE_DETECTED', ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(ctx.tx, expect.objectContaining({ action: 'TOKEN_REUSE_DETECTED' }));
  });
});
