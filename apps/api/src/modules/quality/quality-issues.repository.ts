import { Injectable } from '@nestjs/common';
import type { QualityIssuesQuery } from '@lims/shared';
import type { Prisma } from '../../generated/prisma/client';
import { skipTake } from '../../core/common/pagination';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

export const issueInclude = {
  order: { select: { id: true, number: true } },
  sample: { select: { id: true, number: true } },
} satisfies Prisma.QualityIssueInclude;

export type IssueRow = Prisma.QualityIssueGetPayload<{ include: typeof issueInclude }>;

@Injectable()
export class QualityIssuesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param ownerId   restreint aux fiches déclarées par cet utilisateur (rôles sans accès global)
   * @param todayDate date du jour (colonne DATE) pour le filtre « action en retard »
   */
  list(query: QualityIssuesQuery, ownerId: string | null, todayDate: Date): Promise<[IssueRow[], number]> {
    const q = query.q?.trim();
    const where: Prisma.QualityIssueWhereInput = {
      status: query.status,
      category: query.category,
      severity: query.severity,
      ...(ownerId ? { declaredById: ownerId } : {}),
      ...(query.overdue ? { status: 'IN_PROGRESS', actionDueDate: { lt: todayDate } } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: 'insensitive' } },
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { order: { number: { contains: q, mode: 'insensitive' } } },
              { sample: { number: { contains: q } } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction([
      this.prisma.qualityIssue.findMany({ where, include: issueInclude, orderBy: [{ declaredAt: 'desc' }], ...skipTake(query) }),
      this.prisma.qualityIssue.count({ where }),
    ]);
  }

  find(id: string, db: Db = this.prisma): Promise<IssueRow | null> {
    return db.qualityIssue.findUnique({ where: { id }, include: issueInclude });
  }

  async lock(id: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT id FROM "quality_issues" WHERE id = ${id}::uuid FOR UPDATE`;
  }
}
