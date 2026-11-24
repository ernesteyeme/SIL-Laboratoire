# shellcheck shell=bash
# Paquets système, compte de service, arborescence. Requiert common.sh.

# Ubuntu LTS 24.04 ou plus récent (comme InteLIS). LIMS_ALLOW_UNSUPPORTED_OS=1 pour passer outre.
check_os() {
    local id version pretty major
    [ -r /etc/os-release ] || die "Système non reconnu (/etc/os-release absent)."
    # shellcheck disable=SC1091
    . /etc/os-release
    id="${ID:-}"; version="${VERSION_ID:-0}"; pretty="${PRETTY_NAME:-inconnu}"
    major="${version%%.*}"
    if [ "${id}" != "ubuntu" ]; then
        [ "${LIMS_ALLOW_UNSUPPORTED_OS:-0}" = "1" ] || die "Ce script requiert Ubuntu LTS (système détecté : ${pretty})."
        warning "Système non pris en charge (${pretty}) : poursuite à vos risques (LIMS_ALLOW_UNSUPPORTED_OS=1)."
        return 0
    fi
    if [ "${major}" -lt 24 ]; then
        die "Ce script requiert Ubuntu 24.04 LTS ou plus récent (détecté : ${pretty}). Réinstallez la machine en 24.04 LTS."
    fi
    case "${VERSION:-}" in
        *LTS*) ;;
        *) [ "${LIMS_ALLOW_UNSUPPORTED_OS:-0}" = "1" ] || die "Ce script requiert une version LTS d'Ubuntu (détecté : ${pretty})." ;;
    esac
    success "Système : ${pretty}"
}

