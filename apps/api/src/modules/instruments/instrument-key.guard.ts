import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { ERROR_CODES } from '@lims/shared';
import type { Instrument } from '../../generated/prisma/client';
import type { AppClsStore, RequestUser } from '../../core/context/request-context';
import { DomainException } from '../../core/errors/domain.exception';
import { InstrumentsRepository } from './instruments.repository';
import { hashApiKey } from './instruments.service';

type InstrumentRequest = Request & { user?: RequestUser; instrument?: Instrument };

/**
 * Authentification d'un connecteur d'automate par clé d'API (en-tête « X-Instrument-Key »
 * ou « Authorization: Instrument <clé> »). L'utilisateur de la requête devient le compte de service
 * de l'automate : toutes ses actions sont tracées sous son nom.
 */
@Injectable()
export class InstrumentKeyGuard implements CanActivate {
  constructor(
    private readonly repo: InstrumentsRepository,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<InstrumentRequest>();
    const header = req.headers['x-instrument-key'];
    const auth = req.headers.authorization;
    const key = (typeof header === 'string' ? header : auth?.startsWith('Instrument ') ? auth.slice(11) : '').trim();
    const invalid = () => new DomainException(HttpStatus.UNAUTHORIZED, ERROR_CODES.AUTH_TOKEN_INVALID, 'Clé d’automate absente, invalide ou révoquée.');
    if (!key || key.length > 200) throw invalid();

    const found = await this.repo.findByKeyHash(hashApiKey(key));
    if (!found || !found.isActive || !found.serviceUser.isActive) throw invalid();

    const { serviceUser, ...instrument } = found;
    const user: RequestUser = { id: serviceUser.id, username: serviceUser.username, fullName: serviceUser.fullName, roles: [], mustChangePassword: false };
    req.user = user;
    req.instrument = instrument;
    this.cls.set('user', user);
    return true;
  }
}

/** Automate authentifié par InstrumentKeyGuard. */
export const CurrentInstrument = createParamDecorator((_data: unknown, ctx: ExecutionContext): Instrument => {
  const instrument = ctx.switchToHttp().getRequest<InstrumentRequest>().instrument;
  if (!instrument) throw new Error('CurrentInstrument utilisé sans InstrumentKeyGuard.');
  return instrument;
});
