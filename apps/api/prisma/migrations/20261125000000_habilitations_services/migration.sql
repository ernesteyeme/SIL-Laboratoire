-- Version 1.8.0 — Habilitations par service (ISO 15189 §6.2) : un technicien ou un biologiste ne saisit et
-- ne valide que les examens des services (sections) où il est habilité.

CREATE TABLE "user_sections" (
    "user_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_id" UUID,
    CONSTRAINT "user_sections_pkey" PRIMARY KEY ("user_id", "section_id")
);
CREATE INDEX "user_sections_section_id_idx" ON "user_sections"("section_id");
ALTER TABLE "user_sections" ADD CONSTRAINT "user_sections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sections" ADD CONSTRAINT "user_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "lab_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_sections" ADD CONSTRAINT "user_sections_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise de l'existant : les techniciens et biologistes déjà en place gardent l'accès à tous les services,
-- pour qu'aucun travail ne s'arrête à la mise à jour. L'administrateur restreint ensuite chaque compte.
INSERT INTO "user_sections" ("user_id", "section_id")
SELECT u."id", s."id"
FROM "users" u CROSS JOIN "lab_sections" s
WHERE u."is_service_account" = false
  AND (u."roles" @> ARRAY['TECHNICIEN']::"Role"[] OR u."roles" @> ARRAY['BIOLOGISTE']::"Role"[]);

-- Trace dans la piste d'audit chaînée (le trigger calcule l'empreinte de chaque entrée).
INSERT INTO "audit_log" ("actor_username", "actor_roles", "action", "entity", "entity_id", "after", "reason")
SELECT 'system', ARRAY[]::"Role"[], 'UPDATE', 'User', u."id"::text,
       jsonb_build_object('sections', COALESCE((SELECT jsonb_agg(s."code" ORDER BY s."display_order", s."code")
                                                FROM "user_sections" us JOIN "lab_sections" s ON s."id" = us."section_id"
                                                WHERE us."user_id" = u."id"), '[]'::jsonb)),
       'Habilitations par service (version 1.8.0) : attribution initiale de tous les services, à restreindre par l''administrateur'
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "user_sections" us WHERE us."user_id" = u."id");
