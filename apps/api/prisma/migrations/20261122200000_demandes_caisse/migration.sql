-- =====================================================================
-- Étape 3 — Demandes, échantillons, facturation, caisse
-- =====================================================================

-- CreateEnum
CREATE TYPE "OrderPriority" AS ENUM ('ROUTINE', 'URGENT');
CREATE TYPE "OrderStatus" AS ENUM ('REGISTERED', 'PARTIALLY_COLLECTED', 'COLLECTED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "SampleStatus" AS ENUM ('PENDING_COLLECTION', 'COLLECTED', 'RECEIVED', 'REJECTED');
CREATE TYPE "NonConformityType" AS ENUM ('HEMOLYZED', 'CLOTTED', 'INSUFFICIENT_VOLUME', 'WRONG_CONTAINER', 'IDENTIFICATION_ERROR', 'TRANSPORT_DELAY', 'TEMPERATURE', 'LEAKED', 'CONTAMINATED', 'OTHER');
CREATE TYPE "NonConformityDecision" AS ENUM ('REJECTED', 'ACCEPTED_WITH_RESERVATION');
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER');
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "lab_settings" ADD COLUMN "require_payment_before_collection" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "counters" (
    "key" VARCHAR(20) NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key","period")
);

-- CreateTable
CREATE TABLE "lab_orders" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "patient_id" UUID NOT NULL,
    "prescriber_id" UUID,
    "priority" "OrderPriority" NOT NULL DEFAULT 'ROUTINE',
    "status" "OrderStatus" NOT NULL DEFAULT 'REGISTERED',
    "clinical_info" VARCHAR(1000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancellation_reason" VARCHAR(500),

    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "exam_code" VARCHAR(20) NOT NULL,
    "exam_name" VARCHAR(150) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "sample_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "samples" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "order_id" UUID NOT NULL,
    "sample_type_id" UUID NOT NULL,
    "status" "SampleStatus" NOT NULL DEFAULT 'PENDING_COLLECTION',
    "collected_at" TIMESTAMPTZ(6),
    "collected_by_id" UUID,
    "received_at" TIMESTAMPTZ(6),
    "received_by_id" UUID,
    "has_reservation" BOOLEAN NOT NULL DEFAULT false,
    "rejected_at" TIMESTAMPTZ(6),
    "replaces_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_conformities" (
    "id" UUID NOT NULL,
    "sample_id" UUID NOT NULL,
    "type" "NonConformityType" NOT NULL,
    "decision" "NonConformityDecision" NOT NULL,
    "comment" VARCHAR(500),
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_conformities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "order_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_reason" VARCHAR(500),
    "payer_name" VARCHAR(150),
    "coverage_percent" INTEGER NOT NULL DEFAULT 0,
    "third_party_amount" DECIMAL(12,2) NOT NULL,
    "patient_amount" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancellation_reason" VARCHAR(500),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "order_item_id" UUID,
    "label" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "invoice_id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(100),
    "received_by_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancellation_reason" VARCHAR(500),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "cashier_id" UUID NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float" DECIMAL(12,2) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "expected_cash" DECIMAL(12,2),
    "counted_cash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "closing_note" VARCHAR(500),
    "summary" JSONB,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_number_key" ON "lab_orders"("number");
CREATE INDEX "lab_orders_patient_id_idx" ON "lab_orders"("patient_id");
CREATE INDEX "lab_orders_status_idx" ON "lab_orders"("status");
CREATE INDEX "lab_orders_created_at_idx" ON "lab_orders"("created_at");
CREATE INDEX "order_items_sample_id_idx" ON "order_items"("sample_id");
CREATE UNIQUE INDEX "order_items_order_id_exam_id_key" ON "order_items"("order_id", "exam_id");
CREATE UNIQUE INDEX "samples_number_key" ON "samples"("number");
CREATE UNIQUE INDEX "samples_replaces_id_key" ON "samples"("replaces_id");
CREATE INDEX "samples_order_id_idx" ON "samples"("order_id");
CREATE INDEX "samples_status_idx" ON "samples"("status");
CREATE INDEX "non_conformities_sample_id_idx" ON "non_conformities"("sample_id");
CREATE INDEX "non_conformities_recorded_at_idx" ON "non_conformities"("recorded_at");
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE UNIQUE INDEX "invoices_order_id_key" ON "invoices"("order_id");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
CREATE INDEX "invoices_patient_id_idx" ON "invoices"("patient_id");
CREATE INDEX "invoices_created_at_idx" ON "invoices"("created_at");
CREATE UNIQUE INDEX "invoice_lines_order_item_id_key" ON "invoice_lines"("order_item_id");
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");
CREATE UNIQUE INDEX "payments_number_key" ON "payments"("number");
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");
CREATE INDEX "payments_cash_session_id_idx" ON "payments"("cash_session_id");
CREATE INDEX "payments_received_at_idx" ON "payments"("received_at");
CREATE UNIQUE INDEX "cash_sessions_number_key" ON "cash_sessions"("number");
CREATE INDEX "cash_sessions_cashier_id_status_idx" ON "cash_sessions"("cashier_id", "status");
CREATE INDEX "cash_sessions_opened_at_idx" ON "cash_sessions"("opened_at");

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_prescriber_id_fkey" FOREIGN KEY ("prescriber_id") REFERENCES "prescribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "lab_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "samples"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "samples" ADD CONSTRAINT "samples_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "lab_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "samples" ADD CONSTRAINT "samples_sample_type_id_fkey" FOREIGN KEY ("sample_type_id") REFERENCES "sample_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "samples" ADD CONSTRAINT "samples_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "samples"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "non_conformities" ADD CONSTRAINT "non_conformities_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "samples"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "lab_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Contraintes hors Prisma : intégrité financière et règles de caisse
-- =====================================================================

-- Un caissier ne peut avoir qu'une seule session de caisse ouverte
CREATE UNIQUE INDEX "cash_sessions_one_open_per_cashier" ON "cash_sessions"("cashier_id") WHERE "status" = 'OPEN';

ALTER TABLE "counters" ADD CONSTRAINT "counters_value_positive" CHECK ("value" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_non_negative" CHECK ("unit_price" >= 0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_float_non_negative" CHECK ("opening_float" >= 0);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_consistent" CHECK (
    "total_amount" >= 0
    AND "discount_amount" >= 0
    AND "discount_amount" <= "total_amount"
    AND "coverage_percent" BETWEEN 0 AND 100
    AND "third_party_amount" >= 0
    AND "patient_amount" >= 0
    AND "third_party_amount" + "patient_amount" = "total_amount" - "discount_amount"
    AND "paid_amount" >= 0
    AND "paid_amount" <= "patient_amount"
);

-- Une session clôturée a obligatoirement ses montants de clôture
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_complete" CHECK (
    "status" = 'OPEN'
    OR ("closed_at" IS NOT NULL AND "expected_cash" IS NOT NULL AND "counted_cash" IS NOT NULL AND "difference" IS NOT NULL)
);
