import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface Period {
  start: Date;
  end: Date;
  sectionId?: string;
}

type Num = number | string | null;
const n = (v: Num | bigint | { toString(): string }): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Requêtes d'agrégation des indicateurs qualité (SQL natif : médianes et 90e centiles via percentile_cont).
 * Toutes les bornes sont des instants UTC calculés à partir des jours locaux du laboratoire.
 */
@Injectable()
export class IndicatorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private section(alias: Prisma.Sql, sectionId?: string): Prisma.Sql {
    return sectionId ? Prisma.sql`AND ${alias}."section_id" = ${sectionId}::uuid` : Prisma.empty;
  }

  /** Délai réception → validation biologique, par examen. */
  async tatByExam(p: Period) {
    const rows = await this.prisma.$queryRaw<
      { exam_code: string; exam_name: string; section_name: string; target: number; count: number; median: Num; p90: Num; within: Num }[]
    >`
      SELECT e."code" AS exam_code, e."name" AS exam_name, sec."name" AS section_name, e."turnaround_hours" AS target,
             count(*)::int AS count,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (oi."validated_at" - s."received_at")) / 3600) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (oi."validated_at" - s."received_at")) / 3600) AS p90,
             100.0 * avg(CASE WHEN oi."validated_at" - s."received_at" <= make_interval(hours => e."turnaround_hours") THEN 1 ELSE 0 END) AS within
      FROM "order_items" oi
      JOIN "samples" s ON s."id" = oi."sample_id"
      JOIN "exams" e ON e."id" = oi."exam_id"
      JOIN "lab_sections" sec ON sec."id" = e."section_id"
      WHERE oi."analysis_status" = 'VALIDATED' AND s."received_at" IS NOT NULL
        AND oi."validated_at" >= ${p.start} AND oi."validated_at" < ${p.end}
        ${this.section(Prisma.sql`e`, p.sectionId)}
      GROUP BY e."code", e."name", sec."name", sec."display_order", e."turnaround_hours"
      ORDER BY sec."display_order", e."code"`;
    return rows.map((r) => ({ ...r, median: n(r.median), p90: n(r.p90), within: n(r.within) }));
  }

  async tatOverall(p: Period) {
    const [r] = await this.prisma.$queryRaw<{ count: number; median: Num; p90: Num; within: Num }[]>`
      SELECT count(*)::int AS count,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (oi."validated_at" - s."received_at")) / 3600) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (oi."validated_at" - s."received_at")) / 3600) AS p90,
             100.0 * avg(CASE WHEN oi."validated_at" - s."received_at" <= make_interval(hours => e."turnaround_hours") THEN 1 ELSE 0 END) AS within
      FROM "order_items" oi
      JOIN "samples" s ON s."id" = oi."sample_id"
      JOIN "exams" e ON e."id" = oi."exam_id"
      WHERE oi."analysis_status" = 'VALIDATED' AND s."received_at" IS NOT NULL
        AND oi."validated_at" >= ${p.start} AND oi."validated_at" < ${p.end}
        ${this.section(Prisma.sql`e`, p.sectionId)}`;
    return { count: r.count, median: n(r.median), p90: n(r.p90), within: n(r.within) };
  }

  async overdueNow(sectionId?: string): Promise<number> {
    const [r] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "order_items" oi
      JOIN "samples" s ON s."id" = oi."sample_id"
      JOIN "exams" e ON e."id" = oi."exam_id"
      JOIN "lab_orders" o ON o."id" = oi."order_id"
      WHERE oi."analysis_status" IN ('TO_ENTER', 'ENTERED', 'TECHNICAL_VALIDATED') AND o."status" <> 'CANCELLED'
        AND s."received_at" + make_interval(hours => e."turnaround_hours") < now()
        ${this.section(Prisma.sql`e`, sectionId)}`;
    return r.count;
  }

  /** Délai prélèvement → réception (médiane, heures). */
  async preAnalyticalMedian(p: Period): Promise<number | null> {
    const [r] = await this.prisma.$queryRaw<{ median: Num }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (s."received_at" - s."collected_at")) / 3600) AS median
      FROM "samples" s
      WHERE s."received_at" >= ${p.start} AND s."received_at" < ${p.end} AND s."collected_at" IS NOT NULL`;
    return n(r.median);
  }

  async samples(p: Period) {
    const [counts] = await this.prisma.$queryRaw<{ received: number; rejected: number; derogations: number }[]>`
      SELECT
        (SELECT count(*)::int FROM "samples" WHERE "received_at" >= ${p.start} AND "received_at" < ${p.end}) AS received,
        (SELECT count(*)::int FROM "non_conformities" WHERE "decision" = 'REJECTED' AND "recorded_at" >= ${p.start} AND "recorded_at" < ${p.end}) AS rejected,
        (SELECT count(*)::int FROM "non_conformities" WHERE "decision" = 'ACCEPTED_WITH_RESERVATION' AND "recorded_at" >= ${p.start} AND "recorded_at" < ${p.end}) AS derogations`;
    const byType = await this.prisma.$queryRaw<{ type: string; count: number }[]>`
      SELECT "type"::text AS type, count(*)::int AS count FROM "non_conformities"
      WHERE "recorded_at" >= ${p.start} AND "recorded_at" < ${p.end}
      GROUP BY "type" ORDER BY count DESC`;
    return { ...counts, byType };
  }

  async critical(p: Period, targetMinutes: number) {
    const [r] = await this.prisma.$queryRaw<{ count: number; acknowledged: number; median: Num; within: Num }[]>`
      SELECT count(*)::int AS count,
             count("acknowledged_at")::int AS acknowledged,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("acknowledged_at" - "detected_at")) / 60)
               FILTER (WHERE "acknowledged_at" IS NOT NULL) AS median,
             100.0 * avg(CASE WHEN "acknowledged_at" - "detected_at" <= make_interval(mins => ${targetMinutes}::int) THEN 1 ELSE 0 END) AS within
      FROM "critical_alerts"
      WHERE "cancelled_at" IS NULL AND "detected_at" >= ${p.start} AND "detected_at" < ${p.end}`;
    return { count: r.count, acknowledged: r.acknowledged, median: n(r.median), within: r.count > 0 ? n(r.within) : null };
  }

  async reports(p: Period) {
    const [r] = await this.prisma.$queryRaw<{ final: number; amended: number }[]>`
      SELECT count(*) FILTER (WHERE "kind" = 'FINAL')::int AS final, count(*) FILTER (WHERE "kind" = 'AMENDED')::int AS amended
      FROM "reports" WHERE "issued_at" >= ${p.start} AND "issued_at" < ${p.end}`;
    return r;
  }

  async qc(p: Period) {
    const sectionJoin = p.sectionId
      ? Prisma.sql`JOIN "exam_parameters" ep ON ep."id" = r."parameter_id" JOIN "exams" e ON e."id" = ep."exam_id" AND e."section_id" = ${p.sectionId}::uuid`
      : Prisma.empty;
    const [totals] = await this.prisma.$queryRaw<{ runs: number; accepted: number; warning: number; rejected: number }[]>`
      SELECT count(*)::int AS runs,
             count(*) FILTER (WHERE r."status" = 'ACCEPTED')::int AS accepted,
             count(*) FILTER (WHERE r."status" = 'WARNING')::int AS warning,
             count(*) FILTER (WHERE r."status" = 'REJECTED')::int AS rejected
      FROM "qc_runs" r ${sectionJoin}
      WHERE r."excluded_at" IS NULL AND r."performed_at" >= ${p.start} AND r."performed_at" < ${p.end}`;
    const byParameter = await this.prisma.$queryRaw<{ code: string; name: string; runs: number; warning: number; rejected: number }[]>`
      SELECT p."code", p."name", count(*)::int AS runs,
             count(*) FILTER (WHERE r."status" = 'WARNING')::int AS warning,
             count(*) FILTER (WHERE r."status" = 'REJECTED')::int AS rejected
      FROM "qc_runs" r
      JOIN "exam_parameters" p ON p."id" = r."parameter_id"
      JOIN "exams" ex ON ex."id" = p."exam_id"
      WHERE r."excluded_at" IS NULL AND r."performed_at" >= ${p.start} AND r."performed_at" < ${p.end}
        ${this.section(Prisma.sql`ex`, p.sectionId)}
      GROUP BY p."code", p."name" ORDER BY rejected DESC, runs DESC, p."code"`;
    return { ...totals, byParameter };
  }

  async issues(p: Period, today: Date) {
    const [counts] = await this.prisma.$queryRaw<{ declared: number; open_now: number; overdue_now: number; median_days: Num }[]>`
      SELECT
        (SELECT count(*)::int FROM "quality_issues" WHERE "declared_at" >= ${p.start} AND "declared_at" < ${p.end}) AS declared,
        (SELECT count(*)::int FROM "quality_issues" WHERE "status" IN ('OPEN', 'IN_PROGRESS')) AS open_now,
        (SELECT count(*)::int FROM "quality_issues" WHERE "status" = 'IN_PROGRESS' AND "action_due_date" < ${today}::date) AS overdue_now,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("closed_at" - "declared_at")) / 86400)
           FROM "quality_issues" WHERE "status" = 'CLOSED' AND "closed_at" >= ${p.start} AND "closed_at" < ${p.end}) AS median_days`;
    const byCategory = await this.prisma.$queryRaw<{ category: string; count: number }[]>`
      SELECT "category"::text AS category, count(*)::int AS count FROM "quality_issues"
      WHERE "declared_at" >= ${p.start} AND "declared_at" < ${p.end} GROUP BY "category" ORDER BY count DESC`;
    const bySeverity = await this.prisma.$queryRaw<{ severity: string; count: number }[]>`
      SELECT "severity"::text AS severity, count(*)::int AS count FROM "quality_issues"
      WHERE "declared_at" >= ${p.start} AND "declared_at" < ${p.end} GROUP BY "severity" ORDER BY count DESC`;
    return { declared: counts.declared, openNow: counts.open_now, overdueNow: counts.overdue_now, medianDays: n(counts.median_days), byCategory, bySeverity };
  }
}
