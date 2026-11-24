import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ERROR_CODES, type Role } from '@lims/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../context/request-context';
import { DomainException } from '../errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ANY_ROLE_KEY, IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/**
 * Guard global n°2 : contrôle des rôles, refus par défaut.
 * Une route sans @Public, @AnyRole ou @Roles(...) est interdite.
 * Chaque refus est consigné dans la piste d'audit.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ANY_ROLE_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const user = req.user;

    if (!required || required.length === 0) {
      this.logger.warn(`Route sans déclaration de rôles refusée : ${req.method} ${req.route?.path ?? req.path}`);
      await this.recordDenial(req, user, 'Route sans déclaration de rôles');
      throw new DomainException(HttpStatus.FORBIDDEN, ERROR_CODES.ACCESS_DENIED, 'Accès refusé.');
    }

    if (user && user.roles.some((r) => required.includes(r))) {
      return true;
    }

    await this.recordDenial(req, user, `Rôle requis : ${required.join(', ')}`);
    throw new DomainException(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.ACCESS_DENIED,
      'Vous ne disposez pas des droits nécessaires pour cette action.',
      { requiredRoles: required },
    );
  }

  private async recordDenial(req: Request, user: RequestUser | undefined, reason: string): Promise<void> {
    try {
      await this.audit.record(this.prisma, {
        action: 'ACCESS_DENIED',
        entity: 'Route',
        entityId: `${req.method} ${req.route?.path ?? req.path}`,
        after: { method: req.method, path: req.originalUrl },
        reason,
      });
    } catch (error) {
      this.logger.error('Impossible de journaliser un refus d’accès.', error instanceof Error ? error.stack : error);
    }
  }
}
