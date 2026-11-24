import { Injectable } from '@nestjs/common';
import type { LabSettings } from '../../generated/prisma/client';
import { NotFoundError } from '../errors/domain.exception';
import { PrismaService, type Db } from '../prisma/prisma.service';

/**
 * Accès transverse au paramétrage du laboratoire et aux noms des utilisateurs,
 * pour les modules métier qui en ont besoin (fuseau horaire des compteurs, règles de caisse, affichage).
 */
@Injectable()
export class LabContextService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(db: Db = this.prisma): Promise<LabSettings> {
    const s = await db.labSettings.findUnique({ where: { id: 1 } });
    if (!s) throw new NotFoundError('Paramètres du laboratoire (lancez le seed)');
    return s;
  }

  /** Noms complets des utilisateurs (traçabilité : qui a prélevé, reçu, encaissé…). */
  async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }
}
