-- =====================================================================
-- Étape 6 — Interfaçage des automates
-- =====================================================================

-- CreateEnum
CREATE TYPE "InstrumentProtocol" AS ENUM ('ASTM', 'HL7', 'CSV');
CREATE TYPE "InstrumentMessageStatus" AS ENUM ('PROCESSED', 'PARTIAL', 'FAILED');
CREATE TYPE "InstrumentMessageSource" AS ENUM ('GATEWAY', 'UPLOAD');
CREATE TYPE "InstrumentResultKind" AS ENUM ('PATIENT', 'QC');
CREATE TYPE "InstrumentResultStatus" AS ENUM ('APPLIED', 'QC_APPLIED', 'CONFLICT', 'UNMATCHED', 'LOCKED', 'NOT_PERFORMED', 'DISMISSED');
CREATE TYPE "ResultSource" AS ENUM ('MANUAL', 'INSTRUMENT');

-- AlterTable : comptes de service et origine des résultats
ALTER TABLE "users" ADD COLUMN "is_service_account" BOOLEAN NOT NULL DEFAULT false;
-- Une personne a au moins un rôle ; un compte de service n'en a jamais.
ALTER TABLE "users" DROP CONSTRAINT "users_roles_not_empty";
ALTER TABLE "users" ADD CONSTRAINT "users_roles_not_empty" CHECK ("is_service_account" OR cardinality("roles") > 0);
ALTER TABLE "users" ADD CONSTRAINT "users_service_account_no_role" CHECK (NOT "is_service_account" OR cardinality("roles") = 0);

ALTER TABLE "test_results" ADD COLUMN "source" "ResultSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "instrument_id" UUID;
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_source_instrument" CHECK (("source" = 'INSTRUMENT') = ("instrument_id" IS NOT NULL));

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "manufacturer" VARCHAR(120),
    "model" VARCHAR(120),
    "section_id" UUID,
    "protocol" "InstrumentProtocol" NOT NULL,
    "csv_config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "service_user_id" UUID NOT NULL,
    "api_key_hash" VARCHAR(64),
    "api_key_prefix" VARCHAR(48),
    "api_key_rotated_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "instruments_csv_config" CHECK ("protocol" <> 'CSV' OR "csv_config" IS NOT NULL)
);

CREATE TABLE "instrument_test_mappings" (
    "id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "instrument_code" VARCHAR(40) NOT NULL,
    "parameter_id" UUID NOT NULL,
    "factor" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "value_map" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "instrument_test_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "instrument_test_mappings_factor_positive" CHECK ("factor" > 0)
);

CREATE TABLE "instrument_qc_materials" (
    "id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "specimen_id" VARCHAR(60) NOT NULL,
    "material_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instrument_qc_materials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "instrument_messages" (
    "id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "protocol" "InstrumentProtocol" NOT NULL,
    "source" "InstrumentMessageSource" NOT NULL,
    "filename" VARCHAR(200),
    "raw" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by_id" UUID NOT NULL,
    "status" "InstrumentMessageStatus" NOT NULL,
    "error" VARCHAR(1000),
    "warnings" TEXT[],
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "applied_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "instrument_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "instrument_results" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "kind" "InstrumentResultKind" NOT NULL,
    "specimen_id" VARCHAR(60) NOT NULL,
    "instrument_test_code" VARCHAR(40) NOT NULL,
    "raw_value" VARCHAR(100) NOT NULL,
    "unit" VARCHAR(30),
    "flags" VARCHAR(20),
    "measured_at" TIMESTAMPTZ(6),
    "status" "InstrumentResultStatus" NOT NULL,
    "reason" VARCHAR(300),
    "parameter_id" UUID,
    "test_result_id" UUID,
    "qc_run_id" UUID,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instrument_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instruments_code_key" ON "instruments"("code");
CREATE UNIQUE INDEX "instruments_service_user_id_key" ON "instruments"("service_user_id");
CREATE UNIQUE INDEX "instruments_api_key_hash_key" ON "instruments"("api_key_hash");
CREATE UNIQUE INDEX "instrument_test_mappings_instrument_id_instrument_code_key" ON "instrument_test_mappings"("instrument_id", "instrument_code");
CREATE UNIQUE INDEX "instrument_qc_materials_instrument_id_specimen_id_key" ON "instrument_qc_materials"("instrument_id", "specimen_id");
CREATE UNIQUE INDEX "instrument_messages_instrument_id_sha256_key" ON "instrument_messages"("instrument_id", "sha256");
CREATE INDEX "instrument_messages_received_at_idx" ON "instrument_messages"("received_at");
CREATE INDEX "instrument_results_message_id_idx" ON "instrument_results"("message_id");
CREATE INDEX "instrument_results_status_idx" ON "instrument_results"("status");
CREATE INDEX "instrument_results_specimen_id_idx" ON "instrument_results"("specimen_id");

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "lab_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_service_user_id_fkey" FOREIGN KEY ("service_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instrument_test_mappings" ADD CONSTRAINT "instrument_test_mappings_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instrument_test_mappings" ADD CONSTRAINT "instrument_test_mappings_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "exam_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instrument_qc_materials" ADD CONSTRAINT "instrument_qc_materials_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instrument_qc_materials" ADD CONSTRAINT "instrument_qc_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "qc_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instrument_messages" ADD CONSTRAINT "instrument_messages_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instrument_results" ADD CONSTRAINT "instrument_results_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "instrument_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instrument_results" ADD CONSTRAINT "instrument_results_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Le message brut est une pièce de traçabilité : son contenu ne peut plus être modifié ni supprimé
-- (seuls le statut et les compteurs évoluent lors d'un retraitement).
CREATE OR REPLACE FUNCTION instrument_messages_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Les messages d’automate ne peuvent pas être supprimés.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.raw IS DISTINCT FROM OLD.raw OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.instrument_id IS DISTINCT FROM OLD.instrument_id OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'Le contenu d’un message d’automate est immuable.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER instrument_messages_immutable BEFORE UPDATE OR DELETE ON "instrument_messages"
  FOR EACH ROW EXECUTE FUNCTION instrument_messages_guard();
