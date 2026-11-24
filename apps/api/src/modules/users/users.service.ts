import { Injectable } from '@nestjs/common';
import type {
  CreateUserInput,
  ListUsersQuery,
  Paginated,
  ResetPasswordInput,
  UpdateUserInput,
  UserDto,
  UserStatusChangeInput,
} from '@lims/shared';
import type { User } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { changedFields } from '../../core/audit/audit-serializer';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { PasswordService } from '../../core/security/password.service';
import { SessionsRepository } from '../auth/sessions.repository';
import { toUserAuditView, toUserDto } from './users.mapper';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery): Promise<Paginated<UserDto>> {
    const [rows, total] = await this.users.findMany(query);
    const now = new Date();
    return {
      items: rows.map((u) => toUserDto(u, now)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(id: string): Promise<UserDto> {
    return toUserDto(await this.getOrThrow(id));
  }

  async create(input: CreateUserInput, actor: RequestUser): Promise<UserDto> {
    await this.assertUsernameAvailable(input.username);
    if (input.email) await this.assertEmailAvailable(input.email);

    const passwordHash = await this.passwords.hash(input.temporaryPassword);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await this.users.create(
        {
          username: input.username,
          fullName: input.fullName,
          email: input.email ?? null,
          roles: input.roles,
          passwordHash,
          mustChangePassword: true,
          createdById: actor.id,
        },
        tx,
      );
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'User',
        entityId: user.id,
        after: toUserAuditView(user),
      });
      return user;
    });

    return toUserDto(created);
  }

  async update(id: string, input: UpdateUserInput, actor: RequestUser): Promise<UserDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.users.lockForUpdate(id, tx);
      const current = await this.getOrThrow(id, tx);

      if (input.email && input.email !== current.email) {
        await this.assertEmailAvailable(input.email, id, tx);
      }

      if (input.roles) {
        const losesAdmin = current.roles.includes('ADMIN') && !input.roles.includes('ADMIN');
        if (losesAdmin && current.id === actor.id) {
          throw new BusinessRuleError(
            'SELF_ADMIN_REMOVAL',
            'Vous ne pouvez pas retirer votre propre rôle Administrateur.',
          );
        }
        if (losesAdmin && current.isActive) {
          await this.assertAnotherActiveAdmin(id, tx);
        }
      }

      const next = await this.users.update(
        id,
        {
          fullName: input.fullName,
          email: input.email,
          roles: input.roles,
        },
        tx,
      );

      const before = toUserAuditView(current);
      const after = toUserAuditView(next);
      const fields = changedFields(before, after);
      if (fields.length > 0) {
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'User',
          entityId: id,
          before,
          after,
          reason: `Champs modifiés : ${fields.join(', ')}`,
        });
      }
      return next;
    });

    return toUserDto(updated);
  }

  async resetPassword(id: string, input: ResetPasswordInput, actor: RequestUser): Promise<UserDto> {
    if (id === actor.id) {
      throw new BusinessRuleError(
        'SELF_PASSWORD_RESET',
        'Utilisez « Changer mon mot de passe » pour modifier votre propre mot de passe.',
      );
    }
    const passwordHash = await this.passwords.hash(input.temporaryPassword);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.users.lockForUpdate(id, tx);
      const current = await this.getOrThrow(id, tx);
      if (!current.isActive) {
        throw new BusinessRuleError('USER_INACTIVE', 'Impossible de réinitialiser le mot de passe d’un compte désactivé.');
      }
      const next = await this.users.update(
        id,
        {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
        tx,
      );
      await this.sessions.revokeAllForUser(id, 'PASSWORD_RESET', tx);
      await this.audit.record(tx, {
        action: 'PASSWORD_RESET',
        entity: 'User',
        entityId: id,
        before: toUserAuditView(current),
        after: toUserAuditView(next),
        reason: input.reason,
      });
      return next;
    });

    return toUserDto(updated);
  }

  async deactivate(id: string, input: UserStatusChangeInput, actor: RequestUser): Promise<UserDto> {
    if (id === actor.id) {
      throw new BusinessRuleError('SELF_DEACTIVATION', 'Vous ne pouvez pas désactiver votre propre compte.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.users.lockForUpdate(id, tx);
      const current = await this.getOrThrow(id, tx);
      if (!current.isActive) {
        throw new BusinessRuleError('ALREADY_INACTIVE', 'Ce compte est déjà désactivé.');
      }
      if (current.roles.includes('ADMIN')) {
        await this.assertAnotherActiveAdmin(id, tx);
      }
      const next = await this.users.update(
        id,
        {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedById: actor.id,
          deactivationReason: input.reason,
          tokenVersion: { increment: 1 },
        },
        tx,
      );
      await this.sessions.revokeAllForUser(id, 'DEACTIVATED', tx);
      await this.audit.record(tx, {
        action: 'DELETE',
        entity: 'User',
        entityId: id,
        before: toUserAuditView(current),
        after: toUserAuditView(next),
        reason: input.reason,
      });
      return next;
    });

    return toUserDto(updated);
  }

  async reactivate(id: string, input: UserStatusChangeInput): Promise<UserDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.users.lockForUpdate(id, tx);
      const current = await this.getOrThrow(id, tx);
      if (current.isActive) {
        throw new BusinessRuleError('ALREADY_ACTIVE', 'Ce compte est déjà actif.');
      }
      const next = await this.users.update(
        id,
        {
          isActive: true,
          deactivatedAt: null,
          deactivatedById: null,
          deactivationReason: null,
          failedLoginCount: 0,
          lockedUntil: null,
          mustChangePassword: true,
        },
        tx,
      );
      await this.audit.record(tx, {
        action: 'RESTORE',
        entity: 'User',
        entityId: id,
        before: toUserAuditView(current),
        after: toUserAuditView(next),
        reason: input.reason,
      });
      return next;
    });

    return toUserDto(updated);
  }

  async unlock(id: string, input: UserStatusChangeInput): Promise<UserDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.users.lockForUpdate(id, tx);
      const current = await this.getOrThrow(id, tx);
      if (!current.lockedUntil || current.lockedUntil <= new Date()) {
        throw new BusinessRuleError('NOT_LOCKED', 'Ce compte n’est pas verrouillé.');
      }
      const next = await this.users.update(id, { lockedUntil: null, failedLoginCount: 0 }, tx);
      await this.audit.record(tx, {
        action: 'ACCOUNT_UNLOCKED',
        entity: 'User',
        entityId: id,
        before: toUserAuditView(current),
        after: toUserAuditView(next),
        reason: input.reason,
      });
      return next;
    });

    return toUserDto(updated);
  }

  private async getOrThrow(id: string, db: Db = this.prisma): Promise<User> {
    const user = await this.users.findById(id, db);
    // Les comptes de service des automates se gèrent depuis l'écran des automates.
    if (!user || user.isServiceAccount) throw new NotFoundError('Utilisateur', id);
    return user;
  }

  private async assertUsernameAvailable(username: string): Promise<void> {
    if (await this.users.findByUsername(username)) {
      throw new ConflictError(`L’identifiant « ${username} » est déjà utilisé.`, [
        { path: 'username', message: 'Identifiant déjà utilisé.' },
      ]);
    }
  }

  private async assertEmailAvailable(email: string, exceptUserId?: string, db: Db = this.prisma): Promise<void> {
    const existing = await this.users.findByEmail(email, db);
    if (existing && existing.id !== exceptUserId) {
      throw new ConflictError(`L’adresse « ${email} » est déjà utilisée.`, [
        { path: 'email', message: 'Adresse e-mail déjà utilisée.' },
      ]);
    }
  }

  private async assertAnotherActiveAdmin(excludeUserId: string, db: Db): Promise<void> {
    const others = await this.users.countActiveAdmins(excludeUserId, db);
    if (others === 0) {
      throw new BusinessRuleError(
        'LAST_ADMIN',
        'Opération impossible : le système doit conserver au moins un administrateur actif.',
      );
    }
  }
}
