import { Injectable } from '@nestjs/common';
import type { Prisma, RefreshToken, User } from '../../generated/prisma/client';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export type RevokeReason = 'ROTATED' | 'LOGOUT' | 'PASSWORD_CHANGE' | 'PASSWORD_RESET' | 'DEACTIVATED' | 'REUSE_DETECTED';

@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.RefreshTokenUncheckedCreateInput, db: Db = this.prisma): Promise<RefreshToken> {
    return db.refreshToken.create({ data });
  }

  findByIdWithUser(id: string, db: Db = this.prisma): Promise<(RefreshToken & { user: User }) | null> {
    return db.refreshToken.findUnique({ where: { id }, include: { user: true } });
  }

  /** Révocation atomique : renvoie false si le jeton était déjà révoqué (rotation concurrente). */
  async revokeIfActive(id: string, reason: RevokeReason, replacedById: string | null, db: Db): Promise<boolean> {
    const result = await db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, replacedById },
    });
    return result.count === 1;
  }

  async revokeFamily(familyId: string, reason: RevokeReason, db: Db = this.prisma): Promise<number> {
    const result = await db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  async revokeAllForUser(userId: string, reason: RevokeReason, db: Db = this.prisma): Promise<number> {
    const result = await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }
}
