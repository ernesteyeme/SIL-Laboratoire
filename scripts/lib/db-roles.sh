# shellcheck shell=bash
# Rôles et base PostgreSQL du LIMS (idempotent).
#   - lims_owner : propriétaire du schéma, sans connexion. Les migrations s'exécutent sous ce rôle.
#   - lims_app   : rôle de l'application. Lecture/écriture des données uniquement : il ne peut ni
#                  modifier le schéma ni désactiver les triggers d'audit (ISO 15189 §7.11, §8.4).
# Requiert common.sh.

# db_ensure_roles MOT_DE_PASSE_APP
db_ensure_roles() {
    local app_password="$1"
    psql_admin postgres \
        -v owner="${LIMS_DB_OWNER}" -v app="${LIMS_DB_APP}" -v pw="${app_password}" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', :'owner') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app', :'pw') \gexec
SQL
}

db_exists() {
    [ "$(psql_admin postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${1:-${LIMS_DB}}'")" = "1" ]
}

# Base vide appartenant au propriétaire du schéma.
db_create() {
    local db="${1:-${LIMS_DB}}"
    psql_admin postgres -c "CREATE DATABASE \"${db}\" OWNER \"${LIMS_DB_OWNER}\" ENCODING 'UTF8' TEMPLATE template0"
    db_apply_grants "${db}"
}

# Droits du rôle applicatif, y compris sur les objets que créeront les migrations futures.
db_apply_grants() {
    local db="${1:-${LIMS_DB}}"
    psql_admin "${db}" -v owner="${LIMS_DB_OWNER}" -v app="${LIMS_DB_APP}" -v db="${db}" <<'SQL'
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'owner') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'owner') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'db', :'app') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app') \gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', :'app') \gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'owner', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', :'owner', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', :'owner', :'app') \gexec
SELECT format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public._prisma_migrations FROM %I', :'app') WHERE to_regclass('public._prisma_migrations') IS NOT NULL \gexec
SQL
}

# Nombre de tables applicatives (0 = base vide).
db_table_count() {
    psql_admin "${1:-${LIMS_DB}}" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
}
