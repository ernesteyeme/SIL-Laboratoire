-- =====================================================================
-- Étape 4 — Résultats, validation, alertes critiques, comptes rendus
-- =====================================================================

-- AlterEnum (nouvelles valeurs non utilisées dans cette migration)
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_VALIDATED';
ALTER TYPE "OrderStatus" ADD VALUE 'VALIDATED';

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('AWAITING_SAMPLE', 'TO_ENTER', 'ENTERED', 'TECHNICAL_VALIDATED', 'VALIDATED');
CREATE TYPE "ResultFlag" AS ENUM ('CRITICAL_LOW', 'LOW', 'NORMAL', 'HIGH', 'CRITICAL_HIGH', 'ABNORMAL');
CREATE TYPE "ReportKind" AS ENUM ('PARTIAL', 'FINAL', 'AMENDED');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "analysis_status" "AnalysisStatus" NOT NULL DEFAULT 'AWAITING_SAMPLE',
ADD COLUMN "technical_validated_at" TIMESTAMPTZ(6),
ADD COLUMN "technical_validated_by_id" UUID,
ADD COLUMN "validated_at" TIMESTAMPTZ(6),
ADD COLUMN "validated_by_id" UUID,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "biologist_comment" VARCHAR(1000);

-- CreateTable
CREATE TABLE "test_results" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "parameter_code" VARCHAR(30) NOT NULL,
    "parameter_name" VARCHAR(150) NOT NULL,
    "unit" VARCHAR(30),
    "result_type" "ResultType" NOT NULL,
    "decimals" INTEGER,
    "choices" TEXT[],
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "numeric_value" DECIMAL(18,4),
    "qualifier" VARCHAR(1),
    "text_value" VARCHAR(500),
    "flag" "ResultFlag",
    "has_reference" BOOLEAN NOT NULL DEFAULT false,
    "ref_low" DECIMAL(14,4),
    "ref_high" DECIMAL(14,4),
    "ref_critical_low" DECIMAL(14,4),
    "ref_critical_high" DECIMAL(14,4),
    "ref_normal_text" VARCHAR(100),
    "ref_comment" VARCHAR(300),
    "ref_label" VARCHAR(100),
    "comment" VARCHAR(500),
    "entered_by_id" UUID,
    "entered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_alerts" (
    "id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "flag" "ResultFlag" NOT NULL,
    "value_text" VARCHAR(60) NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detected_by_id" UUID NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by_id" UUID,
    "notified_to" VARCHAR(200),
    "note" VARCHAR(500),
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "critical_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_amendments" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "from_version" INTEGER NOT NULL,
    "previous_results" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "amended_by_id" UUID NOT NULL,
    "amended_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "order_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "pdf" BYTEA NOT NULL,
    "order_item_ids" TEXT[],
    "exam_codes" TEXT[],
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_id" UUID NOT NULL,
    "supersedes_id" UUID,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_items_analysis_status_idx" ON "order_items"("analysis_status");
CREATE INDEX "test_results_parameter_id_idx" ON "test_results"("parameter_id");
CREATE UNIQUE INDEX "test_results_order_item_id_parameter_id_key" ON "test_results"("order_item_id", "parameter_id");
CREATE INDEX "critical_alerts_order_item_id_idx" ON "critical_alerts"("order_item_id");
CREATE INDEX "critical_alerts_acknowledged_at_idx" ON "critical_alerts"("acknowledged_at");
CREATE INDEX "result_amendments_order_item_id_idx" ON "result_amendments"("order_item_id");
CREATE UNIQUE INDEX "reports_number_key" ON "reports"("number");
CREATE UNIQUE INDEX "reports_supersedes_id_key" ON "reports"("supersedes_id");
CREATE UNIQUE INDEX "reports_order_id_version_key" ON "reports"("order_id", "version");

-- AddForeignKey
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "exam_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_alerts" ADD CONSTRAINT "critical_alerts_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "test_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "critical_alerts" ADD CONSTRAINT "critical_alerts_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_amendments" ADD CONSTRAINT "result_amendments_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "lab_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Contraintes hors Prisma
-- =====================================================================

ALTER TABLE "test_results" ADD CONSTRAINT "test_results_qualifier_valid" CHECK ("qualifier" IS NULL OR "qualifier" IN ('<', '>'));
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_value_by_type" CHECK (
    ("result_type" = 'NUMERIC' AND "text_value" IS NULL)
    OR ("result_type" <> 'NUMERIC' AND "numeric_value" IS NULL AND "qualifier" IS NULL)
);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_validation_consistent" CHECK (
    ("analysis_status" <> 'VALIDATED' OR ("validated_at" IS NOT NULL AND "validated_by_id" IS NOT NULL))
    AND ("analysis_status" NOT IN ('TECHNICAL_VALIDATED', 'VALIDATED') OR "technical_validated_at" IS NOT NULL)
);

-- Un compte rendu émis est définitif : ni modification, ni suppression (une correction donne un nouveau compte rendu).
CREATE OR REPLACE FUNCTION reports_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Un compte rendu émis ne peut être ni modifié ni supprimé (opération % interdite).', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER reports_immutable
    BEFORE UPDATE OR DELETE ON "reports"
    FOR EACH ROW EXECUTE FUNCTION reports_reject_mutation();
