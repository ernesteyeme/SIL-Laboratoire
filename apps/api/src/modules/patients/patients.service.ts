import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  nameSearchKey,
  phoneKey,
  type CreatePatientInput,
  type DuplicateCandidate,
  type DuplicateCheckInput,
  type ListPatientsQuery,
  type Paginated,
  type PatientDto,
  type PatientStatusChangeInput,
  type UpdatePatientInput,
} from '@lims/shared';
import type { Patient } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { changedFields } from '../../core/audit/audit-serializer';
import { toPage } from '../../core/common/pagination';
import { isoToDate } from '../../core/common/values';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, DomainException, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { DUPLICATE_THRESHOLD, scoreDuplicate } from './duplicate-scoring';
import { toPatientAuditView, toPatientDto } from './patients.mapper';
import { PatientsRepository } from './patients.repository';

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patients: PatientsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListPatientsQuery): Promise<Paginated<PatientDto>> {
    const [rows, total] = await this.patients.findMany(query);
    return toPage(rows.map(toPatientDto), total, query);
  }

  async get(id: string): Promise<PatientDto> {
    return toPatientDto(await this.getOrThrow(id));
  }

  /** Doublons potentiels, triés par score décroissant. */
  async findDuplicates(input: DuplicateCheckInput): Promise<DuplicateCandidate[]> {
    const rows = await this.patients.findDuplicateRows(input);
    if (rows.length === 0) return [];
    const byId = new Map((await this.patients.findByIds(rows.map((r) => r.id))).map((p) => [p.id, p]));

    return rows
      .map((row) => {
        const patient = byId.get(row.id);
        if (!patient) return null;
        const dto = toPatientDto(patient);
        const { score, reasons } = scoreDuplicate({
          nameScore: Number(row.name_score),
          phoneMatch: row.phone_match,
          externalMatch: row.external_match,
          candidate: { sex: dto.sex, birthDate: dto.birthDate, birthDateEstimated: dto.birthDateEstimated },
          input: { sex: input.sex, birthDate: input.birthDate },
        });
        return { patient: dto, score, reasons };
      })
      .filter((c): c is DuplicateCandidate => c !== null && c.score >= DUPLICATE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  async create(input: CreatePatientInput, actor: RequestUser): Promise<PatientDto> {
    const candidates = await this.findDuplicates(input);
    if (candidates.length > 0 && !input.confirmNotDuplicate) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ERROR_CODES.DUPLICATE_SUSPECTED,
        `${candidates.length} patient(s) existant(s) ressemblent à ce patient. Vérifiez avant de créer un nouveau dossier.`,
        { candidates },
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const patient = await this.patients.create(
        {
          lastName: input.lastName,
          middleName: input.middleName ?? null,
          firstName: input.firstName ?? null,
          searchName: nameSearchKey(input.lastName, input.middleName, input.firstName),
          sex: input.sex,
          birthDate: isoToDate(input.birthDate) ?? null,
          birthDateEstimated: input.birthDateEstimated,
          phone: input.phone ?? null,
          phoneKey: phoneKey(input.phone),
          email: input.email ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          externalId: input.externalId ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
        tx,
      );
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'Patient',
        entityId: patient.id,
        after: toPatientAuditView(patient),
        reason:
          candidates.length > 0
            ? `Création confirmée par l'opérateur malgré ${candidates.length} doublon(s) potentiel(s) : ${candidates
                .map((c) => `${c.patient.code} (${Math.round(c.score * 100)} %)`)
                .join(', ')}`
            : null,
      });
      return patient;
    });

    return toPatientDto(created);
  }

  async update(id: string, input: UpdatePatientInput, actor: RequestUser): Promise<PatientDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.patients.lockForUpdate(id, tx);
      const current = await this.getOrThrow(id, tx);
      if (!current.isActive) {
        throw new BusinessRuleError('PATIENT_INACTIVE', 'Ce dossier est désactivé : réactivez-le avant de le modifier.');
      }

      const lastName = input.lastName ?? current.lastName;
      const middleName = input.middleName === undefined ? current.middleName : input.middleName;
      const firstName = input.firstName === undefined ? current.firstName : input.firstName;
      const birthDate = input.birthDate === undefined ? current.birthDate : isoToDate(input.birthDate);
      const birthDateEstimated = input.birthDateEstimated ?? current.birthDateEstimated;
      const phone = input.phone === undefined ? current.phone : input.phone;

      if (birthDateEstimated && !birthDate) {
        throw new BusinessRuleError(
          'ESTIMATED_WITHOUT_DATE',
          'Une date de naissance (même estimée) est requise si « estimée » est coché.',
        );
      }

      const next = await this.patients.update(
        id,
        {
          lastName,
          middleName,
          firstName,
          searchName: nameSearchKey(lastName, middleName, firstName),
          sex: input.sex,
          birthDate,
          birthDateEstimated,
          phone,
          phoneKey: phoneKey(phone),
          email: input.email,
          address: input.address,
          city: input.city,
          externalId: input.externalId,
          notes: input.notes,
          updatedById: actor.id,
        },
        tx,
      );

      const before = toPatientAuditView(current);
      const after = toPatientAuditView(next);
      const fields = changedFields(before, after).filter((f) => f !== 'createdById');
      if (fields.length > 0) {
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'Patient',
          entityId: id,
          before,
          after,
          reason: `Champs modifiés : ${fields.join(', ')}`,
        });
      }
      return next;
    });

    return toPatientDto(updated);
  }

  async deactivate(id: string, input: PatientStatusChangeInput, actor: RequestUser): Promise<PatientDto> {
    return this.changeStatus(id, false, input.reason, actor);
  }

  async reactivate(id: string, input: PatientStatusChangeInput, actor: RequestUser): Promise<PatientDto> {
    return this.changeStatus(id, true, input.reason, actor);
  }

  private async changeStatus(id: string, active: boolean, reason: string, actor: RequestUser): Promise<PatientDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.patients.lockForUpdate(id, tx);
      const current = await this.getOrThrow(id, tx);
      if (current.isActive === active) {
        throw new BusinessRuleError(
          active ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE',
          active ? 'Ce dossier est déjà actif.' : 'Ce dossier est déjà désactivé.',
        );
      }
      const next = await this.patients.update(
        id,
        active
          ? { isActive: true, deactivatedAt: null, deactivatedById: null, deactivationReason: null, updatedById: actor.id }
          : { isActive: false, deactivatedAt: new Date(), deactivatedById: actor.id, deactivationReason: reason, updatedById: actor.id },
        tx,
      );
      await this.audit.record(tx, {
        action: active ? 'RESTORE' : 'DELETE',
        entity: 'Patient',
        entityId: id,
        before: toPatientAuditView(current),
        after: toPatientAuditView(next),
        reason,
      });
      return next;
    });
    return toPatientDto(updated);
  }

  private async getOrThrow(id: string, db: Db = this.prisma): Promise<Patient> {
    const patient = await this.patients.findById(id, db);
    if (!patient) throw new NotFoundError('Patient', id);
    return patient;
  }
}
