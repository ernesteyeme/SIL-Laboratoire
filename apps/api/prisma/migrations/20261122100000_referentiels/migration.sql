-- =====================================================================
-- Étape 2 — Référentiels : patients, prescripteurs, catalogue
-- =====================================================================

-- Recherche approximative (trigrammes) pour les noms
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Numérotation des patients (PAT-000001)
CREATE SEQUENCE IF NOT EXISTS patient_code_seq START 1;

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RangeSex" AS ENUM ('ANY', 'MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('NUMERIC', 'TEXT', 'CHOICE');

-- AlterEnum : rien (AuditAction inchangé). Les nouvelles entités d'audit sont des chaînes.

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL DEFAULT ('PAT-'::text || lpad((nextval('patient_code_seq'::regclass))::text, 6, '0'::text)),
    "last_name" VARCHAR(80) NOT NULL,
    "middle_name" VARCHAR(80),
    "first_name" VARCHAR(80),
    "search_name" VARCHAR(300) NOT NULL,
    "sex" "Sex" NOT NULL,
    "birth_date" DATE,
    "birth_date_estimated" BOOLEAN NOT NULL DEFAULT false,
    "phone" VARCHAR(30),
    "phone_key" VARCHAR(9),
    "email" VARCHAR(254),
    "address" VARCHAR(300),
    "city" VARCHAR(100),
    "external_id" VARCHAR(50),
    "notes" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by_id" UUID,
    "deactivation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescribers" (
    "id" UUID NOT NULL,
    "title" VARCHAR(20),
    "last_name" VARCHAR(80) NOT NULL,
    "first_name" VARCHAR(80),
    "search_name" VARCHAR(300) NOT NULL,
    "specialty" VARCHAR(100),
    "facility" VARCHAR(150),
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "license_number" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prescribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_sections" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lab_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "container" VARCHAR(100),
    "instructions" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sample_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "short_name" VARCHAR(30),
    "section_id" UUID NOT NULL,
    "sample_type_id" UUID NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "turnaround_hours" INTEGER NOT NULL,
    "patient_instructions" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_parameters" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "result_type" "ResultType" NOT NULL,
    "unit" VARCHAR(30),
    "decimals" INTEGER,
    "choices" TEXT[],
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_ranges" (
    "id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "sex" "RangeSex" NOT NULL DEFAULT 'ANY',
    "age_min_days" INTEGER NOT NULL DEFAULT 0,
    "age_max_days" INTEGER,
    "low" DECIMAL(14,4),
    "high" DECIMAL(14,4),
    "critical_low" DECIMAL(14,4),
    "critical_high" DECIMAL(14,4),
    "normal_text" VARCHAR(100),
    "comment" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reference_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_code_key" ON "patients"("code");

-- CreateIndex
CREATE INDEX "patients_search_name_idx" ON "patients" USING GIN ("search_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "patients_phone_key_idx" ON "patients"("phone_key");

-- CreateIndex
CREATE INDEX "patients_external_id_idx" ON "patients"("external_id");

-- CreateIndex
CREATE INDEX "patients_created_at_idx" ON "patients"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prescribers_license_number_key" ON "prescribers"("license_number");

-- CreateIndex
CREATE INDEX "prescribers_search_name_idx" ON "prescribers" USING GIN ("search_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "lab_sections_code_key" ON "lab_sections"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sample_types_code_key" ON "sample_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "exams_code_key" ON "exams"("code");

-- CreateIndex
CREATE INDEX "exams_section_id_idx" ON "exams"("section_id");

-- CreateIndex
CREATE INDEX "exams_sample_type_id_idx" ON "exams"("sample_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_parameters_exam_id_code_key" ON "exam_parameters"("exam_id", "code");

-- CreateIndex
CREATE INDEX "reference_ranges_parameter_id_idx" ON "reference_ranges"("parameter_id");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "lab_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_sample_type_id_fkey" FOREIGN KEY ("sample_type_id") REFERENCES "sample_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_parameters" ADD CONSTRAINT "exam_parameters_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_ranges" ADD CONSTRAINT "reference_ranges_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "exam_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Contraintes de cohérence hors Prisma (filet de sécurité sous la validation applicative)
-- =====================================================================

ALTER TABLE "exams" ADD CONSTRAINT "exams_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "exams" ADD CONSTRAINT "exams_turnaround_positive" CHECK ("turnaround_hours" > 0);

ALTER TABLE "exam_parameters" ADD CONSTRAINT "exam_parameters_decimals_range"
    CHECK ("decimals" IS NULL OR ("decimals" BETWEEN 0 AND 6));

ALTER TABLE "reference_ranges" ADD CONSTRAINT "reference_ranges_age_order"
    CHECK ("age_min_days" >= 0 AND ("age_max_days" IS NULL OR "age_max_days" > "age_min_days"));
ALTER TABLE "reference_ranges" ADD CONSTRAINT "reference_ranges_bounds_order"
    CHECK ("low" IS NULL OR "high" IS NULL OR "low" <= "high");
