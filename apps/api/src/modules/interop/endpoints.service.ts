import { Injectable } from '@nestjs/common';
import type { InteropEndpointDto, InteropEndpointInput, InteropOverviewDto } from '@lims/shared';
import { Prisma, type InteropEndpoint } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfig } from '../../core/config/app-config';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { Dhis2Gateway, VlsmGateway, type ConnectionCheck } from './gateways';
import { InteropTransportError, type ConnectionProfile } from './interop-http';
import { endpointAuditView, toEndpointDto } from './interop.mapper';
import { InteropRepository } from './interop.repository';
import { InteropRunsService } from './runs.service';
import { SecretBox } from './secret-box';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

@Injectable()
export class InteropEndpointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InteropRepository,
    private readonly secrets: SecretBox,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly runs: InteropRunsService,
    private readonly dhis2: Dhis2Gateway,
    private readonly vlsm: VlsmGateway,
  ) {}

  overview(): InteropOverviewDto {
    return { encryptionReady: this.secrets.ready };
  }

  async list(): Promise<InteropEndpointDto[]> {
    return (await this.repo.listEndpoints()).map(toEndpointDto);
  }

  async get(id: string): Promise<InteropEndpointDto> {
    const row = await this.repo.findEndpoint(id);
    if (!row) throw new NotFoundError('Connexion', id);
    return toEndpointDto(row);
  }

  /** Connexion existante, avec contrôle optionnel du système attendu et de l'activation. */
  async require(id: string, expected?: { system?: InteropEndpoint['system']; active?: boolean }, db: Db = this.prisma): Promise<InteropEndpoint> {
    const row = await db.interopEndpoint.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Connexion', id);
    if (expected?.system && row.system !== expected.system) {
      throw new BusinessRuleError('INTEROP_WRONG_SYSTEM', `Cette connexion est de type ${row.system}, pas ${expected.system}.`);
    }
    if (expected?.active && !row.isActive) throw new BusinessRuleError('INTEROP_ENDPOINT_INACTIVE', `La connexion ${row.code} est désactivée.`);
    return row;
  }

  /** Profil de connexion avec le secret déchiffré (en mémoire, le temps d'un échange). */
  profile(row: InteropEndpoint): ConnectionProfile {
    return {
      system: row.system,
      transport: row.transport,
      baseUrl: row.baseUrl,
      authMode: row.authMode,
      username: row.username,
      secret: row.secretCipher ? this.secrets.open(row.secretCipher, row.code) : null,
      timeoutSeconds: row.timeoutSeconds,
    };
  }

  async create(input: InteropEndpointInput): Promise<InteropEndpointDto> {
    this.assertUrl(input.baseUrl);
    if (!input.secret) {
      throw new BusinessRuleError('INTEROP_SECRET_REQUIRED', input.authMode === 'TOKEN' ? 'Jeton d’API obligatoire.' : 'Mot de passe obligatoire.');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertSettings(tx, input);
      try {
        const created = await tx.interopEndpoint.create({
          data: {
            code: input.code,
            name: input.name,
            system: input.system,
            transport: input.transport,
            baseUrl: input.baseUrl,
            authMode: input.authMode,
            username: input.username ?? null,
            secretCipher: this.secrets.seal(input.secret!, input.code),
            timeoutSeconds: input.timeoutSeconds,
            isActive: input.isActive ?? true,
            settings: input.settings as Prisma.InputJsonValue,
          },
        });
        await this.audit.record(tx, { action: 'CREATE', entity: 'InteropEndpoint', entityId: created.id, after: endpointAuditView(created) });
        return created.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('Une connexion porte déjà ce code.');
        throw e;
      }
    });
    return this.get(id);
  }

  async update(id: string, input: InteropEndpointInput): Promise<InteropEndpointDto> {
    this.assertUrl(input.baseUrl);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.interopEndpoint.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Connexion', id);
      if (input.code !== before.code) {
        throw new BusinessRuleError('INTEROP_CODE_IMMUTABLE', 'Le code d’une connexion ne se modifie pas (il protège le chiffrement de son secret).');
      }
      if (input.system !== before.system) {
        throw new BusinessRuleError('INTEROP_SYSTEM_IMMUTABLE', 'Le système d’une connexion ne se modifie pas : créez une nouvelle connexion.');
      }
      await this.assertSettings(tx, input);
      const secretCipher = input.secret ? this.secrets.seal(input.secret, before.code) : input.clearSecret ? null : before.secretCipher;
      const after = await tx.interopEndpoint.update({
        where: { id },
        data: {
          name: input.name,
          transport: input.transport,
          baseUrl: input.baseUrl,
          authMode: input.authMode,
          username: input.username ?? null,
          secretCipher,
          timeoutSeconds: input.timeoutSeconds,
          isActive: input.isActive ?? before.isActive,
          settings: input.settings as Prisma.InputJsonValue,
          // Une connexion modifiée doit être testée à nouveau.
          lastTestAt: null,
          lastTestOk: null,
          lastTestMessage: null,
        },
      });
      const reason = input.secret ? 'Secret remplacé' : input.clearSecret ? 'Secret effacé' : null;
      await this.audit.record(tx, { action: 'UPDATE', entity: 'InteropEndpoint', entityId: id, before: endpointAuditView(before), after: endpointAuditView(after), reason });
    });
    return this.get(id);
  }

  /** Test de connexion (version du serveur, authentification), inscrit au journal des échanges. */
  async test(id: string, actorId: string): Promise<InteropEndpointDto> {
    const row = await this.require(id);
    let check: ConnectionCheck;
    try {
      const profile = this.profile(row);
      check = row.system === 'DHIS2' ? await this.dhis2.check(profile) : await this.vlsm.check(profile);
    } catch (e) {
      if (e instanceof InteropTransportError) check = { ok: false, message: e.message, httpStatus: null, openhimTransactionId: null, durationMs: e.durationMs };
      else if (e instanceof BusinessRuleError) check = { ok: false, message: (e.getResponse() as { message: string }).message, httpStatus: null, openhimTransactionId: null, durationMs: 0 };
      else throw e;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.interopEndpoint.update({ where: { id }, data: { lastTestAt: new Date(), lastTestOk: check.ok, lastTestMessage: check.message.slice(0, 500) } });
      await this.runs.record(tx, {
        endpointId: id,
        kind: 'CONNECTION_TEST',
        status: check.ok ? 'SUCCESS' : 'ERROR',
        httpStatus: check.httpStatus,
        openhimTransactionId: check.openhimTransactionId,
        message: check.message,
        durationMs: check.durationMs,
        triggeredById: actorId,
      });
    });
    return this.get(id);
  }

  private assertUrl(baseUrl: string): void {
    const url = new URL(baseUrl);
    if (url.username || url.password) {
      throw new BusinessRuleError('INTEROP_URL_CREDENTIALS', 'N’incluez pas d’identifiants dans l’adresse : utilisez les champs dédiés (ils sont chiffrés).');
    }
    if (this.config.isProduction && url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
      throw new BusinessRuleError('INTEROP_HTTPS_REQUIRED', 'En production, les échanges de données de santé exigent une adresse https://.');
    }
  }

  private async assertSettings(tx: Db, input: InteropEndpointInput): Promise<void> {
    if (input.system !== 'VLSM' || input.settings.specimenTypes.length === 0) return;
    const ids = input.settings.specimenTypes.map((s) => s.sampleTypeId);
    const found = await tx.sampleType.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BusinessRuleError('INTEROP_SAMPLE_TYPE_UNKNOWN', 'Un type d’échantillon des correspondances VLSM est introuvable.');
  }
}
