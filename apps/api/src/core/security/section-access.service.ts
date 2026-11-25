import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, isSectionScoped, type Role } from '@lims/shared';
import type { RequestUser } from '../context/request-context';
import { DomainException } from '../errors/domain.exception';
import { PrismaService, type Db } from '../prisma/prisma.service';

/** Action refusée hors des services où la personne est habilitée (HTTP 403, règle SECTION_NOT_AUTHORIZED). */
export class SectionNotAuthorizedError extends DomainException {
  constructor(sectionName: string, action: string) {
    super(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.ACCESS_DENIED,
      `Vous n’êtes pas habilité(e) au service « ${sectionName} » : ${action} impossible. L’administrateur attribue les services dans la fiche utilisateur.`,
      { rule: 'SECTION_NOT_AUTHORIZED' },
    );
  }
}

/**
 * Habilitations par service (ISO 15189 §6.2) : un technicien ou un biologiste n'agit sur les résultats
 * (saisie, validations, CIQ, résultats d'automates) que dans les sections qui lui sont attribuées.
 * Les autres rôles (administration, qualité, accueil…) et les comptes de service des automates ne sont pas
 * limités à un service : leurs droits sont déjà bornés par leur rôle.
 *
 * Les habilitations sont relues en base à chaque contrôle : un retrait prend effet immédiatement,
 * sans attendre l'expiration du jeton d'accès.
 */
@Injectable()
export class SectionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Services autorisés ; null = pas de limitation par service. */
  async allowedSections(actor: Pick<RequestUser, 'id' | 'roles'>, db: Db = this.prisma): Promise<Set<string> | null> {
    if (!isSectionScoped(actor.roles as Role[])) return null;
    const rows = await db.userSection.findMany({ where: { userId: actor.id }, select: { sectionId: true } });
    return new Set(rows.map((r) => r.sectionId));
  }

  /** Refuse l'action si l'examen (ou l'automate, le contrôle) relève d'un service non attribué. */
  async assertCanAct(db: Db, actor: Pick<RequestUser, 'id' | 'roles'>, section: { id: string; name: string }, action: string): Promise<void> {
    const allowed = await this.allowedSections(actor, db);
    if (allowed && !allowed.has(section.id)) throw new SectionNotAuthorizedError(section.name, action);
  }

  /** Filtre de requête : sections visibles, restreintes au service demandé s'il y en a un. */
  async scopeFilter(actor: Pick<RequestUser, 'id' | 'roles'>, requested?: string): Promise<{ sectionIds: string[] | null; requestedAllowed: boolean }> {
    const allowed = await this.allowedSections(actor);
    if (!allowed) return { sectionIds: requested ? [requested] : null, requestedAllowed: true };
    if (requested) return { sectionIds: allowed.has(requested) ? [requested] : [], requestedAllowed: allowed.has(requested) };
    return { sectionIds: [...allowed], requestedAllowed: true };
  }
}
