-- =====================================================================
-- Caisse bi-devise CDF / USD
-- =====================================================================

-- AlterTable
ALTER TABLE "lab_settings" ADD COLUMN "secondary_currency_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable : paiements (reprise des paiements existants : remis = imputé, en devise de base)
ALTER TABLE "payments" ADD COLUMN "currency" VARCHAR(3);
ALTER TABLE "payments" ADD COLUMN "tendered_amount" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN "exchange_rate" DECIMAL(14,4);
ALTER TABLE "payments" ADD COLUMN "change_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
UPDATE "payments" SET
    "currency" = COALESCE((SELECT "currency" FROM "lab_settings" WHERE "id" = 1), 'CDF'),
    "tendered_amount" = "amount";
ALTER TABLE "payments" ALTER COLUMN "currency" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "tendered_amount" SET NOT NULL;

-- AlterTable : sessions de caisse
ALTER TABLE "cash_sessions" ADD COLUMN "base_currency" VARCHAR(3) NOT NULL DEFAULT 'CDF';
ALTER TABLE "cash_sessions" ADD COLUMN "secondary_currency" VARCHAR(3);
ALTER TABLE "cash_sessions" ADD COLUMN "opening_float_secondary" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "cash_sessions" ADD COLUMN "expected_cash_secondary" DECIMAL(12,2);
ALTER TABLE "cash_sessions" ADD COLUMN "counted_cash_secondary" DECIMAL(12,2);
ALTER TABLE "cash_sessions" ADD COLUMN "difference_secondary" DECIMAL(12,2);
UPDATE "cash_sessions" SET "base_currency" = COALESCE((SELECT "currency" FROM "lab_settings" WHERE "id" = 1), 'CDF');

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "effective_date" DATE NOT NULL,
    "cdf_per_usd" DECIMAL(14,4) NOT NULL,
    "note" VARCHAR(300),
    "set_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_effective_date_key" ON "exchange_rates"("effective_date");

-- Contraintes
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_positive" CHECK ("cdf_per_usd" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_tendered_consistent" CHECK (
    "tendered_amount" > 0
    AND "change_amount" >= 0
    AND ("exchange_rate" IS NULL OR "exchange_rate" > 0)
    AND ("method" = 'CASH' OR "change_amount" = 0)
);
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_float_secondary_non_negative" CHECK ("opening_float_secondary" >= 0);
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_secondary_complete" CHECK (
    "status" = 'OPEN' OR "secondary_currency" IS NULL
    OR ("expected_cash_secondary" IS NOT NULL AND "counted_cash_secondary" IS NOT NULL AND "difference_secondary" IS NOT NULL)
);