node_major() {
    command -v node >/dev/null 2>&1 || { echo 0; return; }
    node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

apt_install() {
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q -o Dpkg::Options::=--force-confold "$@" >> "${LIMS_OP_LOG:-/dev/null}" 2>&1
}

install_nodejs() {
    if [ "$(node_major)" -ge "${LIMS_NODE_MAJOR}" ]; then
        success "Node.js $(node -v) déjà présent."
        return 0
    fi
    if [ -n "${LIMS_NODE_TARBALL:-}" ]; then
        info "Node.js depuis l'archive ${LIMS_NODE_TARBALL}…"
        tar -xf "${LIMS_NODE_TARBALL}" -C /usr/local --strip-components=1 || die "Archive Node.js illisible."
    else
        info "Node.js ${LIMS_NODE_MAJOR} (dépôt NodeSource)…"
        install -d -m 0755 /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
            | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg \
            || die "Téléchargement de la clé NodeSource impossible : vérifiez l'accès à Internet."
        printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "${LIMS_NODE_MAJOR}" \
            > /etc/apt/sources.list.d/nodesource.list
        apt-get update -q >> "${LIMS_OP_LOG:-/dev/null}" 2>&1 || die "apt-get update a échoué (dépôt NodeSource)."
        apt_install nodejs || die "Installation de Node.js impossible."
    fi
    [ "$(node_major)" -ge "${LIMS_NODE_MAJOR}" ] || die "Node.js ${LIMS_NODE_MAJOR} ou plus est requis (trouvé : $(node -v 2>/dev/null || echo aucun))."
    success "Node.js $(node -v)"
}

install_system_packages() {
    if [ "${LIMS_SKIP_PACKAGES:-0}" = "1" ]; then
        warning "Installation des paquets système ignorée (LIMS_SKIP_PACKAGES=1)."
        return 0
    fi
    # Aucun service ne démarre pendant l'installation des paquets : un port 80 déjà pris (Apache d'InteLIS…)
    # ou une machine sans IPv6 ne doivent pas laisser dpkg à moitié configuré. Les services sont démarrés ensuite.
    local policy_created=0
    if [ ! -e /usr/sbin/policy-rc.d ]; then
        printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod 0755 /usr/sbin/policy-rc.d && policy_created=1
    fi
    DEBIAN_FRONTEND=noninteractive dpkg --configure -a >> "${LIMS_OP_LOG:-/dev/null}" 2>&1 || true
    info "Mise à jour de la liste des paquets…"
    apt-get update -q >> "${LIMS_OP_LOG:-/dev/null}" 2>&1 || die "apt-get update a échoué : vérifiez l'accès à Internet et les dépôts."
    info "PostgreSQL, Nginx, synchronisation de l'heure, outils de sauvegarde…"
    apt_install ca-certificates curl gnupg openssl rsync cifs-utils openssh-client \
        postgresql postgresql-client nginx chrony logrotate tzdata sudo util-linux \
        || { [ "${policy_created}" -eq 1 ] && rm -f /usr/sbin/policy-rc.d; die "Installation des paquets système impossible (journal : ${LIMS_OP_LOG:-})."; }
    [ "${policy_created}" -eq 1 ] && rm -f /usr/sbin/policy-rc.d
    # Le site par défaut de Nginx écoute aussi en IPv6 : il est remplacé par celui du LIMS.
    rm -f /etc/nginx/sites-enabled/default
    install_nodejs
    if is_systemd; then
        systemctl enable --now postgresql >/dev/null 2>&1 || true
        systemctl enable --now chrony >/dev/null 2>&1 || true
        systemctl enable nginx >/dev/null 2>&1 || true
    fi
    check_web_ports
    success "Paquets système installés."
}

wait_for_postgres() {
    local i
    for i in $(seq 1 30); do
        if pg_isready -q 2>/dev/null; then return 0; fi
        if [ "${i}" -eq 1 ] && is_systemd; then systemctl start postgresql >/dev/null 2>&1 || true; fi
        sleep 1
    done
    die "PostgreSQL ne répond pas. Diagnostic : sudo lims doctor"
}

set_timezone() {
    local tz="$1"
    [ -n "${tz}" ] || return 0
    [ -e "/usr/share/zoneinfo/${tz}" ] || { warning "Fuseau horaire inconnu : ${tz} (inchangé)."; return 0; }
    if command -v timedatectl >/dev/null 2>&1 && is_systemd; then
        timedatectl set-timezone "${tz}" 2>/dev/null || ln -sf "/usr/share/zoneinfo/${tz}" /etc/localtime
    else
        ln -sf "/usr/share/zoneinfo/${tz}" /etc/localtime
        echo "${tz}" > /etc/timezone
    fi
    success "Fuseau horaire du serveur : ${tz}"
}

ensure_service_user() {
    if ! id "${LIMS_USER}" >/dev/null 2>&1; then
        useradd --system --home-dir "${LIMS_HOME}" --no-create-home --shell /usr/sbin/nologin "${LIMS_USER}"
        success "Compte de service « ${LIMS_USER} » créé."
    fi
}

# Arborescence :
#   /opt/lims/releases/<version>-<date>/   code de chaque version installée
#   /opt/lims/current -> releases/…        version en service
#   /opt/lims/shared/.env                  configuration (secrets) — root:lims 0640
#   /opt/lims/shared/backups/{db,config}   sauvegardes locales — root 0700
#   /opt/lims/shared/state/                état des opérations — root 0700
#   /opt/lims/shared/tls/                  certificats HTTPS
#   /var/www/lims/                         page de maintenance, certificat de l'autorité locale (lisibles par Nginx)
ensure_layout() {
    install -d -m 0755 -o root -g root "${LIMS_HOME}" "${LIMS_HOME}/releases"
    install -d -m 0750 -o root -g "${LIMS_USER}" "${LIMS_SHARED}"
    install -d -m 0700 -o root -g root "${LIMS_BACKUPS}" "${LIMS_BACKUPS}/db" "${LIMS_BACKUPS}/config" "${LIMS_STATE}"
    install -d -m 0750 -o root -g root "${LIMS_LOGS}"
    install -d -m 0755 -o root -g root "${LIMS_SHARED}/tls" "${LIMS_PUBLIC_WWW}"
}

# Écrit le fichier .env de production (secrets générés) ; conserve un fichier existant.
write_env_file() {
    local host="$1" app_password="$2"
    if [ -f "${LIMS_ENV_FILE}" ]; then
        info "Configuration existante conservée : ${LIMS_ENV_FILE}"
        env_set DATABASE_URL "postgresql://${LIMS_DB_APP}:${app_password}@127.0.0.1:5432/${LIMS_DB}"
        env_set CORS_ORIGINS "https://${host}"
        env_set LIMS_HOSTNAME "${host}"
        [ -n "$(env_get INTEROP_SECRET_KEY)" ] || env_set INTEROP_SECRET_KEY "$(random_secret 32)"
        [ -n "$(env_get HOST)" ] || env_set HOST 127.0.0.1
    else
        umask 027
        cat > "${LIMS_ENV_FILE}" <<ENV
# Configuration du LIMS — générée par scripts/setup.sh le $(date '+%Y-%m-%d %H:%M').
# Contient des secrets : ne pas copier hors du serveur autrement que par « lims backup ».
NODE_ENV=production
HOST=127.0.0.1
PORT=${LIMS_API_PORT}
DATABASE_URL=postgresql://${LIMS_DB_APP}:${app_password}@127.0.0.1:5432/${LIMS_DB}
CORS_ORIGINS=https://${host}
TRUST_PROXY=true
COOKIE_SECURE=true
JWT_ACCESS_SECRET=$(random_secret 48)
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=7
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
# Clé AES-256 des secrets DHIS2/VLSM/OpenHIM : à conserver avec les sauvegardes.
INTEROP_SECRET_KEY=$(random_secret 32)
# Code demandé par l'assistant d'installation dans le navigateur (inutile une fois l'installation terminée).
SETUP_TOKEN=$(random_password 24)
LIMS_HOSTNAME=${host}
ENV
        umask 022
        success "Configuration créée : ${LIMS_ENV_FILE}"
    fi
    chown root:"${LIMS_USER}" "${LIMS_ENV_FILE}"
    chmod 0640 "${LIMS_ENV_FILE}"
}

# Mot de passe du rôle applicatif, lu dans la configuration existante ou généré.
app_db_password() {
    local url pw
    url="$(env_get DATABASE_URL 2>/dev/null || true)"
    pw="$(printf '%s' "${url}" | sed -n 's#^postgresql://[^:]*:\([^@]*\)@.*#\1#p')"
    [ -n "${pw}" ] && printf '%s' "${pw}" || random_password 32
}

local_ips() {
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -v '^127\.' || true
}

# Nom court (ex. « lims ») : résolu localement via /etc/hosts, comme « http://intelis/ ».
ensure_hosts_entry() {
    local host="$1" self
    # Le nom de la machine doit lui-même se résoudre (sudo, PostgreSQL et Nginx l'utilisent).
    self="$(hostname -s 2>/dev/null || true)"
    if [ -n "${self}" ] && ! getent hosts "${self}" >/dev/null 2>&1; then
        printf '127.0.1.1\t%s\n' "${self}" >> /etc/hosts
    fi
    case "${host}" in *.*) return 0 ;; esac
    if ! grep -qE "^[0-9.]+[[:space:]].*\b${host}\b" /etc/hosts; then
        printf '127.0.1.1\t%s\n' "${host}" >> /etc/hosts
        info "« ${host} » ajouté à /etc/hosts."
    fi
}

# Ports 80/443 : ils doivent être libres pour Nginx (sinon, dire qui les occupe).
check_web_ports() {
    local port who
    for port in 80 443; do
        who="$(ss -Hltnp "sport = :${port}" 2>/dev/null | grep -v nginx | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n 1)"
        if [ -n "${who}" ]; then
            die "Le port ${port} est déjà utilisé par « ${who} » (InteLIS/Apache sur la même machine ?). Libérez-le ou installez le LIMS sur une autre machine."
        fi
    done
}

ipv6_enabled() {
    [ -f /proc/net/if_inet6 ] && [ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null || echo 1)" = "0" ]
}
