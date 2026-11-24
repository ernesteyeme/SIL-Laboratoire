-- Étape 7 — Interopérabilité : DHIS2 (agrégats mensuels), VLSM/InteLIS (résultats CV/EID), OpenHIM.

CREATE TYPE "InteropSystem" AS ENUM ('DHIS2', 'VLSM');
CREATE TYPE "InteropTransport" AS ENUM ('DIRECT', 'OPENHIM');
CREATE TYPE "InteropAuthMode" AS ENUM ('BASIC', 'TOKEN');
CREATE TYPE "Dhis2Measure" AS ENUM ('VALIDATED_COUNT', 'NUMERIC_BELOW', 'NUMERIC_AT_OR_ABOVE', 'TEXT_EQUALS');
CREATE TYPE "VlsmTestType" AS ENUM ('VL', 'EID');
CREATE TYPE "InteropRunKind" AS ENUM ('CONNECTION_TEST', 'DHIS2_DRY_RUN', 'DHIS2_SEND', 'VLSM_SEND');
CREATE TYPE "InteropRunStatus" AS ENUM ('SUCCESS', 'WARNING', 'ERROR');
CREATE TYPE "VlsmSubmissionStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "interop_endpoints" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "system" "InteropSystem" NOT NULL,
    "transport" "InteropTransport" NOT NULL,
    "base_url" VARCHAR(500) NOT NULL,
    "auth_mode" "InteropAuthMode" NOT NULL,
    "username" VARCHAR(120),
    "secret_cipher" TEXT,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL,
    "last_test_at" TIMESTAMPTZ(6),
    "last_test_ok" BOOLEAN,
    "last_test_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "interop_endpoints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interop_endpoints_url_scheme" CHECK ("base_url" ~* '^https?://'),
    CONSTRAINT "interop_endpoints_timeout" CHECK ("timeout_seconds" BETWEEN 5 AND 300),
    -- Via OpenHIM, l'appelant s'authentifie comme client OpenHIM (identifiant + mot de passe).
    CONSTRAINT "interop_endpoints_openhim_basic" CHECK ("transport" <> 'OPENHIM' OR "auth_mode" = 'BASIC'),
    CONSTRAINT "interop_endpoints_secret_format" CHECK ("secret_cipher" IS NULL OR "secret_cipher" LIKE 'v1:%')
);
CREATE UNIQUE INDEX "interop_endpoints_code_key" ON "interop_endpoints"("code");

CREATE TABLE "dhis2_mappings" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "parameter_id" UUID NOT NULL,
    "measure" "Dhis2Measure" NOT NULL,
    "threshold" DECIMAL(18,4),
    "text_match" VARCHAR(100),
    "sex" "RangeSex" NOT NULL DEFAULT 'ANY',
    "age_min_years" INTEGER,
    "age_max_years" INTEGER,
    "data_element" VARCHAR(11) NOT NULL,
    "category_option_combo" VARCHAR(11),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "dhis2_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dhis2_mappings_uid" CHECK ("data_element" ~ '^[A-Za-z][A-Za-z0-9]{10}$' AND ("category_option_combo" IS NULL OR "category_option_combo" ~ '^[A-Za-z][A-Za-z0-9]{10}$')),
    CONSTRAINT "dhis2_mappings_threshold" CHECK ("measure" NOT IN ('NUMERIC_BELOW', 'NUMERIC_AT_OR_ABOVE') OR ("threshold" IS NOT NULL AND "threshold" > 0)),
    CONSTRAINT "dhis2_mappings_text" CHECK ("measure" <> 'TEXT_EQUALS' OR "text_match" IS NOT NULL),
    CONSTRAINT "dhis2_mappings_ages" CHECK ("age_min_years" IS NULL OR "age_max_years" IS NULL OR "age_max_years" > "age_min_years")
);
CREATE INDEX "dhis2_mappings_endpoint_id_idx" ON "dhis2_mappings"("endpoint_id");
-- Une même cellule DHIS2 (élément × combinaison) n'est alimentée que par une seule règle.
CREATE UNIQUE INDEX "dhis2_mappings_cell_key" ON "dhis2_mappings"("endpoint_id", "data_element", COALESCE("category_option_combo", ''));

