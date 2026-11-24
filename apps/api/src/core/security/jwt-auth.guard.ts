import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { ERROR_CODES } from '@lims/shared';
import type { AppClsStore, RequestUser } from '../context/request-context';
import { DomainException } from '../errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenService } from './access-token.service';
import { ALLOW_PENDING_PASSWORD_KEY, IS_PUBLIC_KEY } from './decorators';

/**
 * Guard global n°1 : vérifie le jeton d'accès, recharge l'état du compte
 * (actif, version de jeton, rôles à jour) et place l'utilisateur dans le contexte.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
      throw new DomainException(HttpStatus.UNAUTHORIZED, ERROR_CODES.AUTH_REQUIRED, 'Authentification requise.');
    }

    let payload;
    try {
      payload = await this.tokens.verify(token);
    } catch {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.AUTH_TOKEN_INVALID,
        'Session expirée ou jeton invalide.',
      );
    }

    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        fullName: true,
        roles: true,
        isActive: true,
        mustChangePassword: true,
        tokenVersion: true,
      },
    });

    if (!account || !account.isActive || account.tokenVersion !== payload.ver) {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.AUTH_SESSION_REVOKED,
        'Votre session a été révoquée. Veuillez vous reconnecter.',
      );
    }

    const user: RequestUser = {
      id: account.id,
      username: account.username,
      fullName: account.fullName,
      roles: account.roles,
      mustChangePassword: account.mustChangePassword,
    };
    req.user = user;
    this.cls.set('user', user);

    if (account.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, targets)) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
        'Vous devez changer votre mot de passe avant de continuer.',
      );
    }

    return true;
  }
}
