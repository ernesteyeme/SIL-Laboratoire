#!/usr/bin/env bash
# Démarrage du conteneur de l'API : rôles PostgreSQL, base, migrations (mêmes scripts que l'installation
# Ubuntu), puis l'API avec le rôle applicatif sans droits sur le schéma.
#   LIMS_ADMIN_DATABASE_URL  connexion superutilisateur (ex. postgresql://postgres:…@db:5432/postgres)
#   LIMS_APP_DB_PASSWORD     mot de passe du rôle applicatif lims_app
set -euo pipefail
SCRIPTS=/opt/lims/current/scripts
for lib in common db-roles migrate; do
    # shellcheck disable=SC1090
    . "${SCRIPTS}/lib/${lib}.sh"
done
: "${LIMS_ADMIN_DATABASE_URL:?LIMS_ADMIN_DATABASE_URL manquant}"
: "${LIMS_APP_DB_PASSWORD:?LIMS_APP_DB_PASSWORD manquant}"
export LIMS_ADMIN_DATABASE_URL

db_host="$(printf '%s' "${LIMS_ADMIN_DATABASE_URL}" | sed -n 's#^postgresql://[^@]*@\([^:/]*\).*#\1#p')"
db_port="$(printf '%s' "${LIMS_ADMIN_DATABASE_URL}" | sed -n 's#^postgresql://[^@]*@[^:/]*:\([0-9]*\).*#\1#p')"
for i in $(seq 1 60); do
    pg_isready -q -h "${db_host}" -p "${db_port:-5432}" && break
    [ "${i}" -eq 60 ] && die "PostgreSQL (${db_host}) ne répond pas."
    sleep 1
done

db_ensure_roles "${LIMS_APP_DB_PASSWORD}" >/dev/null
db_exists || db_create "${LIMS_DB}" >/dev/null
migrations_apply /opt/lims/current

export DATABASE_URL="postgresql://${LIMS_DB_APP}:${LIMS_APP_DB_PASSWORD}@${db_host}:${db_port:-5432}/${LIMS_DB}"
unset LIMS_ADMIN_DATABASE_URL
exec "$@"
