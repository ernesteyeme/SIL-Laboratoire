import { Injectable } from '@nestjs/common';
import {
  formatPrescriberName,
  nameSearchKey,
  type CreatePrescriberInput,
  type ListPrescribersQuery,
  type Paginated,
  type PrescriberDto,
  type UpdatePrescriberInput,
} from '@lims/shared';
import type { Prescriber } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { changedFields } from '../../core/audit/audit-serializer';
import { toPage } from '../../core/common/pagination';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { PrescribersRepository } from './prescribers.repository';

@Injectable()
export class PrescribersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prescribers: PrescribersRepository,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListPrescribersQuery): Promise<Paginated<PrescriberDto>> {
    const [rows, total] = await this.prescribers.findMany(query);
    return toPage(rows.map(toPrescriberDto), total, query);
  }

  async get(id: string): Promise<PrescriberDto> {
    return toPrescriberDto(await this.getOrThrow(id));
  }

  async create(input: CreatePrescriberInput): Promise<PrescriberDto> {
    if (input.licenseNumber) await this.assertLicenseAvailable(input.licenseNumber);

    const created = await this.prisma.$transaction(async (tx) => {
      const p = await this.prescribers.create(
        {
          title: input.title ?? null,
          lastName: input.lastName,
          firstName: input.firstName ?? null,
          searchName: nameSearchKey(input.lastName, input.firstName),
          specialty: input.specialty ?? null,
          facility: input.facility ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          licenseNumber: input.licenseNumber ?? null,
        },
        tx,
      );
      await this.audit.record(tx, { action: 'CREATE', entity: 'Prescriber', entityId: p.id, after: auditView(p) });
      return p;
    });
    return toPrescriberDto(created);
  }

  async update(id: string, input: UpdatePrescriberInput): Promise<PrescriberDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.prescribers.lockForUpdate(id, tx);
      const current = await this.getOrThrow(id, tx);

      if (input.licenseNumber && input.licenseNumber !== current.licenseNumber) {
        await this.assertLicenseAvailable(input.licenseNumber, id, tx);
      }
      if (input.isActive === current.isActive) {
        throw new BusinessRuleError(
          'STATUS_UNCHANGED',
          current.isActive ? 'Ce prescripteur est déjà actif.' : 'Ce prescripteur est déjà désactivé.',
        );
      }
      if (input.isActive === undefined && !current.isActive) {
        throw new BusinessRuleError('PRESCRIBER_INACTIVE', 'Réactivez ce prescripteur avant de le modifier.');
      }

      const lastName = input.lastName ?? current.lastName;
      const firstName = input.firstName === undefined ? current.firstName : input.firstName;

      const next = await this.prescribers.update(
        id,
        {
          title: input.title,
          lastName,
          firstName,
          searchName: nameSearchKey(lastName, firstName),
          specialty: input.specialty,
          facility: input.facility,
          phone: input.phone,
          email: input.email,
          licenseNumber: input.licenseNumber,
          isActive: input.isActive,
          deactivationReason: input.isActive === undefined ? undefined : input.isActive ? null : (input.reason ?? null),
        },
        tx,
      );

      const before = auditView(current);
      const after = auditView(next);
      const fields = changedFields(before, after);
      if (fields.length > 0) {
        await this.audit.record(tx, {
          action: input.isActive === false ? 'DELETE' : input.isActive === true ? 'RESTORE' : 'UPDATE',
          entity: 'Prescriber',
          entityId: id,
          before,
          after,
          reason: input.reason ?? `Champs modifiés : ${fields.join(', ')}`,
        });
      }
      return next;
    });
    return toPrescriberDto(updated);
  }

  private async getOrThrow(id: string, db: Db = this.prisma): Promise<Prescriber> {
    const p = await this.prescribers.findById(id, db);
    if (!p) throw new NotFoundError('Prescripteur', id);
    return p;
  }

  private async assertLicenseAvailable(licenseNumber: string, exceptId?: string, db: Db = this.prisma): Promise<void> {
    const existing = await this.prescribers.findByLicense(licenseNumber, db);
    if (existing && existing.id !== exceptId) {
      throw new ConflictError(`Le n° d’Ordre « ${licenseNumber} » est déjà attribué à ${formatPrescriberName(existing)}.`, [
        { path: 'licenseNumber', message: 'N° d’Ordre déjà utilisé.' },
      ]);
    }
  }
}

function auditView(p: Prescriber) {
  const { searchName: _s, createdAt: _c, updatedAt: _u, ...rest } = p;
  return rest;
}

export function toPrescriberDto(p: Prescriber): PrescriberDto {
  return {
    id: p.id,
    title: p.title,
    lastName: p.lastName,
    firstName: p.firstName,
    displayName: formatPrescriberName(p),
    specialty: p.specialty,
    facility: p.facility,
    phone: p.phone,
    email: p.email,
    licenseNumber: p.licenseNumber,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
