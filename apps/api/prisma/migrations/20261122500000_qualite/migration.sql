-- =====================================================================
-- Étape 5 — Qualité : contrôle qualité interne (Westgard), non-conformités
-- =====================================================================

-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('ACCEPTED', 'WARNING', 'REJECTED');
CREATE TYPE "QcTargetSource" AS ENUM ('MANUFACTURER', 'LABORATORY');
CREATE TYPE "QualityIssueCategory" AS ENUM ('PRE_ANALYTICAL', 'ANALYTICAL', 'POST_ANALYTICAL', 'EQUIPMENT', 'REAGENT', 'COMPLAINT', 'SAFETY', 'OTHER');
CREATE TYPE "QualityIssueSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');
CREATE TYPE "QualityIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "qc_materials" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "manufacturer" VARCHAR(150),
    "lot_number" VARCHAR(60) NOT NULL,
    "level" VARCHAR(40) NOT NULL,
    "expires_on" DATE NOT NULL,
    "section_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "qc_materials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qc_targets" (
    "id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "mean" DECIMAL(14,4) NOT NULL,
    "sd" DECIMAL(14,4) NOT NULL,
    "source" "QcTargetSource" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "qc_targets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "qc_targets_sd_positive" CHECK ("sd" > 0)
);

CREATE TABLE "qc_runs" (
    "id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "performed_at" TIMESTAMPTZ(6) NOT NULL,
    "performed_by_id" UUID NOT NULL,
    "status" "QcStatus" NOT NULL,
    "violated_rules" TEXT[],
    "comment" VARCHAR(500),
    "corrective_action" VARCHAR(1000),
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "excluded_at" TIMESTAMPTZ(6),
    "excluded_by_id" UUID,
    "excluded_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qc_runs_pkey" PRIMARY KEY ("id"),
    -- Une série résolue porte son action corrective ; une série exclue porte son motif.
    CONSTRAINT "qc_runs_resolution" CHECK (("resolved_at" IS NULL) = ("corrective_action" IS NULL)),
    CONSTRAINT "qc_runs_exclusion" CHECK (("excluded_at" IS NULL) = ("excluded_reason" IS NULL))
);

CREATE TABLE "qc_results" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "mean" DECIMAL(14,4) NOT NULL,
    "sd" DECIMAL(14,4) NOT NULL,
    "z_score" DECIMAL(9,3) NOT NULL,
    "status" "QcStatus" NOT NULL,
    "violated_rules" TEXT[],
    CONSTRAINT "qc_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quality_issues" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "category" "QualityIssueCategory" NOT NULL,
    "severity" "QualityIssueSeverity" NOT NULL,
    "status" "QualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "description" VARCHAR(4000) NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL,
    "declared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declared_by_id" UUID NOT NULL,
    "immediate_action" VARCHAR(2000),
    "order_id" UUID,
    "sample_id" UUID,
    "qc_run_id" UUID,
    "root_cause" VARCHAR(2000),
    "corrective_action" VARCHAR(2000),
    "action_owner" VARCHAR(150),
    "action_due_date" DATE,
    "analyzed_by_id" UUID,
    "analyzed_at" TIMESTAMPTZ(6),
    "effectiveness_check" VARCHAR(2000),
    "closed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "cancelled_reason" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "quality_issues_pkey" PRIMARY KEY ("id"),
    -- Cohérence du cycle de vie : action planifiée avant « en cours », efficacité vérifiée avant clôture.
    CONSTRAINT "quality_issues_lifecycle" CHECK (
        ("status" = 'OPEN')
        OR ("status" = 'IN_PROGRESS' AND "corrective_action" IS NOT NULL AND "action_due_date" IS NOT NULL)
        OR ("status" = 'CLOSED' AND "corrective_action" IS NOT NULL AND "effectiveness_check" IS NOT NULL AND "closed_at" IS NOT NULL)
        OR ("status" = 'CANCELLED' AND "cancelled_reason" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "qc_materials_name_lot_number_level_key" ON "qc_materials"("name", "lot_number", "level");
CREATE UNIQUE INDEX "qc_targets_material_id_parameter_id_key" ON "qc_targets"("material_id", "parameter_id");
CREATE INDEX "qc_targets_parameter_id_idx" ON "qc_targets"("parameter_id");
CREATE INDEX "qc_runs_parameter_id_performed_at_idx" ON "qc_runs"("parameter_id", "performed_at");
CREATE INDEX "qc_runs_status_idx" ON "qc_runs"("status");
CREATE UNIQUE INDEX "qc_results_run_id_target_id_key" ON "qc_results"("run_id", "target_id");
CREATE INDEX "qc_results_target_id_idx" ON "qc_results"("target_id");
CREATE UNIQUE INDEX "quality_issues_number_key" ON "quality_issues"("number");
CREATE UNIQUE INDEX "quality_issues_qc_run_id_key" ON "quality_issues"("qc_run_id");
CREATE INDEX "quality_issues_status_idx" ON "quality_issues"("status");
CREATE INDEX "quality_issues_declared_at_idx" ON "quality_issues"("declared_at");

-- AddForeignKey
ALTER TABLE "qc_materials" ADD CONSTRAINT "qc_materials_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "lab_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_targets" ADD CONSTRAINT "qc_targets_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "qc_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_targets" ADD CONSTRAINT "qc_targets_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "exam_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "exam_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_results" ADD CONSTRAINT "qc_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "qc_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_results" ADD CONSTRAINT "qc_results_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "qc_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "lab_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "samples"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_qc_run_id_fkey" FOREIGN KEY ("qc_run_id") REFERENCES "qc_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Les valeurs mesurées d'un CIQ sont des enregistrements qualité : ni modification ni suppression.
CREATE OR REPLACE FUNCTION qc_results_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Les résultats de contrôle qualité sont immuables (%).', TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qc_results_no_update BEFORE UPDATE OR DELETE ON "qc_results"
  FOR EACH ROW EXECUTE FUNCTION qc_results_immutable();
