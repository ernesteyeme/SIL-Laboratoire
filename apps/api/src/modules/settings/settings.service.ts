import { Injectable } from '@nestjs/common';
import { secondaryCurrencyFor, type LabSettingsDto, type LabSettingsInput } from '@lims/shared';
import type { LabSettings } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { changedFields } from '../../core/audit/audit-serializer';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LAB_SETTINGS_ID, SettingsRepository } from './settings.repository';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SettingsRepository,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<LabSettingsDto> {
    const settings = await this.repository.find();
    if (!settings) throw new NotFoundError('Paramètres du laboratoire');
    return toDto(settings);
  }

  async update(input: LabSettingsInput, actor: RequestUser): Promise<LabSettingsDto> {
    if (!isValidTimezone(input.timezone)) {
      throw new BusinessRuleError('INVALID_TIMEZONE', `Fuseau horaire inconnu : « ${input.timezone} ».`);
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockForUpdate(tx);
      const current = await this.repository.find(tx);
      const next = await this.repository.upsert(
        {
          name: input.name,
          shortName: input.shortName ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          country: input.country ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          accreditationNumber: input.accreditationNumber ?? null,
          accreditationBody: input.accreditationBody ?? null,
          directorName: input.directorName ?? null,
          reportFooter: input.reportFooter ?? null,
          currency: input.currency,
          timezone: input.timezone,
          requirePaymentBeforeCollection: input.requirePaymentBeforeCollection,
          secondaryCurrencyEnabled: input.secondaryCurrencyEnabled,
          updatedById: actor.id,
        },
        tx,
      );

      const before = current ? auditView(current) : null;
      const after = auditView(next);
      const fields = changedFields(before, after);
      if (fields.length > 0) {
        await this.audit.record(tx, {
          action: current ? 'UPDATE' : 'CREATE',
          entity: 'LabSettings',
          entityId: String(LAB_SETTINGS_ID),
          before: before ?? undefined,
          after,
          reason: `Champs modifiés : ${fields.join(', ')}`,
        });
      }
      return next;
    });

    return toDto(saved);
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function auditView(s: LabSettings) {
  const { updatedAt: _updatedAt, updatedById: _updatedById, ...rest } = s;
  return rest;
}

function toDto(s: LabSettings): LabSettingsDto {
  return {
    name: s.name,
    shortName: s.shortName,
    address: s.address,
    city: s.city,
    country: s.country,
    phone: s.phone,
    email: s.email,
    accreditationNumber: s.accreditationNumber,
    accreditationBody: s.accreditationBody,
    directorName: s.directorName,
    reportFooter: s.reportFooter,
    currency: s.currency,
    timezone: s.timezone,
    requirePaymentBeforeCollection: s.requirePaymentBeforeCollection,
    secondaryCurrencyEnabled: s.secondaryCurrencyEnabled,
    secondaryCurrency: secondaryCurrencyFor(s.currency, s.secondaryCurrencyEnabled),
    updatedAt: s.updatedAt.toISOString(),
  };
}
