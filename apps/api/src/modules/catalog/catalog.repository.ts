import { Injectable } from '@nestjs/common';
import type { ListExamsQuery } from '@lims/shared';
import type { Prisma } from '../../generated/prisma/client';
import { skipTake, statusFilter } from '../../core/common/pagination';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';

const activeExamCount = { _count: { select: { exams: { where: { isActive: true } } } } } as const;

export const examListInclude = {
  section: { select: { id: true, code: true, name: true } },
  sampleType: { select: { id: true, code: true, name: true, container: true } },
  _count: { select: { parameters: { where: { isActive: true } } } },
} as const satisfies Prisma.ExamInclude;

export const examDetailInclude = {
  ...examListInclude,
  parameters: {
    orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
    include: { referenceRanges: { orderBy: [{ sex: 'asc' }, { ageMinDays: 'asc' }] } },
  },
} as const satisfies Prisma.ExamInclude;

export type ExamListRow = Prisma.ExamGetPayload<{ include: typeof examListInclude }>;
export type ExamDetailRow = Prisma.ExamGetPayload<{ include: typeof examDetailInclude }>;
export type SectionRow = Prisma.LabSectionGetPayload<{ include: typeof activeExamCount }>;
export type SampleTypeRow = Prisma.SampleTypeGetPayload<{ include: typeof activeExamCount }>;

/** Accès aux données du catalogue (sections, types d'échantillon, examens, paramètres, valeurs de référence). */
@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Verrou de ligne pour sérialiser les modifications concurrentes d'un même élément. */
  async lock(table: 'lab_sections' | 'sample_types' | 'exams' | 'exam_parameters' | 'reference_ranges', id: string, db: Db) {
    // Nom de table issu d'une liste fermée : pas d'injection possible.
    await db.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`, id);
  }

  // --- Sections ------------------------------------------------------------

  listSections(): Promise<SectionRow[]> {
    return this.prisma.labSection.findMany({ include: activeExamCount, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
  }
  findSection(id: string, db: Db = this.prisma): Promise<SectionRow | null> {
    return db.labSection.findUnique({ where: { id }, include: activeExamCount });
  }
  findSectionByCode(code: string): Promise<{ id: string } | null> {
    return this.prisma.labSection.findUnique({ where: { code }, select: { id: true } });
  }
  createSection(data: Prisma.LabSectionCreateInput, db: Db): Promise<SectionRow> {
    return db.labSection.create({ data, include: activeExamCount });
  }
  updateSection(id: string, data: Prisma.LabSectionUpdateInput, db: Db): Promise<SectionRow> {
    return db.labSection.update({ where: { id }, data, include: activeExamCount });
  }

  // --- Types d'échantillon ---------------------------------------------------

  listSampleTypes(): Promise<SampleTypeRow[]> {
    return this.prisma.sampleType.findMany({ include: activeExamCount, orderBy: { name: 'asc' } });
  }
  findSampleType(id: string, db: Db = this.prisma): Promise<SampleTypeRow | null> {
    return db.sampleType.findUnique({ where: { id }, include: activeExamCount });
  }
  findSampleTypeByCode(code: string): Promise<{ id: string } | null> {
    return this.prisma.sampleType.findUnique({ where: { code }, select: { id: true } });
  }
  createSampleType(data: Prisma.SampleTypeCreateInput, db: Db): Promise<SampleTypeRow> {
    return db.sampleType.create({ data, include: activeExamCount });
  }
  updateSampleType(id: string, data: Prisma.SampleTypeUpdateInput, db: Db): Promise<SampleTypeRow> {
    return db.sampleType.update({ where: { id }, data, include: activeExamCount });
  }

  // --- Examens ---------------------------------------------------------------

  async listExams(query: ListExamsQuery): Promise<[ExamListRow[], number]> {
    const where: Prisma.ExamWhereInput = {
      isActive: statusFilter(query.status),
      sectionId: query.sectionId,
      OR: query.q
        ? [
            { code: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
            { shortName: { contains: query.q, mode: 'insensitive' } },
          ]
        : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.exam.findMany({
        where,
        include: examListInclude,
        orderBy: [{ section: { displayOrder: 'asc' } }, { displayOrder: 'asc' }, { name: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.exam.count({ where }),
    ]);
  }
  findExam(id: string, db: Db = this.prisma): Promise<ExamDetailRow | null> {
    return db.exam.findUnique({ where: { id }, include: examDetailInclude });
  }
  findExamByCode(code: string): Promise<{ id: string } | null> {
    return this.prisma.exam.findUnique({ where: { code }, select: { id: true } });
  }
  createExam(data: Prisma.ExamUncheckedCreateInput, db: Db): Promise<ExamDetailRow> {
    return db.exam.create({ data, include: examDetailInclude });
  }
  updateExam(id: string, data: Prisma.ExamUncheckedUpdateInput, db: Db): Promise<ExamDetailRow> {
    return db.exam.update({ where: { id }, data, include: examDetailInclude });
  }

  // --- Paramètres ------------------------------------------------------------

  findParameter(id: string, db: Db = this.prisma) {
    return db.examParameter.findUnique({
      where: { id },
      include: { referenceRanges: true, exam: { select: { id: true, isActive: true, code: true } } },
    });
  }
  findParameterByCode(examId: string, code: string, db: Db = this.prisma) {
    return db.examParameter.findUnique({ where: { examId_code: { examId, code } }, select: { id: true } });
  }
  countActiveParameters(examId: string, db: Db, excludeId?: string): Promise<number> {
    return db.examParameter.count({ where: { examId, isActive: true, id: excludeId ? { not: excludeId } : undefined } });
  }
  createParameter(data: Prisma.ExamParameterUncheckedCreateInput, db: Db) {
    return db.examParameter.create({ data });
  }
  updateParameter(id: string, data: Prisma.ExamParameterUncheckedUpdateInput, db: Db) {
    return db.examParameter.update({ where: { id }, data });
  }

  // --- Valeurs de référence ----------------------------------------------------

  findRange(id: string, db: Db = this.prisma) {
    return db.referenceRange.findUnique({ where: { id } });
  }
  listRanges(parameterId: string, db: Db) {
    return db.referenceRange.findMany({ where: { parameterId } });
  }
  createRange(data: Prisma.ReferenceRangeUncheckedCreateInput, db: Db) {
    return db.referenceRange.create({ data });
  }
  updateRange(id: string, data: Prisma.ReferenceRangeUncheckedUpdateInput, db: Db) {
    return db.referenceRange.update({ where: { id }, data });
  }
  deleteRange(id: string, db: Db) {
    return db.referenceRange.delete({ where: { id } });
  }
}
