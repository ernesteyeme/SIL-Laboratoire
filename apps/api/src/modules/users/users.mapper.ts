import type { AuthUser, UserDto } from '@lims/shared';
import type { User } from '../../generated/prisma/client';
import type { UserWithSections } from './users.repository';

export function toUserDto(user: UserWithSections, now: Date = new Date()): UserDto {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roles: user.roles,
    sections: [...user.sections]
      .sort((a, b) => a.section.displayOrder - b.section.displayOrder || a.section.code.localeCompare(b.section.code))
      .map((s) => ({ id: s.section.id, code: s.section.code, name: s.section.name, grantedAt: s.grantedAt.toISOString() })),
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    isLocked: user.lockedUntil !== null && user.lockedUntil > now,
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    deactivatedAt: user.deactivatedAt?.toISOString() ?? null,
    deactivationReason: user.deactivationReason,
  };
}

export function toAuthUser(user: User, sectionIds: string[]): AuthUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roles: user.roles,
    sectionIds,
    mustChangePassword: user.mustChangePassword,
  };
}

/** Vue d'audit d'un utilisateur : sans secrets ni compteurs techniques. */
export function toUserAuditView(user: User, sectionCodes: string[] = []) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roles: user.roles,
    sections: [...sectionCodes].sort(),
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lockedUntil: user.lockedUntil,
    deactivatedAt: user.deactivatedAt,
    deactivatedById: user.deactivatedById,
    deactivationReason: user.deactivationReason,
  };
}
