import { Injectable } from '@nestjs/common';
import type { ListUsersQuery } from '@lims/shared';
import type { Prisma, User } from '../../generated/prisma/client';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, db: Db = this.prisma): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  }

  findByUsername(username: string, db: Db = this.prisma): Promise<User | null> {
    return db.user.findUnique({ where: { username } });
  }

  findByEmail(email: string, db: Db = this.prisma): Promise<User | null> {
    return db.user.findUnique({ where: { email } });
  }

  async findMany(query: ListUsersQuery): Promise<[User[], number]> {
    const where: Prisma.UserWhereInput = {
      isServiceAccount: false,
      isActive: query.status === 'all' ? undefined : query.status === 'active',
      roles: query.role ? { has: query.role } : undefined,
      OR: query.search
        ? [
            { username: { contains: query.search, mode: 'insensitive' } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
  }

  create(data: Prisma.UserUncheckedCreateInput, db: Db = this.prisma): Promise<User> {
    return db.user.create({ data });
  }

  update(id: string, data: Prisma.UserUncheckedUpdateInput, db: Db = this.prisma): Promise<User> {
    return db.user.update({ where: { id }, data });
  }

  /** Verrouille la ligne utilisateur jusqu'à la fin de la transaction (évite les mises à jour concurrentes). */
  async lockForUpdate(id: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }

  /** Nombre d'administrateurs actifs, hors un utilisateur donné. */
  countActiveAdmins(excludeUserId: string, db: Db = this.prisma): Promise<number> {
    return db.user.count({
      where: { isActive: true, roles: { has: 'ADMIN' }, id: { not: excludeUserId } },
    });
  }
}
