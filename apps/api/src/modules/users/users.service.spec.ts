import type { User } from '../../generated/prisma/client';
import type { AuditService } from '../../core/audit/audit.service';
import type { RequestUser } from '../../core/context/request-context';
import { DomainException } from '../../core/errors/domain.exception';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { PasswordService } from '../../core/security/password.service';
import type { SessionsRepository } from '../auth/sessions.repository';
import type { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: OTHER_ID,
    username: 'bio1',
    email: null,
    fullName: 'Biologiste Un',
    passwordHash: 'hash',
    isServiceAccount: false,
    roles: ['BIOLOGISTE'],
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

const actor: RequestUser = {
  id: ADMIN_ID,
  username: 'admin',
  fullName: 'Admin',
  roles: ['ADMIN'],
  mustChangePassword: false,
};

function setup(target: User | null, otherActiveAdmins = 1) {
  const tx = { tx: true };
  const prisma = { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
  const users = {
    findById: jest.fn().mockResolvedValue(target),
    findByUsername: jest.fn().mockResolvedValue(null),
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn((data: Partial<User>) => Promise.resolve(makeUser({ ...data, id: OTHER_ID }))),
    update: jest.fn((_id: string, data: Partial<User>) =>
      Promise.resolve({ ...target, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) }),
    ),
    lockForUpdate: jest.fn().mockResolvedValue(undefined),
    countActiveAdmins: jest.fn().mockResolvedValue(otherActiveAdmins),
  } as unknown as jest.Mocked<UsersRepository>;
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<SessionsRepository>;
  const passwords = { hash: jest.fn().mockResolvedValue('argon-hash') } as unknown as jest.Mocked<PasswordService>;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;
  const service = new UsersService(prisma, users, sessions, passwords, audit);
  return { service, users, sessions, passwords, audit, tx };
}

async function expectRule(promise: Promise<unknown>, rule: string) {
  await expect(promise).rejects.toBeInstanceOf(DomainException);
  await promise.catch((e: DomainException) => {
    expect((e.getResponse() as { details: { rule: string } }).details.rule).toBe(rule);
  });
}

describe('UsersService', () => {
  it('crée un utilisateur avec mot de passe haché, changement obligatoire et trace d’audit', async () => {
    const ctx = setup(null);
    await ctx.service.create(
      { username: 'tech1', fullName: 'Tech Un', email: null, roles: ['TECHNICIEN'], temporaryPassword: 'Temp@12345!' },
      actor,
    );
    expect(ctx.users.create).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'argon-hash', mustChangePassword: true, createdById: ADMIN_ID }),
      ctx.tx,
    );
    const auditCall = ctx.audit.record.mock.calls[0][1];
    expect(auditCall.action).toBe('CREATE');
    expect(JSON.stringify(auditCall.after)).not.toContain('argon-hash');
  });

  it('refuse un identifiant déjà utilisé', async () => {
    const ctx = setup(null);
    ctx.users.findByUsername.mockResolvedValue(makeUser());
    await expect(
      ctx.service.create(
        { username: 'bio1', fullName: 'X Y', email: null, roles: ['BIOLOGISTE'], temporaryPassword: 'Temp@12345!' },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('interdit de désactiver son propre compte', async () => {
    const ctx = setup(makeUser({ id: ADMIN_ID, roles: ['ADMIN'] }));
    await expectRule(ctx.service.deactivate(ADMIN_ID, { reason: 'Départ du labo' }, actor), 'SELF_DEACTIVATION');
  });

  it('interdit de désactiver le dernier administrateur actif', async () => {
    const ctx = setup(makeUser({ roles: ['ADMIN'] }), 0);
    await expectRule(ctx.service.deactivate(OTHER_ID, { reason: 'Départ du labo' }, actor), 'LAST_ADMIN');
  });

  it('désactive un compte : révoque les sessions, incrémente la version de jeton, journalise le motif', async () => {
    const ctx = setup(makeUser());
    await ctx.service.deactivate(OTHER_ID, { reason: 'Fin de contrat' }, actor);
    expect(ctx.users.update).toHaveBeenCalledWith(
      OTHER_ID,
      expect.objectContaining({ isActive: false, deactivationReason: 'Fin de contrat', tokenVersion: { increment: 1 } }),
      ctx.tx,
    );
    expect(ctx.sessions.revokeAllForUser).toHaveBeenCalledWith(OTHER_ID, 'DEACTIVATED', ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      ctx.tx,
      expect.objectContaining({ action: 'DELETE', reason: 'Fin de contrat' }),
    );
  });

  it('interdit de retirer son propre rôle Administrateur', async () => {
    const ctx = setup(makeUser({ id: ADMIN_ID, roles: ['ADMIN', 'BIOLOGISTE'] }));
    await expectRule(ctx.service.update(ADMIN_ID, { roles: ['BIOLOGISTE'] }, actor), 'SELF_ADMIN_REMOVAL');
  });

  it('n’écrit pas d’audit si aucune valeur ne change', async () => {
    const ctx = setup(makeUser());
    await ctx.service.update(OTHER_ID, { fullName: 'Biologiste Un' }, actor);
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });
});
