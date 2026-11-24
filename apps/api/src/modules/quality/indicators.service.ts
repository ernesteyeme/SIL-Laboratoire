import { Injectable } from '@nestjs/common';
import {
  CRITICAL_NOTIFICATION_TARGET_MINUTES,
  type IndicatorsDto,
  type IndicatorsQuery,
  type NonConformityType,
  type QualityIssueCategory,
  type QualityIssueSeverity,
} from '@lims/shared';
import { LabContextService } from '../../core/common/lab-context.service';
import { zonedPeriod } from '../../core/common/time';
import { isoToDate } from '../../core/common/values';
import { labPeriods } from '../../core/numbering/numbering.service';
import { IndicatorsRepository } from './indicators.repository';

const round = (v: number | null, dp = 1): number | null => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const rate = (part: number, whole: number): number | null => (whole > 0 ? round((100 * part) / whole) : null);

/** Indicateurs qualité (ISO 15189 §8.8 : indicateurs de performance pré-, per- et post-analytiques). */
@Injectable()
export class IndicatorsService {
  constructor(
    private readonly repo: IndicatorsRepository,
    private readonly lab: LabContextService,
  ) {}

  async compute(query: IndicatorsQuery): Promise<IndicatorsDto> {
    const { timezone } = await this.lab.settings();
    const { start, end } = zonedPeriod(query.from, query.to, timezone);
    const period = { start, end, sectionId: query.sectionId };
    const today = isoToDate(labPeriods(new Date(), timezone).isoDate)!;

    const [byExam, overall, overdueNow, pre, samples, critical, reports, qc, issues] = await Promise.all([
      this.repo.tatByExam(period),
      this.repo.tatOverall(period),
      this.repo.overdueNow(query.sectionId),
      this.repo.preAnalyticalMedian(period),
      this.repo.samples(period),
      this.repo.critical(period, CRITICAL_NOTIFICATION_TARGET_MINUTES),
      this.repo.reports(period),
      this.repo.qc(period),
      this.repo.issues(period, today),
    ]);

    return {
      period: { from: query.from, to: query.to },
      tat: {
        overall: { count: overall.count, medianHours: round(overall.median), p90Hours: round(overall.p90), withinTargetPercent: round(overall.within) },
        byExam: byExam.map((r) => ({
          examCode: r.exam_code,
          examName: r.exam_name,
          sectionName: r.section_name,
          targetHours: r.target,
          count: r.count,
          medianHours: round(r.median),
          p90Hours: round(r.p90),
          withinTargetPercent: round(r.within),
        })),
        overdueNow,
        preAnalyticalMedianHours: round(pre),
      },
      samples: {
        received: samples.received,
        rejected: samples.rejected,
        rejectionRatePercent: rate(samples.rejected, samples.received + samples.rejected),
        derogations: samples.derogations,
        byType: samples.byType.map((t) => ({ type: t.type as NonConformityType, count: t.count })),
      },
      critical: {
        count: critical.count,
        acknowledged: critical.acknowledged,
        medianMinutes: round(critical.median),
        withinTargetPercent: round(critical.within),
        targetMinutes: CRITICAL_NOTIFICATION_TARGET_MINUTES,
      },
      reports: { final: reports.final, amended: reports.amended, amendedRatePercent: rate(reports.amended, reports.final) },
      qc: {
        runs: qc.runs,
        accepted: qc.accepted,
        warning: qc.warning,
        rejected: qc.rejected,
        rejectionRatePercent: rate(qc.rejected, qc.runs),
        byParameter: qc.byParameter.map((r) => ({ parameterCode: r.code, parameterName: r.name, runs: r.runs, warning: r.warning, rejected: r.rejected })),
      },
      issues: {
        declared: issues.declared,
        byCategory: issues.byCategory.map((c) => ({ category: c.category as QualityIssueCategory, count: c.count })),
        bySeverity: issues.bySeverity.map((c) => ({ severity: c.severity as QualityIssueSeverity, count: c.count })),
        openNow: issues.openNow,
        overdueNow: issues.overdueNow,
        medianClosureDays: round(issues.medianDays),
      },
    };
  }
}
