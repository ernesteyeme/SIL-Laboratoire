import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  InstrumentApiKeyDto,
  InstrumentDto,
  InstrumentInput,
  InstrumentMappingInput,
  InstrumentQcMaterialInput,
} from '@lims/shared';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { PasswordService } from '../../core/security/password.service';
import { toInstrumentDto } from './instruments.mapper';
import { InstrumentsRepository } from './instruments.repository';

/** Empreinte d'une clé d'API (clé aléatoire de 192 bits : un SHA-256 suffit, aucun sel nécessaire). */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

const serviceUsername = (code: string) => `automate.${code.toLowerCase()}`;
const serviceFullName = (name: string) => `Automate ${name}`.slice(0, 120);

@Injectable()
export class InstrumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InstrumentsRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<InstrumentDto[]> {
    const [rows, pending] = await Promise.all([this.repo.list(), this.repo.pendingCounts()]);
    return rows.map((r) => toInstrumentDto(r, pending.get(r.id) ?? 0));
  }

  async get(id: string): Promise<InstrumentDto> {
    const [row, pending] = await Promise.all([this.repo.find(id), this.repo.pendingCounts()]);
    if (!row) throw new NotFoundError('Automate', id);
    return toInstrumentDto(row, pending.get(id) ?? 0);
  }

  /**
   * Déclaration d'un automate. Un compte de service lui est associé : il porte, dans la piste d'audit
   * et sur les résultats, les actions de l'automate. Ce compte n'a aucun rôle et ne peut pas se connecter.
   */
  async create(input: InstrumentInput): Promise<InstrumentDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertSection(tx, input.sectionId);
      const taken = await tx.user.findUnique({ where: { username: serviceUsername(input.code) } });
      if (taken) throw new ConflictError(`Le compte de service ${serviceUsername(input.code)} existe déjà.`);
      // Mot de passe aléatoire jamais communiqué : l'empreinte n'est là que pour satisfaire le modèle.
      const unusable = await this.passwords.hash(randomBytes(48).toString('base64url'));
      const serviceUser = await tx.user.create({
        data: {
          username: serviceUsername(input.code),
          fullName: serviceFullName(input.name),
          passwordHash: unusable,
          roles: [],
          isServiceAccount: true,
          mustChangePassword: false,
        },
      });
      try {
        const created = await tx.instrument.create({
          data: {
            code: input.code,
            name: input.name,
            manufacturer: input.manufacturer ?? null,
            model: input.model ?? null,
            sectionId: input.sectionId ?? null,
            protocol: input.protocol,
            csvConfig: input.protocol === 'CSV' && input.csvConfig ? input.csvConfig : Prisma.DbNull,
            isActive: input.isActive ?? true,
            serviceUserId: serviceUser.id,
          },
        });
        await this.audit.record(tx, { action: 'CREATE', entity: 'Instrument', entityId: created.id, after: { ...created, serviceUser: serviceUser.username } });
        return created.id;
      } catch (e) {
        throw this.unique(e);
      }
    });
    return this.get(id);
  }

  async update(id: string, input: InstrumentInput): Promise<InstrumentDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.instrument.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Automate', id);
      if (input.code !== before.code) {
        throw new BusinessRuleError('INSTRUMENT_CODE_IMMUTABLE', 'Le code d’un automate ne se modifie pas (il identifie son compte de service et ses messages).');
      }
      await this.assertSection(tx, input.sectionId);
      const after = await tx.instrument.update({
        where: { id },
        data: {
          name: input.name,
          manufacturer: input.manufacturer ?? null,
          model: input.model ?? null,
          sectionId: input.sectionId ?? null,
          protocol: input.protocol,
          csvConfig: input.protocol === 'CSV' && input.csvConfig ? input.csvConfig : Prisma.DbNull,
          isActive: input.isActive ?? before.isActive,
        },
      });
      // Le compte de service suit l'état de l'automate : désactivé, il ne peut plus rien transmettre.
      await tx.user.update({ where: { id: before.serviceUserId }, data: { fullName: serviceFullName(input.name), isActive: after.isActive } });
      await this.audit.record(tx, { action: 'UPDATE', entity: 'Instrument', entityId: id, before, after });
    });
    return this.get(id);
  }

  /** Nouvelle clé d'API : l'ancienne est immédiatement invalidée. La clé complète n'est renvoyée qu'ici. */
  async rotateApiKey(id: string): Promise<InstrumentApiKeyDto> {
    return this.prisma.$transaction(async (tx) => {
      const instrument = await tx.instrument.findUnique({ where: { id } });
      if (!instrument) throw new NotFoundError('Automate', id);
      // En-tête lisible (code de l'automate) + secret aléatoire. Le préfixe affiché se construit depuis l'en-tête connu :
      // le secret (base64url) peut lui-même contenir « _ », il ne faut donc jamais le rechercher dans la clé.
      const head = `sil_${instrument.code.toLowerCase().replace(/[^a-z0-9]/g, '')}_`;
      const secret = randomBytes(24).toString('base64url');
      const apiKey = `${head}${secret}`;
      const prefix = `${head}${secret.slice(0, 4)}…`;
      await tx.instrument.update({ where: { id }, data: { apiKeyHash: hashApiKey(apiKey), apiKeyPrefix: prefix, apiKeyRotatedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Instrument',
        entityId: id,
        before: { apiKeyPrefix: instrument.apiKeyPrefix },
        after: { apiKeyPrefix: prefix },
        reason: instrument.apiKeyHash ? 'Renouvellement de la clé du connecteur (ancienne clé révoquée)' : 'Émission de la clé du connecteur',
      });
      return { apiKey, prefix };
    });
  }

  /** Correspondance code test de l'automate → paramètre du catalogue (création ou mise à jour par code). */
  async upsertMapping(id: string, input: InstrumentMappingInput): Promise<InstrumentDto> {
    await this.prisma.$transaction(async (tx) => {
      const instrument = await tx.instrument.findUnique({ where: { id } });
      if (!instrument) throw new NotFoundError('Automate', id);
      const parameter = await tx.examParameter.findUnique({ where: { id: input.parameterId }, select: { id: true, code: true, resultType: true, choices: true } });
      if (!parameter) throw new NotFoundError('Paramètre', input.parameterId);
      if (parameter.resultType !== 'NUMERIC' && input.factor !== 1) {
        throw new BusinessRuleError('FACTOR_NUMERIC_ONLY', 'Un facteur de conversion ne s’applique qu’à un paramètre numérique.');
      }
      if (parameter.resultType === 'CHOICE') {
        const invalid = Object.values(input.valueMap).filter((v) => !parameter.choices.some((c) => c.toLowerCase() === v.toLowerCase()));
        if (invalid.length > 0) {
          throw new BusinessRuleError('VALUE_MAP_INVALID', `Valeurs hors des choix du paramètre : ${invalid.join(', ')} (choix : ${parameter.choices.join(', ')}).`);
        }
      }
      const existing = await tx.instrumentTestMapping.findUnique({ where: { instrumentId_instrumentCode: { instrumentId: id, instrumentCode: input.instrumentCode } } });
      const data = { parameterId: input.parameterId, factor: String(input.factor), valueMap: input.valueMap, isActive: input.isActive ?? true };
      const saved = existing
        ? await tx.instrumentTestMapping.update({ where: { id: existing.id }, data })
        : await tx.instrumentTestMapping.create({ data: { instrumentId: id, instrumentCode: input.instrumentCode, ...data } });
      await this.audit.record(tx, {
        action: existing ? 'UPDATE' : 'CREATE',
        entity: 'Instrument',
        entityId: id,
        before: existing ? { mapping: existing } : undefined,
        after: { mapping: { code: saved.instrumentCode, parameter: parameter.code, factor: input.factor, valueMap: input.valueMap, isActive: saved.isActive } },
        reason: `Correspondance ${instrument.code} « ${saved.instrumentCode} » → ${parameter.code}`,
      });
    });
    return this.get(id);
  }

  /** Identifiant de contrôle envoyé par l'automate → lot de contrôle qualité. */
  async upsertQcMaterial(id: string, input: InstrumentQcMaterialInput): Promise<InstrumentDto> {
    await this.prisma.$transaction(async (tx) => {
      const instrument = await tx.instrument.findUnique({ where: { id } });
      if (!instrument) throw new NotFoundError('Automate', id);
      const material = await tx.qcMaterial.findUnique({ where: { id: input.materialId } });
      if (!material) throw new NotFoundError('Lot de contrôle', input.materialId);
      const existing = await tx.instrumentQcMaterial.findUnique({ where: { instrumentId_specimenId: { instrumentId: id, specimenId: input.specimenId } } });
      if (existing) await tx.instrumentQcMaterial.update({ where: { id: existing.id }, data: { materialId: input.materialId } });
      else await tx.instrumentQcMaterial.create({ data: { instrumentId: id, specimenId: input.specimenId, materialId: input.materialId } });
      await this.audit.record(tx, {
        action: existing ? 'UPDATE' : 'CREATE',
        entity: 'Instrument',
        entityId: id,
        after: { qcSpecimen: input.specimenId, material: `${material.name} ${material.level} lot ${material.lotNumber}` },
        reason: `Contrôle ${instrument.code} « ${input.specimenId} » → lot ${material.lotNumber}`,
      });
    });
    return this.get(id);
  }

  async removeQcMaterial(id: string, linkId: string): Promise<InstrumentDto> {
    await this.prisma.$transaction(async (tx) => {
      const link = await tx.instrumentQcMaterial.findUnique({ where: { id: linkId } });
      if (!link || link.instrumentId !== id) throw new NotFoundError('Correspondance de contrôle', linkId);
      await tx.instrumentQcMaterial.delete({ where: { id: linkId } });
      await this.audit.record(tx, { action: 'DELETE', entity: 'Instrument', entityId: id, before: { qcSpecimen: link.specimenId, materialId: link.materialId }, reason: `Retrait du contrôle « ${link.specimenId} »` });
    });
    return this.get(id);
  }

  private async assertSection(db: Db, sectionId: string | null | undefined): Promise<void> {
    if (sectionId && !(await db.labSection.findUnique({ where: { id: sectionId } }))) throw new NotFoundError('Section', sectionId);
  }

  private unique(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return new ConflictError('Un automate porte déjà ce code.');
    return e;
  }
}
