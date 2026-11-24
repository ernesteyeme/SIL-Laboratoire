# shellcheck shell=bash
# Migrations SQL du schéma (apps/api/prisma/migrations), appliquées avec psql.
# Le journal est la table _prisma_migrations, au format de Prisma (même somme SHA-256 du fichier) :
# un serveur installé ainsi reste compatible avec « prisma migrate deploy » et « prisma migrate status ».
# Pas de dépendance réseau : rien n'est téléchargé au moment du déploiement.
# Requiert common.sh et db-roles.sh.

MIGRATIONS_JOURNAL_DDL='CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);'

migrations_dir() {
    printf '%s/apps/api/prisma/migrations' "${1:-${LIMS_HOME}/current}"
}

migrations_available() {
    local dir; dir="$(migrations_dir "${1:-}")"
    find "${dir}" -mindepth 2 -maxdepth 2 -name migration.sql -printf '%h\n' 2>/dev/null | xargs -r -n1 basename | sort
}

migrations_journal_exists() {
    [ "$(psql_admin "${LIMS_DB}" -tAc "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" = "t" ]
}

# Lignes « nom|somme|état » du journal (état : ok, failed, rolledback).
migrations_journal() {
    migrations_journal_exists || return 0
    psql_admin "${LIMS_DB}" -tA -F '|' -c "SELECT migration_name, checksum,
        CASE WHEN rolled_back_at IS NOT NULL THEN 'rolledback' WHEN finished_at IS NULL THEN 'failed' ELSE 'ok' END
        FROM _prisma_migrations ORDER BY migration_name, started_at"
}

# Résumé : « appliquées en_attente modifiées en_échec » (nombres) ; détail dans MIGRATIONS_* .
migrations_status() {
    local code_dir="${1:-}" dir name sum state journal
    dir="$(migrations_dir "${code_dir}")"
    MIGRATIONS_PENDING=(); MIGRATIONS_CHANGED=(); MIGRATIONS_FAILED=(); MIGRATIONS_APPLIED=()
    journal="$(migrations_journal)"
    while IFS='|' read -r name sum state; do
        [ -n "${name}" ] || continue
        if [ "${state}" = "failed" ]; then MIGRATIONS_FAILED+=("${name}"); fi
    done <<< "${journal}"
    while read -r name; do
        [ -n "${name}" ] || continue
        sum="$(sha256sum "${dir}/${name}/migration.sql" | awk '{print $1}')"
        state="$(awk -F'|' -v n="${name}" '$1 == n && $3 == "ok" {print $2}' <<< "${journal}" | tail -n 1)"
        if [ -z "${state}" ]; then
            MIGRATIONS_PENDING+=("${name}")
        elif [ "${state}" != "${sum}" ]; then
            MIGRATIONS_CHANGED+=("${name}")
            MIGRATIONS_APPLIED+=("${name}")
        else
            MIGRATIONS_APPLIED+=("${name}")
        fi
    done < <(migrations_available "${code_dir}")
    printf '%s %s %s %s\n' "${#MIGRATIONS_APPLIED[@]}" "${#MIGRATIONS_PENDING[@]}" "${#MIGRATIONS_CHANGED[@]}" "${#MIGRATIONS_FAILED[@]}"
}

# Applique les migrations en attente ; chacune dans sa propre transaction, avec son inscription au journal.
# Options : --baseline (base existante sans journal : marquer les migrations présentes comme appliquées).
migrations_apply() {
    local code_dir="${1:-${LIMS_HOME}/current}" baseline="${2:-}" dir name sum id tables applied=0
    dir="$(migrations_dir "${code_dir}")"
    [ -d "${dir}" ] || { error "Dossier des migrations introuvable : ${dir}"; return 1; }

    if ! migrations_journal_exists; then
        tables="$(db_table_count)"
        if [ "${tables}" -gt 0 ] && [ "${baseline}" != "--baseline" ]; then
            error "La base ${LIMS_DB} contient ${tables} table(s) mais aucun journal de migrations."
            error "Si elle a été créée avec ce code, relancez avec : lims migrate --baseline"
            return 1
        fi
        psql_owner -c "${MIGRATIONS_JOURNAL_DDL}" >/dev/null
        if [ "${tables}" -gt 0 ]; then
            while read -r name; do
                sum="$(sha256sum "${dir}/${name}/migration.sql" | awk '{print $1}')"
                id="$(cat /proc/sys/kernel/random/uuid)"
                psql_owner -c "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count, logs) VALUES ('${id}', '${sum}', now(), '${name}', now(), 1, 'baseline lims')" >/dev/null
                info "Migration marquée comme déjà appliquée : ${name}"
            done < <(migrations_available "${code_dir}")
            db_apply_grants
            return 0
        fi
    fi

    migrations_status "${code_dir}" >/dev/null
    if [ "${#MIGRATIONS_FAILED[@]}" -gt 0 ]; then
        error "Migration en échec dans le journal : ${MIGRATIONS_FAILED[*]}. Restaurez la sauvegarde prise avant la mise à jour (lims restore)."
        return 1
    fi
    if [ "${#MIGRATIONS_CHANGED[@]}" -gt 0 ]; then
        error "Migration(s) déjà appliquée(s) mais modifiée(s) depuis : ${MIGRATIONS_CHANGED[*]}. Le code ne correspond pas à cette base."
        return 1
    fi
    for name in "${MIGRATIONS_PENDING[@]}"; do
        sum="$(sha256sum "${dir}/${name}/migration.sql" | awk '{print $1}')"
        id="$(cat /proc/sys/kernel/random/uuid)"
        info "Migration ${name}…"
        if ! psql_admin "${LIMS_DB}" --single-transaction \
            -c "SET ROLE ${LIMS_DB_OWNER}" \
            -c "SELECT pg_advisory_xact_lock(727070)" \
            -f "${dir}/${name}/migration.sql" \
            -c "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ('${id}', '${sum}', now(), '${name}', now(), 1)" >/dev/null; then
            error "La migration ${name} a échoué : elle a été annulée en entier (transaction)."
            return 1
        fi
        applied=$((applied + 1))
        log_action "Migration appliquée : ${name}"
    done
    db_apply_grants
    if [ "${applied}" -eq 0 ]; then
        success "Schéma à jour (${#MIGRATIONS_APPLIED[@]} migration(s))."
    else
        success "${applied} migration(s) appliquée(s)."
    fi
}
