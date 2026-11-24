#!/usr/bin/env bash
# Exploitation du LIMS sous Docker (équivalent de « lims » pour une installation Ubuntu).
#
#   sudo bash docker/lims-docker.sh install            depuis une version décompressée (lims-x.y.z/)
#   sudo bash lims-docker.sh update --source lims-x.y.z.tar.gz
#   sudo bash lims-docker.sh backup | restore <fichier.dump> | status | logs [api|web|db] | setup-token
#
# Les fichiers de l'installation vivent dans LIMS_DOCKER_DIR (défaut /opt/lims-docker) :
#   .env (secrets, 0600), docker-compose.prod.yml, backups/, lims-docker.sh
set -euo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
HERE="$(dirname "${SELF}")"
# Copie installée à côté de son .env (cas courant : /opt/lims-docker/lims-docker.sh) : c'est ce dossier.
if [ -z "${LIMS_DOCKER_DIR:-}" ] && [ -f "${HERE}/.env" ] && [ -f "${HERE}/docker-compose.prod.yml" ]; then
    DIR="${HERE}"
else
    DIR="${LIMS_DOCKER_DIR:-/opt/lims-docker}"
fi
if [ -f "${HERE}/../scripts/lib/common.sh" ]; then
    # shellcheck disable=SC1091
    . "${HERE}/../scripts/lib/common.sh"
else
    say() { printf '%s\n' "$*"; }; info() { say "ℹ $*"; }; success() { say "✔ $*"; }
    warning() { say "⚠ $*"; }; error() { say "✘ $*" >&2; }; die() { error "$*"; exit 1; }
    header() { printf '\n%s\n\n' "$1"; }
    random_secret() { openssl rand -hex "${1:-32}"; }
    random_password() { LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9' < /dev/urandom | head -c "${1:-24}"; }
fi

compose() { docker compose --project-directory "${DIR}" --env-file "${DIR}/.env" -f "${DIR}/docker-compose.prod.yml" "$@"; }
env_value() { sed -n "s/^$1=//p" "${DIR}/.env" | tail -n 1; }
set_env_value() {
    local tmp; tmp="$(mktemp)"
    grep -v "^$1=" "${DIR}/.env" > "${tmp}" || true
    printf '%s=%s\n' "$1" "$2" >> "${tmp}"
    cat "${tmp}" > "${DIR}/.env"; rm -f "${tmp}"
}

build_images() {
    local release="$1" version
    version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "${release}/RELEASE.json")"
    [ -n "${version}" ] || die "${release} n'est pas une version du LIMS (RELEASE.json)."
    info "Construction des images lims-api:${version} et lims-web:${version}…" >&2
    docker build ${LIMS_DOCKER_BUILD_ARGS:-} -q -f "${release}/docker/Dockerfile.api" -t "lims-api:${version}" "${release}" >/dev/null || die "Construction de l'image de l'API impossible."
    docker build ${LIMS_DOCKER_BUILD_ARGS:-} -q -f "${release}/docker/Dockerfile.web" -t "lims-web:${version}" "${release}" >/dev/null || die "Construction de l'image web impossible."
    printf '%s' "${version}"
}

wait_healthy() {
    for _ in $(seq 1 "${1:-120}"); do
        if compose exec -T api curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    return 1
}

