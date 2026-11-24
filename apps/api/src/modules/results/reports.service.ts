import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  computeAge,
  formatPatientName,
  formatPrescriberName,
  NON_CONFORMITY_TYPE_LABELS,
  type ReportDto,
  type ReportKind,
} from '@lims/shared';
import { AuditService } from '../../core/audit/audit.service';
import { LabContextService } from '../../core/common/lab-context.service';
import { dateToIso, decimalToNumber } from '../../core/common/values';
import type { RequestUser } from '../../core/context/request-context';
import { BusinessRuleError, NotFoundError } from '../../core/errors/domain.exception';
import { labPeriods, NumberingService } from '../../core/numbering/numbering.service';
import { PrismaService, type Db } from '../../core/prisma/prisma.service';
import { buildReportPdf, referenceText, type ReportContent } from './report-pdf';
import { displayValueOf, toReportDto, type PreviousMap } from './results.mapper';
import { ResultsRepository } from './results.repository';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ResultsRepository,
    private readonly numbering: NumberingService,
    private readonly lab: LabContextService,
    private readonly audit: AuditService,
  ) {}

  async list(orderId: string): Promise<ReportDto[]> {
    const rows = await this.repo.listReports(orderId);
    const names = await this.lab.userNames(rows.map((r) => r.issuedById));
    return rows.map((r) => toReportDto(r, names));
  }

  async pdf(reportId: string): Promise<{ number: string; pdf: Buffer; sha256: string }> {
    const report = await this.repo.findReportPdf(reportId);
    if (!report) throw new NotFoundError('Compte rendu', reportId);
    return { number: report.number, pdf: Buffer.from(report.pdf), sha256: report.sha256 };
  }

  /** Compte rendu partiel à la demande du biologiste (une partie seulement des examens est validée). */
  async issuePartial(orderId: string, actor: RequestUser): Promise<ReportDto> {
    const id = await this.prisma.$transaction(
      async (tx) => {
        const items = await tx.orderItem.findMany({ where: { orderId }, select: { analysisStatus: true } });
        if (items.length === 0) throw new NotFoundError('Demande', orderId);
        const validated = items.filter((i) => i.analysisStatus === 'VALIDATED').length;
        if (validated === 0) throw new BusinessRuleError('NOTHING_VALIDATED', 'Aucun examen validé : rien à éditer.');
        if (validated === items.length) {
          throw new BusinessRuleError('ALL_VALIDATED', 'Tous les examens sont validés : le compte rendu définitif a été émis automatiquement.');
        }
        return this.issue(tx, orderId, 'PARTIAL', actor);
      },
      { timeout: 30_000 },
    );
    return (await this.list(orderId)).find((r) => r.id === id)!;
  }

  /**
   * Émission d'un compte rendu : contenu figé à partir des examens validés, PDF généré, empreinte SHA-256,
   * archivage immuable (trigger en base). Le précédent compte rendu est référencé (« remplace … »).
   */
  async issue(tx: Db, orderId: string, kind: ReportKind, actor: RequestUser): Promise<string> {
    const order = await tx.labOrder.findUnique({
      where: { id: orderId },
      include: {
        patient: true,
        prescriber: true,
        items: {
          include: {
            exam: { select: { section: { select: { name: true, displayOrder: true } } } },
            sample: {
              select: {
                collectedAt: true,
                receivedAt: true,
                hasReservation: true,
                sampleType: { select: { name: true } },
                nonConformities: { where: { decision: 'ACCEPTED_WITH_RESERVATION' } },
              },
            },
            results: { orderBy: [{ displayOrder: 'asc' }, { parameterCode: 'asc' }] },
            amendments: { orderBy: { amendedAt: 'desc' }, take: 1 },
          },
          orderBy: { examCode: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundError('Demande', orderId);
    const validated = order.items.filter((i) => i.analysisStatus === 'VALIDATED');
    if (validated.length === 0) throw new BusinessRuleError('NOTHING_VALIDATED', 'Aucun examen validé : rien à éditer.');

    const settings = await this.lab.settings(tx);
    const tz = settings.timezone;
    const fmt = (d: Date | null | undefined) =>
      d ? new Intl.DateTimeFormat('fr-FR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(d) : null;
    const previous = await this.repo.latestReport(orderId, tx);
    const prevResults = (await this.repo.previousResults(
      order.patientId,
      validated.flatMap((i) => i.results.map((r) => r.parameterId)),
      order.items.map((i) => i.id),
      tx,
    )) as PreviousMap;
    const names = await this.lab.userNames(validated.flatMap((i) => [i.validatedById, i.technicalValidatedById]));

    const firstCollected = validated.map((i) => i.sample.collectedAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const firstReceived = validated.map((i) => i.sample.receivedAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const birth = dateToIso(order.patient.birthDate);
    const now = new Date();

    const bySection = new Map<string, { name: string; order: number; exams: ReportContent['sections'][number]['exams'] }>();
    for (const item of validated) {
      const key = item.exam.section.name;
      if (!bySection.has(key)) bySection.set(key, { name: key, order: item.exam.section.displayOrder, exams: [] });
      bySection.get(key)!.exams.push({
        name: item.examName,
        code: item.examCode,
        sampleType: item.sample.sampleType.name,
        results: item.results.map((r) => {
          const prev = prevResults.get(r.parameterId);
          return {
            name: r.parameterName,
            value: displayValueOf(r),
            unit: r.unit,
            flag: r.flag,
            reference: referenceText({
              hasReference: r.hasReference,
              resultType: r.resultType,
              low: decimalToNumber(r.refLow),
              high: decimalToNumber(r.refHigh),
              normalText: r.refNormalText,
              label: r.refLabel,
            }),
            previous: prev ? `${displayValueOf(prev)} (${new Intl.DateTimeFormat('fr-FR', { timeZone: tz, dateStyle: 'short' }).format(prev.validatedAt)})` : null,
            comment: [r.comment, r.refComment].filter(Boolean).join(' — ') || null,
          };
        }),
        reservation: item.sample.hasReservation
          ? item.sample.nonConformities.map((n) => `${NON_CONFORMITY_TYPE_LABELS[n.type]}${n.comment ? ` — ${n.comment}` : ''}`).join(' ; ') ||
            'Échantillon accepté sous réserve'
          : null,
        biologistComment: item.biologistComment,
        validation: `Validation technique : ${names.get(item.technicalValidatedById ?? '') ?? '—'}, ${fmt(item.technicalValidatedAt) ?? '—'} · Validation biologique : ${
          names.get(item.validatedById ?? '') ?? '—'
        }, ${fmt(item.validatedAt) ?? '—'}${item.version > 1 ? ` · version ${item.version}` : ''}`,
      });
    }

    const content: ReportContent = {
      lab: {
        name: settings.name,
        address: settings.address,
        city: settings.city,
        country: settings.country,
        phone: settings.phone,
        email: settings.email,
        accreditation: settings.accreditationNumber
          ? `Accréditation ${settings.accreditationNumber}${settings.accreditationBody ? ` (${settings.accreditationBody})` : ''}`
          : null,
        directorName: settings.directorName,
        footer: settings.reportFooter,
      },
      number: await this.numbering.reportNumber(tx, tz, now),
      version: (previous?.version ?? 0) + 1,
      kind,
      supersedes: previous ? { number: previous.number, issuedAt: fmt(previous.issuedAt) ?? '' } : null,
      amendmentReasons: kind === 'AMENDED' ? validated.flatMap((i) => (i.version > 1 && i.amendments[0] ? [`${i.examCode} : ${i.amendments[0].reason}`] : [])) : [],
      pendingExams: order.items.filter((i) => i.analysisStatus !== 'VALIDATED').map((i) => i.examCode),
      patient: {
        fullName: formatPatientName(order.patient),
        code: order.patient.code,
        sex: order.patient.sex,
        age: birth ? computeAge(birth, labPeriods(firstCollected ?? now, tz).isoDate).label + (order.patient.birthDateEstimated ? ' (estimé)' : '') : null,
        birthDate: birth ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', dateStyle: 'short' }).format(order.patient.birthDate!) : null,
        externalId: order.patient.externalId,
      },
      order: {
        number: order.number,
        prescriber: order.prescriber ? formatPrescriberName(order.prescriber) : null,
        collectedAt: fmt(firstCollected),
        receivedAt: fmt(firstReceived),
        clinicalInfo: order.clinicalInfo,
      },
      issuedAt: fmt(now) ?? '',
      sections: [...bySection.values()].sort((a, b) => a.order - b.order).map(({ name, exams }) => ({ name, exams })),
      validators: [...new Set(validated.map((i) => names.get(i.validatedById ?? '') ?? '—'))],
    };

    const pdf = await buildReportPdf(content);
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const report = await tx.report.create({
      data: {
        number: content.number,
        orderId,
        version: content.version,
        kind,
        sha256,
        pdf: new Uint8Array(pdf),
        orderItemIds: validated.map((i) => i.id),
        examCodes: validated.map((i) => i.examCode),
        issuedById: actor.id,
        supersedesId: previous?.id ?? null,
      },
      select: { id: true },
    });
    await this.audit.record(tx, {
      action: 'CREATE',
      entity: 'Report',
      entityId: report.id,
      after: { number: content.number, order: order.number, version: content.version, kind, sha256, exams: validated.map((i) => i.examCode), supersedes: previous?.number ?? null },
      reason: `Émission du ${kind === 'PARTIAL' ? 'compte rendu partiel' : kind === 'AMENDED' ? 'compte rendu rectificatif' : 'compte rendu définitif'} ${content.number}`,
    });
    return report.id;
  }
}
