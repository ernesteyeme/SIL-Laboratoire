import { Injectable } from '@nestjs/common';
import type {
  CreateLabSectionInput,
  CreateSampleTypeInput,
  LabSectionDto,
  SampleTypeDto,
  UpdateLabSectionInput,
  UpdateSampleTypeInput,
} from '@lims/shared';
import { AuditService } from '../../core/audit/audit.service';
import { changedFields } from '../../core/audit/audit-serializer';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CatalogRepository, type SampleTypeRow, type SectionRow } from './catalog.repository';
import { toSampleTypeDto, toSectionDto } from './catalog.mapper';

const sectionAudit = (s: SectionRow) => ({ code: s.code, name: s.name, displayOrder: s.displayOrder, isActive: s.isActive });
const sampleTypeAudit = (s: SampleTypeRow) => ({
  code: s.code,
  name: s.name,
  container: s.container,
  instructions: s.instructions,
  isActive: s.isActive,
});

/** Sections (disciplines) et types d'échantillon. */
@Injectable()
export class CatalogStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CatalogRepository,
    private readonly audit: AuditService,
  ) {}

  // --- Sections --------------------------------------------------------------

  async listSections(): Promise<LabSectionDto[]> {
    return (await this.repo.listSections()).map(toSectionDto);
  }

  async createSection(input: CreateLabSectionInput): Promise<LabSectionDto> {
    if (await this.repo.findSectionByCode(input.code)) {
      throw new ConflictError(`Le code de section « ${input.code} » existe déjà.`, [{ path: 'code', message: 'Code déjà utilisé.' }]);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const s = await this.repo.createSection(input, tx);
      await this.audit.record(tx, { action: 'CREATE', entity: 'LabSection', entityId: s.id, after: sectionAudit(s) });
      return s;
    });
    return toSectionDto(created);
  }

  async updateSection(id: string, input: UpdateLabSectionInput): Promise<LabSectionDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.repo.lock('lab_sections', id, tx);
      const current = await this.repo.findSection(id, tx);
      if (!current) throw new NotFoundError('Section', id);
      if (input.isActive === false && current._count.exams > 0) {
        throw new BusinessRuleError(
          'SECTION_HAS_ACTIVE_EXAMS',
          `Impossible de désactiver cette section : ${current._count.exams} examen(s) actif(s) y sont rattachés.`,
        );
      }
      const next = await this.repo.updateSection(
        id,
        { name: input.name, displayOrder: input.displayOrder, isActive: input.isActive },
        tx,
      );
      await this.recordUpdate(tx, 'LabSection', id, sectionAudit(current), sectionAudit(next), input.isActive, input.reason);
      return next;
    });
    return toSectionDto(updated);
  }

  // --- Types d'échantillon -----------------------------------------------------

  async listSampleTypes(): Promise<SampleTypeDto[]> {
    return (await this.repo.listSampleTypes()).map(toSampleTypeDto);
  }

  async createSampleType(input: CreateSampleTypeInput): Promise<SampleTypeDto> {
    if (await this.repo.findSampleTypeByCode(input.code)) {
      throw new ConflictError(`Le code « ${input.code} » existe déjà.`, [{ path: 'code', message: 'Code déjà utilisé.' }]);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const s = await this.repo.createSampleType(
        { code: input.code, name: input.name, container: input.container ?? null, instructions: input.instructions ?? null },
        tx,
      );
      await this.audit.record(tx, { action: 'CREATE', entity: 'SampleType', entityId: s.id, after: sampleTypeAudit(s) });
      return s;
    });
    return toSampleTypeDto(created);
  }

  async updateSampleType(id: string, input: UpdateSampleTypeInput): Promise<SampleTypeDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.repo.lock('sample_types', id, tx);
      const current = await this.repo.findSampleType(id, tx);
      if (!current) throw new NotFoundError('Type d’échantillon', id);
      if (input.isActive === false && current._count.exams > 0) {
        throw new BusinessRuleError(
          'SAMPLE_TYPE_HAS_ACTIVE_EXAMS',
          `Impossible de désactiver ce type d’échantillon : ${current._count.exams} examen(s) actif(s) l’utilisent.`,
        );
      }
      const next = await this.repo.updateSampleType(
        id,
        { name: input.name, container: input.container, instructions: input.instructions, isActive: input.isActive },
        tx,
      );
      await this.recordUpdate(tx, 'SampleType', id, sampleTypeAudit(current), sampleTypeAudit(next), input.isActive, input.reason);
      return next;
    });
    return toSampleTypeDto(updated);
  }

  private async recordUpdate(
    tx: Parameters<AuditService['record']>[0],
    entity: 'LabSection' | 'SampleType',
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    isActive: boolean | undefined,
    reason: string | undefined,
  ): Promise<void> {
    const fields = changedFields(before, after);
    if (fields.length === 0) return;
    await this.audit.record(tx, {
      action: isActive === false && before.isActive ? 'DELETE' : isActive === true && !before.isActive ? 'RESTORE' : 'UPDATE',
      entity,
      entityId: id,
      before,
      after,
      reason: reason ?? `Champs modifiés : ${fields.join(', ')}`,
    });
  }
}
