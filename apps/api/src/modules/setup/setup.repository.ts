import { Injectable } from '@nestjs/common';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

@Injectable()
export class SetupRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Comptes de personnes (les comptes de service des automates ne comptent pas). */
  countHumanUsers(db: Db = this.prisma): Promise<number> {
    return db.user.count({ where: { isServiceAccount: false } });
  }

  /** Migrations appliquées (journal compatible Prisma), ou null si le journal n'existe pas. */
  async migrations(): Promise<{ count: number; last: string | null } | null> {
    const exists = await this.prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`;
    if (!exists[0]?.ok) return null;
    const rows = await this.prisma.$queryRaw<{ count: bigint; last: string | null }[]>`
      SELECT count(*)::bigint AS count, max(migration_name) AS last
      FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    return { count: Number(rows[0]?.count ?? 0), last: rows[0]?.last ?? null };
  }
}