backup() {
    local label="${1:-manuel}" file
    command install -d -m 0700 "${DIR}/backups"
    file="${DIR}/backups/lims-$(date +%Y%m%d-%H%M%S)-v$(env_value LIMS_VERSION)-${label}.dump"
    compose exec -T db pg_dump -U postgres -Fc lims > "${file}.part" || { rm -f "${file}.part"; die "pg_dump a échoué."; }
    mv "${file}.part" "${file}"
    (cd "${DIR}/backups" && sha256sum "$(basename "${file}")" > "$(basename "${file}").sha256")
    cp "${DIR}/.env" "${DIR}/backups/env-$(date +%Y%m%d-%H%M%S)"
    chmod 0600 "${DIR}"/backups/*
    find "${DIR}/backups" -type f -mtime +30 -delete
    printf '%s' "${file}"
}

restore() {
    local file="$1"
    [ -s "${file}" ] || die "Sauvegarde introuvable : ${file}"
    if [ -f "${file}.sha256" ]; then
        (cd "$(dirname "${file}")" && sha256sum -c "$(basename "${file}").sha256" >/dev/null) || die "Empreinte SHA-256 incorrecte : ${file}"
    fi
    compose stop api >/dev/null
    compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q \
        -c "DROP DATABASE IF EXISTS lims WITH (FORCE)" -c "CREATE DATABASE lims OWNER lims_owner TEMPLATE template0" >/dev/null
    compose exec -T db pg_restore -U postgres --no-owner --role=lims_owner --exit-on-error -d lims < "${file}" || die "pg_restore a échoué."
    compose start api >/dev/null
    wait_healthy 120 || die "L'API ne répond pas après la restauration : bash lims-docker.sh logs api"
    success "Base restaurée depuis $(basename "${file}")."
}

install_lims() {
    local release version host
    command -v docker >/dev/null || die "Docker est requis (https://docs.docker.com/engine/install/ubuntu/)."
    docker compose version >/dev/null 2>&1 || die "Le greffon « docker compose » est requis."
    release="$(cd "${HERE}/.." && pwd)"
    [ -f "${release}/RELEASE.json" ] || die "Lancez ce script depuis une version décompressée (lims-x.y.z/docker/lims-docker.sh)."
    [ ! -f "${DIR}/.env" ] || die "Une installation Docker existe déjà dans ${DIR} : utilisez « update »."
    install -d -m 0750 "${DIR}"
    host="${LIMS_HOSTNAME:-lims}"
    version="$(build_images "${release}")"
    umask 077
    cat > "${DIR}/.env" <<ENV
# LIMS sous Docker — secrets générés le $(date '+%Y-%m-%d %H:%M'). À sauvegarder avec les données.
LIMS_VERSION=${version}
LIMS_HOSTNAME=${host}
POSTGRES_PASSWORD=$(random_password 32)
LIMS_APP_DB_PASSWORD=$(random_password 32)
JWT_ACCESS_SECRET=$(random_secret 48)
INTEROP_SECRET_KEY=$(random_secret 32)
SETUP_TOKEN=$(random_password 24)
TZ=${TZ:-Africa/Kinshasa}
LIMS_HTTP_PORT=${LIMS_HTTP_PORT:-80}
LIMS_HTTPS_PORT=${LIMS_HTTPS_PORT:-443}
LIMS_EXTRA_SAN=${LIMS_EXTRA_SAN:-}
ENV
    umask 022
    [ -n "${POSTGRES_IMAGE:-}" ] && set_env_value POSTGRES_IMAGE "${POSTGRES_IMAGE}"
    cp "${release}/docker/docker-compose.prod.yml" "${release}/docker/lims-docker.sh" "${DIR}/"
    compose up -d
    wait_healthy 180 || die "L'API ne démarre pas : bash ${DIR}/lims-docker.sh logs api"
    success "LIMS ${version} démarré."
    say "Ouvrez https://${host}:$(env_value LIMS_HTTPS_PORT)/ — code d'installation : $(env_value SETUP_TOKEN)"
    say "Sauvegarde : bash ${DIR}/lims-docker.sh backup (à planifier, voir docs/guides/installer-avec-docker.md)."
}

update() {
    local source="" tmp release old new dump
    [ "${1:-}" = "--source" ] && source="${2:-}"
    [ -n "${source}" ] && [ -f "${source}" ] || die "Usage : lims-docker.sh update --source lims-x.y.z.tar.gz"
    if [ -f "${source}.sha256" ]; then
        [ "$(sha256sum "${source}" | awk '{print $1}')" = "$(awk '{print $1}' "${source}.sha256")" ] || die "Empreinte SHA-256 incorrecte."
    fi
    tmp="$(mktemp -d)"
    tar --warning=no-timestamp -xzf "${source}" -C "${tmp}"
    release="$(find "${tmp}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    old="$(env_value LIMS_VERSION)"
    new="$(build_images "${release}")"
    info "Sauvegarde avant mise à jour…"
    dump="$(backup "avant-maj-v${new}")"
    cp "${release}/docker/docker-compose.prod.yml" "${release}/docker/lims-docker.sh" "${DIR}/"
    set_env_value LIMS_VERSION "${new}"
    compose up -d
    if wait_healthy 180; then
        rm -rf "${tmp}"
        success "Mise à jour réussie : ${old} → ${new}"
        return 0
    fi
    error "La version ${new} ne répond pas : retour à ${old}."
    set_env_value LIMS_VERSION "${old}"
    compose up -d
    restore "${dump}"
    rm -rf "${tmp}"
    return 1
}

case "${1:-}" in
    install) install_lims ;;
    update) shift; update "$@" ;;
    backup) [ -f "${DIR}/.env" ] || die "Aucune installation Docker dans ${DIR}."; f="$(backup manuel)"; success "Sauvegarde : ${f}" ;;
    restore) [ -n "${2:-}" ] || die "Usage : lims-docker.sh restore <fichier.dump>"; restore "$2" ;;
    status) compose ps; compose exec -T api curl -fsS http://127.0.0.1:3000/api/health && echo ;;
    logs) compose logs --tail 200 "${2:-api}" ;;
    setup-token) say "Code d'installation : $(env_value SETUP_TOKEN)" ;;
    *) sed -n '2,9p' "${SELF}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
