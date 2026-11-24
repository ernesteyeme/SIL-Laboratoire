import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { SetupCheckStatus, SetupCompleteInput, SetupResultDto, SetupStatusDto } from '@lims/shared';
import type { Prisma } from '../../generated/prisma/client';
import { toAuditJson } from '../../core/audit/audit-serializer';
import { APP_INFO } from '../../core/common/app-info';
import { AppConfig } from '../../core/config/app-config';
import { BusinessRuleError, ConflictError } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PasswordService } from '../../core/security/password.service';
import { SetupRepository } from './setup.repository';
import { applyStarterCatalog } from './starter-catalog';

const SETUP_REASON = 'Installation initiale (assistant du premier démarrage)';
/** Verrou consultatif PostgreSQL : deux assistants ouverts en même temps ne créent pas deux administrateurs. */
const SETUP_LOCK_KEY = 715_150_001;

const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: SetupRepository,
    private readonly config: AppConfig,
    private readonly passwords: PasswordService,
  ) {}

  async status(): Promise<SetupStatusDto> {
    const [users, migrations] = await Promise.all([this.repo.countHumanUsers(), this.repo.migrations()]);
    const needsSetup = users === 0;
    const checks: SetupStatusDto['checks'] = [];
    const add = (label: string, status: SetupCheckStatus, detail: string) => checks.push({ label, status, detail });
    add('Base de données', 'PASS', 'PostgreSQL répond.');
    if (migrations === null) add('Migrations', 'WARN', 'Journal des migrations absent : base créée hors installateur (lims migrate).');
    else add('Migrations', 'PASS', `${migrations.count} migration(s) appliquée(s), dernière : ${migrations.last ?? '—'}.`);
    add('Clé de chiffrement', this.config.interopSecretKey ? 'PASS' : 'WARN', this.config.interopSecretKey ? 'INTEROP_SECRET_KEY configurée.' : 'INTEROP_SECRET_KEY absente : les connexions DHIS2/VLSM ne pourront pas enregistrer de secret.');
    if (needsSetup) {
      add('Code d’installation', this.config.setupToken ? 'PASS' : 'FAIL', this.config.setupToken ? 'Le serveur attend le code affiché par l’installateur.' : 'SETUP_TOKEN absent du fichier .env : exécutez « sudo lims setup-token ».');
    }
    add('Mode', this.config.isProduction ? 'PASS' : 'WARN', this.config.isProduction ? 'Production.' : `Environnement ${this.config.nodeEnv}.`);
    return { needsSetup, version: APP_INFO.version, commit: APP_INFO.commit, tokenConfigured: this.config.setupToken !== null, checks };
  }

  /** Contrôle du code d'installation (étape 1 de l'assistant). */
  async verifyToken(token: string): Promise<void> {
    await this.assertOpen();
    this.assertToken(token);
  }

  async complete(input: SetupCompleteInput): Promise<SetupResultDto> {
    this.assertToken(input.token);
    const passwordHash = await this.passwords.hash(input.admin.password);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;
        if ((await this.repo.countHumanUsers(tx)) > 0) {
          throw new ConflictError('L’installation est déjà terminée : connectez-vous avec un compte existant.');
        }
        const lab = input.lab;
        const before = await tx.labSettings.findUnique({ where: { id: 1 } });
        const labData = {
          name: lab.name,
          shortName: lab.shortName ?? null,
          city: lab.city ?? null,
          country: lab.country ?? null,
          phone: lab.phone ?? null,
          email: lab.email,
          timezone: lab.timezone,
          currency: lab.currency,
          secondaryCurrencyEnabled: lab.secondaryCurrencyEnabled,
        };
        const settings = await tx.labSettings.upsert({ where: { id: 1 }, create: { id: 1, ...labData }, update: labData });
        await tx.auditLog.create({
          data: { actorUsername: 'system', action: before ? 'UPDATE' : 'CREATE', entity: 'LabSettings', entityId: '1', before: before ? (toAuditJson(before) as Prisma.InputJsonValue) : undefined, after: toAuditJson(settings) as Prisma.InputJsonValue, reason: SETUP_REASON },
        });
        const admin = await tx.user.create({
          data: {
            username: input.admin.username,
            fullName: input.admin.fullName,
            email: input.admin.email,
            roles: ['ADMIN'],
            passwordHash,
            // Mot de passe choisi par l'administrateur lui-même : pas de changement imposé.
            mustChangePassword: false,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUsername: 'system',
            action: 'CREATE',
            entity: 'User',
            entityId: admin.id,
            after: { id: admin.id, username: admin.username, fullName: admin.fullName, email: admin.email, roles: admin.roles },
            reason: SETUP_REASON,
          },
        });
        const catalogItemsCreated = input.loadStarterCatalog ? await applyStarterCatalog(tx) : 0;
        return { labName: settings.name, adminUsername: admin.username, catalogItemsCreated };
      },
      { timeout: 60_000 },
    );
    this.logger.log(`Installation terminée : laboratoire « ${result.labName} », administrateur « ${result.adminUsername} ».`);
    return result;
  }

  private async assertOpen(): Promise<void> {
    if ((await this.repo.countHumanUsers()) > 0) throw new ConflictError('L’installation est déjà terminée : connectez-vous avec un compte existant.');
  }

  private assertToken(token: string): void {
    const expected = this.config.setupToken;
    if (!expected) {
      throw new BusinessRuleError('SETUP_TOKEN_NOT_CONFIGURED', 'Le serveur n’a pas de code d’installation. Sur le serveur, exécutez « sudo lims setup-token » puis recommencez.');
    }
    if (!timingSafeEqual(digest(token.trim()), digest(expected))) {
      throw new BusinessRuleError('SETUP_TOKEN_INVALID', 'Code d’installation incorrect. Il est affiché à la fin de l’installation, et par « sudo lims setup-token ».');
    }
  }
}
