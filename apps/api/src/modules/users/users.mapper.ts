import type { AuthUser, UserDto } from '@lims/shared';
import type { User } from '../../generated/prisma/client';

export function toUserDto(user: User, now: Date = new Date()): UserDto {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roles: user.roles,
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

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roles: user.roles,
    mustChangePassword: user.mustChangePassword,
  };
}

/** Vue d'audit d'un utilisateur : sans secrets ni compteurs techniques. */
export function toUserAuditView(user: User) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roles: user.roles,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lockedUntil: user.lockedUntil,
    deactivatedAt: user.deactivatedAt,
    deactivatedById: user.deactivatedById,
    deactivationReason: user.deactivationReason,
  };
}
