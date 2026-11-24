-- =====================================================================
-- Étape 1 — Socle : utilisateurs, sessions, piste d'audit, paramètres
-- =====================================================================

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RECEPTION', 'CAISSE', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE', 'COMPTABLE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'ACCESS_DENIED', 'TOKEN_REUSE_DETECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "email" VARCHAR(254),
    "full_name" VARCHAR(120) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "roles" "Role"[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID,
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by_id" UUID,
    "deactivation_reason" VARCHAR(500),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(32),
    "replaced_by_id" UUID,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_username" VARCHAR(50),
    "actor_roles" "Role"[],
    "action" "AuditAction" NOT NULL,
    "entity" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" VARCHAR(500),
    "request_id" VARCHAR(64),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "prev_hash" VARCHAR(64),
    "hash" VARCHAR(64) NOT NULL DEFAULT '',

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(200) NOT NULL,
    "short_name" VARCHAR(50),
    "address" VARCHAR(300),
    "city" VARCHAR(100),
    "country" VARCHAR(100),
    "phone" VARCHAR(50),
    "email" VARCHAR(254),
    "accreditation_number" VARCHAR(100),
    "accreditation_body" VARCHAR(200),
    "director_name" VARCHAR(200),
    "report_footer" VARCHAR(2000),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CDF',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Kinshasa',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "lab_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_seq_key" ON "audit_log"("seq");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Contraintes et triggers hors Prisma
-- =====================================================================

-- Une seule ligne de paramètres
ALTER TABLE "lab_settings" ADD CONSTRAINT "lab_settings_singleton" CHECK ("id" = 1);

-- Un utilisateur a toujours au moins un rôle
ALTER TABLE "users" ADD CONSTRAINT "users_roles_not_empty" CHECK (cardinality("roles") >= 1);

-- ---------------------------------------------------------------------
-- Piste d'audit : chaînage par hash SHA-256 (détection d'altération)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_compute_hash(
    p_seq BIGINT,
    p_prev_hash TEXT,
    p_occurred_at TIMESTAMPTZ,
    p_actor_id UUID,
    p_action TEXT,
    p_entity TEXT,
    p_entity_id TEXT,
    p_before JSONB,
    p_after JSONB,
    p_reason TEXT
) RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT encode(
        sha256(
            convert_to(
                concat_ws(
                    '|',
                    p_seq::text,
                    coalesce(p_prev_hash, ''),
                    to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                    coalesce(p_actor_id::text, ''),
                    p_action,
                    p_entity,
                    p_entity_id,
                    coalesce(p_before::text, ''),
                    coalesce(p_after::text, ''),
                    coalesce(p_reason, '')
                ),
                'UTF8'
            )
        ),
        'hex'
    );
$$;

CREATE OR REPLACE FUNCTION audit_log_before_insert() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_last_seq  BIGINT;
    v_last_hash TEXT;
BEGIN
    -- Sérialise les insertions pour garantir une chaîne linéaire.
    -- Verrou libéré automatiquement à la fin de la transaction.
    PERFORM pg_advisory_xact_lock(7815150001);

    SELECT "seq", "hash" INTO v_last_seq, v_last_hash
    FROM "audit_log"
    ORDER BY "seq" DESC
    LIMIT 1;

    NEW."seq"         := coalesce(v_last_seq, 0) + 1;
    NEW."prev_hash"   := v_last_hash;
    NEW."occurred_at" := date_trunc('microseconds', clock_timestamp());
    NEW."hash"        := audit_log_compute_hash(
        NEW."seq", NEW."prev_hash", NEW."occurred_at", NEW."actor_id",
        NEW."action"::text, NEW."entity", NEW."entity_id",
        NEW."before", NEW."after", NEW."reason"
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER audit_log_chain
    BEFORE INSERT ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION audit_log_before_insert();

-- ---------------------------------------------------------------------
-- Piste d'audit : ajout seul (UPDATE / DELETE / TRUNCATE interdits)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'La piste d''audit est en ajout seul : opération % interdite.', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON "audit_log"
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();
