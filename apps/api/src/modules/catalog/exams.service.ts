import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateExamInput,
  type ExamDetailDto,
  type ExamListItemDto,
  type ListExamsQuery,
  type Paginated,
  type UpdateExamInput,
} from '@lims/shared';
import { AuditService } from '../../core/audit/audit.service';
import { changedFields } from '../../core/audit/audit-serializer';
import { toPage } from '../../core/common/pagination';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, ConflictError, DomainException, NotFoundError } from '../../core/errors/domain.exception';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { CatalogRepository, type ExamDetailRow } from './catalog.repository';
import { examAuditView, toExamDetailDto, toExamListItemDto } from './catalog.mapper';

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CatalogRepository,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListExamsQuery): Promise<Paginated<ExamListItemDto>> {
    const [rows, total] = await this.repo.listExams(query);
    return toPage(rows.map(toExamListItemDto), total, query);
  }

  async get(id: string): Promise<ExamDetailDto> {
    return toExamDetailDto(await this.getOrThrow(id));
  }

  /**
   * Un nouvel examen est créé INACTIF : il ne devient commandable qu'après ajout
   * d'au moins un paramètre et activation explicite (revue par un biologiste ou un administrateur).
   */
  async create(input: CreateExamInput): Promise<ExamDetailDto> {
    if (await this.repo.findExamByCode(input.code)) {
      throw new ConflictError(`Le code d’examen « ${input.code} » existe déjà.`, [{ path: 'code', message: 'Code déjà utilisé.' }]);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertSectionAndSampleTypeActive(input.sectionId, input.sampleTypeId, tx);
      const exam = await this.repo.createExam(
        {
          code: input.code,
          name: input.name,
          shortName: input.shortName ?? null,
          sectionId: input.sectionId,
          sampleTypeId: input.sampleTypeId,
          price: input.price,
          turnaroundHours: input.turnaroundHours,
          patientInstructions: input.patientInstructions ?? null,
          displayOrder: input.displayOrder,
          isActive: false,
        },
        tx,
      );
      await this.audit.record(tx, { action: 'CREATE', entity: 'Exam', entityId: exam.id, after: examAuditView(exam) });
      return exam;
    });
    return toExamDetailDto(created);
  }

  async update(id: string, input: UpdateExamInput, actor: RequestUser): Promise<ExamDetailDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.repo.lock('exams', id, tx);
      const current = await this.getOrThrow(id, tx);

      // Les tarifs relèvent de l'administration (impact financier).
      if (input.price !== undefined && current.price.toFixed(2) !== Number(input.price).toFixed(2) && !actor.roles.includes('ADMIN')) {
        throw new DomainException(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.ACCESS_DENIED,
          'Seul un administrateur peut modifier le tarif d’un examen.',
          { rule: 'PRICE_CHANGE_ADMIN_ONLY' },
        );
      }

      const sectionId = input.sectionId ?? current.sectionId;
      const sampleTypeId = input.sampleTypeId ?? current.sampleTypeId;
      const willBeActive = input.isActive ?? current.isActive;

      if (input.isActive === current.isActive) {
        throw new BusinessRuleError(
          'STATUS_UNCHANGED',
          current.isActive ? 'Cet examen est déjà actif.' : 'Cet examen est déjà inactif.',
        );
      }

      if (willBeActive) {
        if (input.sectionId || input.sampleTypeId || input.isActive) {
          await this.assertSectionAndSampleTypeActive(sectionId, sampleTypeId, tx);
        }
        if (input.isActive) {
          const activeParameters = await this.repo.countActiveParameters(id, tx);
          if (activeParameters === 0) {
            throw new BusinessRuleError(
              'EXAM_WITHOUT_PARAMETERS',
              'Impossible d’activer un examen sans paramètre actif. Ajoutez au moins un paramètre.',
            );
          }
        }
      }

      const next = await this.repo.updateExam(
        id,
        {
          name: input.name,
          shortName: input.shortName,
          sectionId: input.sectionId,
          sampleTypeId: input.sampleTypeId,
          price: input.price,
          turnaroundHours: input.turnaroundHours,
          patientInstructions: input.patientInstructions,
          displayOrder: input.displayOrder,
          isActive: input.isActive,
        },
        tx,
      );

      const before = examAuditView(current);
      const after = examAuditView(next);
      const fields = changedFields(before, after);
      if (fields.length > 0) {
        await this.audit.record(tx, {
          action: input.isActive === false ? 'DELETE' : input.isActive === true ? 'RESTORE' : 'UPDATE',
          entity: 'Exam',
          entityId: id,
          before,
          after,
          reason: input.reason ?? `Champs modifiés : ${fields.join(', ')}`,
        });
      }
      return next;
    });
    return toExamDetailDto(updated);
  }

  private async getOrThrow(id: string, db: Db = this.prisma): Promise<ExamDetailRow> {
    const exam = await this.repo.findExam(id, db);
    if (!exam) throw new NotFoundError('Examen', id);
    return exam;
  }

  private async assertSectionAndSampleTypeActive(sectionId: string, sampleTypeId: string, db: Db): Promise<void> {
    const [section, sampleType] = await Promise.all([this.repo.findSection(sectionId, db), this.repo.findSampleType(sampleTypeId, db)]);
    if (!section) throw new NotFoundError('Section', sectionId);
    if (!sampleType) throw new NotFoundError('Type d’échantillon', sampleTypeId);
    if (!section.isActive) throw new BusinessRuleError('SECTION_INACTIVE', `La section « ${section.name} » est désactivée.`);
    if (!sampleType.isActive) {
      throw new BusinessRuleError('SAMPLE_TYPE_INACTIVE', `Le type d’échantillon « ${sampleType.name} » est désactivé.`);
    }
  }
}