CREATE TABLE "vlsm_mappings" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "test_type" "VlsmTestType" NOT NULL,
    "eid_positive" VARCHAR(100),
    "eid_negative" VARCHAR(100),
    "eid_indeterminate" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "vlsm_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vlsm_mappings_eid" CHECK ("test_type" <> 'EID' OR ("eid_positive" IS NOT NULL AND "eid_negative" IS NOT NULL))
);
CREATE UNIQUE INDEX "vlsm_mappings_endpoint_id_parameter_id_key" ON "vlsm_mappings"("endpoint_id", "parameter_id");

CREATE TABLE "interop_runs" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "kind" "InteropRunKind" NOT NULL,
    "status" "InteropRunStatus" NOT NULL,
    "period" VARCHAR(6),
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "payload_sha256" VARCHAR(64),
    "http_status" INTEGER,
    "openhim_transaction_id" VARCHAR(100),
    "imported" INTEGER,
    "updated" INTEGER,
    "ignored" INTEGER,
    "deleted" INTEGER,
    "conflicts" JSONB,
    "message" VARCHAR(1000),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "triggered_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interop_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interop_runs_period" CHECK ("period" IS NULL OR "period" ~ '^\d{4}(0[1-9]|1[0-2])$')
);
CREATE INDEX "interop_runs_endpoint_id_created_at_idx" ON "interop_runs"("endpoint_id", "created_at");
CREATE INDEX "interop_runs_kind_period_idx" ON "interop_runs"("kind", "period");

CREATE TABLE "vlsm_submissions" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "item_version" INTEGER NOT NULL,
    "status" "VlsmSubmissionStatus" NOT NULL,
    "unique_id" VARCHAR(64) NOT NULL,
    "remote_sample_code" VARCHAR(100),
    "message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vlsm_submissions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vlsm_submissions_endpoint_id_order_item_id_idx" ON "vlsm_submissions"("endpoint_id", "order_item_id");
CREATE INDEX "vlsm_submissions_run_id_idx" ON "vlsm_submissions"("run_id");
-- Un résultat n'est accepté par VLSM qu'une fois par version de l'examen (une correction crée une nouvelle version).
CREATE UNIQUE INDEX "vlsm_submissions_sent_once" ON "vlsm_submissions"("endpoint_id", "order_item_id", "item_version") WHERE "status" = 'SENT';

ALTER TABLE "dhis2_mappings" ADD CONSTRAINT "dhis2_mappings_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "interop_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dhis2_mappings" ADD CONSTRAINT "dhis2_mappings_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "exam_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vlsm_mappings" ADD CONSTRAINT "vlsm_mappings_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "interop_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vlsm_mappings" ADD CONSTRAINT "vlsm_mappings_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "exam_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interop_runs" ADD CONSTRAINT "interop_runs_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "interop_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vlsm_submissions" ADD CONSTRAINT "vlsm_submissions_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "interop_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vlsm_submissions" ADD CONSTRAINT "vlsm_submissions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "interop_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vlsm_submissions" ADD CONSTRAINT "vlsm_submissions_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Le journal des échanges et des envois VLSM est une pièce de traçabilité : ni modification ni suppression.
CREATE OR REPLACE FUNCTION interop_append_only_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d’interopérabilité (%) est en ajout seul.', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER interop_runs_append_only BEFORE UPDATE OR DELETE ON "interop_runs"
  FOR EACH ROW EXECUTE FUNCTION interop_append_only_guard();
CREATE TRIGGER vlsm_submissions_append_only BEFORE UPDATE OR DELETE ON "vlsm_submissions"
  FOR EACH ROW EXECUTE FUNCTION interop_append_only_guard();
