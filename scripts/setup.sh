#!/usr/bin/env bash
# Installateur du LIMS sur Ubuntu 24.04 LTS ou plus récent (serveur de laboratoire).
#
# Démarche (comme l'installateur d'InteLIS) :
#   1. questions (dossier, adresse web, HTTPS, fuseau horaire) — réponses mémorisées pour reprendre ;
#   2. paquets : Node.js 22, PostgreSQL, Nginx, chrony, outils de sauvegarde ;
#   3. code de la version dans /opt/lims/releases, configuration et secrets dans /opt/lims/shared ;
#   4. base de données : rôle propriétaire (migrations) et rôle applicatif sans droits sur le schéma ;
#   5. services systemd (API, sauvegardes toutes les 6 h, entretien, santé), Nginx en HTTPS ;
#   6. commande « lims », puis vérification de l'installation (PASS / WARN / FAIL / SKIP).
# L'assistant du navigateur (https://<serveur>/) termine l'installation : laboratoire, administrateur.
#
# Usage : sudo bash scripts/setup.sh [options]
#   --source ARCHIVE|URL|DOSSIER  version à installer (défaut : la version qui contient ce script)
#   --dir /opt/lims               dossier d'installation
#   --host lims                   adresse web du serveur (nom court, nom de domaine ou IP)
#   --tls local|letsencrypt|provided   (--email, --cert, --key selon le cas)
#   --timezone Africa/Kinshasa
#   --db-strategy fresh|keep      si une base « lims » existe déjà
#   --yes                         sans questions (valeurs par défaut ou fournies)
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
for lib in common db-roles migrate system web services backup release checks; do
    # shellcheck disable=SC1090
    . "${SELF_DIR}/lib/${lib}.sh"
done

ANSWERS=/root/.lims-setup.answers
SOURCE=""; HOST=""; TLS_MODE=""; TLS_EMAIL=""; TLS_CERT=""; TLS_KEY=""; TIMEZONE=""; DB_STRATEGY=""; DIR=""
while [ $# -gt 0 ]; do
    case "$1" in
        --source) SOURCE="$2"; shift ;; --source=*) SOURCE="${1#*=}" ;;
        --dir) DIR="$2"; shift ;; --dir=*) DIR="${1#*=}" ;;
        --host) HOST="$2"; shift ;; --host=*) HOST="${1#*=}" ;;
        --tls) TLS_MODE="$2"; shift ;; --tls=*) TLS_MODE="${1#*=}" ;;
        --email) TLS_EMAIL="$2"; shift ;; --email=*) TLS_EMAIL="${1#*=}" ;;
        --cert) TLS_CERT="$2"; shift ;; --cert=*) TLS_CERT="${1#*=}" ;;
        --key) TLS_KEY="$2"; shift ;; --key=*) TLS_KEY="${1#*=}" ;;
        --timezone) TIMEZONE="$2"; shift ;; --timezone=*) TIMEZONE="${1#*=}" ;;
        --db-strategy) DB_STRATEGY="$2"; shift ;; --db-strategy=*) DB_STRATEGY="${1#*=}" ;;
        --skip-packages) export LIMS_SKIP_PACKAGES=1 ;;
        -y|--yes) export LIMS_NONINTERACTIVE=1 ;;
        -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Option inconnue : $1 (sudo bash setup.sh --help)" ;;
    esac
    shift
done

require_root
STARTED="$(date +%s)"
LIMS_OP_LOG="/var/log/lims-setup-$(date +%Y%m%d-%H%M%S).log"; export LIMS_OP_LOG
touch "${LIMS_OP_LOG}" && chmod 0600 "${LIMS_OP_LOG}"
header "Installation du LIMS — système d'information de laboratoire"
say "Journal détaillé : ${LIMS_OP_LOG}"
check_os

# --- 1. Questions ---------------------------------------------------------------------
valid_host() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$ ]]; }

if [ -f "${ANSWERS}" ] && [ -z "${HOST}" ]; then
    if confirm "Une installation précédente s'est arrêtée en cours de route. Reprendre avec les mêmes réponses ?" O; then
        cli_source="${SOURCE}"
        # shellcheck disable=SC1090
        . "${ANSWERS}"
        # Une source donnée sur la ligne de commande (install.sh : nouveau téléchargement) prime sur l'ancienne.
        [ -n "${cli_source}" ] && SOURCE="${cli_source}"
        RESUMED=1
    fi
fi

if [ "${RESUMED:-0}" != "1" ]; then
    DIR="$(ask "Dossier d'installation" "${DIR:-/opt/lims}")"
    while true; do
        HOST="$(ask "Adresse web de ce serveur (nom court, nom de domaine ou adresse IP)" "${HOST:-lims}")"
        if ! valid_host "${HOST}"; then warning "Adresse invalide : lettres, chiffres, tirets et points uniquement."; HOST=""; continue; fi
        case "${HOST}" in
            *.*[A-Za-z]*)
                resolved="$(getent ahostsv4 "${HOST}" | awk 'NR==1 {print $1}')"
                if [ -n "${resolved}" ] && ! local_ips | grep -qx "${resolved}" && [ "${resolved}" != "127.0.1.1" ] && [ "${resolved}" != "127.0.0.1" ]; then
                    warning "${HOST} pointe vers ${resolved}, qui n'est pas une adresse de cette machine ($(local_ips | tr '\n' ' '))."
                    confirm "Utiliser ${HOST} quand même ?" N || { HOST=""; continue; }
                fi
                ;;
        esac
        break
    done
    if [ -z "${TLS_MODE}" ]; then
        case "$(choose "Certificat HTTPS :" \
            "Autorité locale du laboratoire (réseau local, sans Internet) — recommandé" \
            "Let's Encrypt (nom de domaine public, port 80 ouvert sur Internet)" \
            "Certificat fourni par l'établissement (fichiers PEM)")" in
            2) TLS_MODE=letsencrypt ;; 3) TLS_MODE=provided ;; *) TLS_MODE=local ;;
        esac
    fi
    case "${TLS_MODE}" in
        letsencrypt) TLS_EMAIL="$(ask "Adresse e-mail pour Let's Encrypt (alertes d'expiration)" "${TLS_EMAIL}")"; [ -n "${TLS_EMAIL}" ] || die "E-mail obligatoire pour Let's Encrypt." ;;
        provided) TLS_CERT="$(ask "Chemin du certificat (PEM, chaîne complète)" "${TLS_CERT}")"; TLS_KEY="$(ask "Chemin de la clé privée (PEM)" "${TLS_KEY}")" ;;
        local) ;;
        *) die "--tls doit valoir local, letsencrypt ou provided." ;;
    esac
    current_tz="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo Africa/Kinshasa)"
    TIMEZONE="$(ask "Fuseau horaire du serveur (Kinshasa : Africa/Kinshasa, Lubumbashi : Africa/Lubumbashi)" "${TIMEZONE:-${current_tz}}")"

    header "Résumé"
    say "Dossier d'installation : ${DIR}"
    say "Adresse web            : https://${HOST}/"
    say "Certificat HTTPS       : ${TLS_MODE}${TLS_EMAIL:+ (${TLS_EMAIL})}"
    say "Fuseau horaire         : ${TIMEZONE}"
    confirm "Est-ce correct ?" O || die "Installation annulée : relancez sudo bash setup.sh."
    umask 077
    printf 'DIR=%q\nHOST=%q\nTLS_MODE=%q\nTLS_EMAIL=%q\nTLS_CERT=%q\nTLS_KEY=%q\nTIMEZONE=%q\nSOURCE=%q\n' \
        "${DIR}" "${HOST}" "${TLS_MODE}" "${TLS_EMAIL}" "${TLS_CERT}" "${TLS_KEY}" "${TIMEZONE}" "${SOURCE}" > "${ANSWERS}"
    umask 022
fi

LIMS_HOME="${DIR}"; LIMS_SHARED="${DIR}/shared"; LIMS_ENV_FILE="${LIMS_SHARED}/.env"; LIMS_STATE="${LIMS_SHARED}/state"
LIMS_BACKUPS="${LIMS_SHARED}/backups"; LIMS_LOGS="${LIMS_SHARED}/logs"
export LIMS_HOME LIMS_SHARED LIMS_ENV_FILE LIMS_STATE LIMS_BACKUPS LIMS_LOGS

ensure_hosts_entry "${HOST}"

# --- 2. Paquets ------------------------------------------------------------------------
header "Paquets système"
install_system_packages
[ "$(node_major)" -ge "${LIMS_NODE_MAJOR}" ] || install_nodejs
set_timezone "${TIMEZONE}"
wait_for_postgres

# --- 3. Code ---------------------------------------------------------------------------
header "Code du LIMS"
ensure_service_user
ensure_layout
RELEASE_SRC=""
if [ -n "${SOURCE}" ]; then
    if [ -d "${SOURCE}" ]; then RELEASE_SRC="${SOURCE}"; else RELEASE_SRC="$(fetch_release_archive "${SOURCE}")"; fi
elif is_release_dir "${SELF_DIR}/.."; then
    RELEASE_SRC="$(cd "${SELF_DIR}/.." && pwd)"
elif [ -f "${SELF_DIR}/../pnpm-workspace.yaml" ]; then
    info "Sources détectées : construction d'une version (quelques minutes, accès au registre npm requis)…"
    command -v pnpm >/dev/null 2>&1 || { corepack enable >/dev/null 2>&1 || npm install -g pnpm@10 >/dev/null 2>&1; }
    bash "${SELF_DIR}/make-release.sh" --skip-tests --out /tmp/lims-build >> "${LIMS_OP_LOG}" 2>&1 \
        || die "La construction de la version a échoué (journal : ${LIMS_OP_LOG})."
    RELEASE_SRC="$(ls -1t /tmp/lims-build/lims-*.tar.gz | head -n 1)"
else
    die "Aucune version à installer : lancez ce script depuis une archive lims-x.y.z décompressée, ou indiquez --source."
fi
CURRENT="$(current_release)"
if [ -n "${CURRENT}" ] && is_release_dir "${CURRENT}"; then
    src_dir="${RELEASE_SRC}"
    [ -d "${src_dir}" ] || src_dir=""
    if [ -n "${src_dir}" ] && [ "$(release_field "${src_dir}" version)" = "$(release_field "${CURRENT}" version)" ] \
        && [ "$(release_field "${src_dir}" builtAt)" = "$(release_field "${CURRENT}" builtAt)" ]; then
        info "Version $(release_field "${CURRENT}" version) déjà installée : reconfiguration (réparation) sans changer le code."
        TARGET="${CURRENT}"
    else
        die "Une installation existe déjà (version $(release_field "${CURRENT}" version)). Pour installer une autre version : sudo lims update --source <archive>"
    fi
else
    TARGET="$(unpack_release "${RELEASE_SRC}")"
    success "Version $(release_field "${TARGET}" version) dépaquetée dans ${TARGET}"
fi
case "${RELEASE_SRC}" in /tmp/lims-release-*/release.tar.gz) rm -rf "$(dirname "${RELEASE_SRC}")" ;; esac

# --- 4. Configuration et base de données ---------------------------------------------------
header "Base de données"
APP_DB_PASSWORD="$(app_db_password)"
write_env_file "${HOST}" "${APP_DB_PASSWORD}"
env_set LIMS_TLS_MODE "${TLS_MODE}"
[ -n "${TLS_EMAIL}" ] && env_set LIMS_TLS_EMAIL "${TLS_EMAIL}"
chown root:"${LIMS_USER}" "${LIMS_ENV_FILE}"; chmod 0640 "${LIMS_ENV_FILE}"
db_ensure_roles "${APP_DB_PASSWORD}" >/dev/null || die "Création des rôles PostgreSQL impossible."
if db_exists && [ "$(db_table_count)" -gt 0 ] && [ "${TARGET}" != "${CURRENT}" ]; then
    warning "Une base « ${LIMS_DB} » contenant des données existe déjà sur ce serveur."
    if [ -z "${DB_STRATEGY}" ]; then
        case "$(choose "Que faire de cette base ?" "Conserver une copie, puis repartir d'une base vide" "Garder les données existantes (mise à niveau du schéma)" "Annuler l'installation")" in
            1) DB_STRATEGY=fresh ;; 2) DB_STRATEGY=keep ;; *) die "Installation annulée : la base existante est intacte." ;;
        esac
    fi
    if [ "${DB_STRATEGY}" = "fresh" ]; then
        kept="$(backup_database copie-avant-reinstallation)" || die "Copie de la base existante impossible : installation interrompue."
        success "Copie conservée : ${kept}"
        terminate_connections
        psql_admin postgres -c "DROP DATABASE \"${LIMS_DB}\" WITH (FORCE)" >/dev/null
    fi
fi
db_exists || db_create "${LIMS_DB}" >/dev/null
db_apply_grants "${LIMS_DB}" >/dev/null
if [ "${DB_STRATEGY}" = "keep" ] && ! migrations_journal_exists; then
    migrations_apply "${TARGET}" --baseline || die "Mise à niveau de la base existante impossible."
fi
migrations_apply "${TARGET}" || die "Les migrations ont échoué (journal : ${LIMS_OP_LOG})."

# --- 5. Services, Nginx, HTTPS ---------------------------------------------------------------
header "Services et HTTPS"
activate_release "${TARGET}"
write_systemd_units
enable_services
api_restart || true
if is_systemd; then
    served="$(wait_for_api 90)" || { journalctl -u lims-api -n 30 --no-pager; die "L'API ne démarre pas (voir ci-dessus, et : sudo lims doctor)."; }
    success "API démarrée (v${served})."
fi
[ "${TLS_MODE}" = "provided" ] && install_provided_certificate "${TLS_CERT}" "${TLS_KEY}"
configure_https "${HOST}"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
    ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && success "Pare-feu : ports 80 et 443 ouverts."
fi

# Source des mises à jour (installation depuis GitHub par install.sh) : « sudo lims update » sans argument.
if [ -n "${LIMS_UPDATE_URL:-}" ] && [ ! -s "${LIMS_STATE}/update.conf" ]; then
    printf 'UPDATE_URL=%s\n' "${LIMS_UPDATE_URL}" > "${LIMS_STATE}/update.conf"
    success "Mises à jour : ${LIMS_UPDATE_URL}"
fi

# --- 6. Vérification --------------------------------------------------------------------------
lims_backup --scheduled >/dev/null 2>&1 && success "Première sauvegarde locale effectuée." || warning "Première sauvegarde impossible : sudo lims backup"
lims_check
rm -f "${ANSWERS}"

header "Installation terminée"
TOKEN="$(env_get SETUP_TOKEN)"
say "1. Ouvrez ${C_BOLD}https://${HOST}/${C_RESET} dans un navigateur de ce serveur,"
say "   ou depuis un autre poste : $(local_ips | sed 's#^#https://#; s#$#/#' | tr '\n' ' ')"
if [ "${TLS_MODE}" = "local" ]; then
    say "   Sur chaque poste, importez une fois le certificat de l'autorité locale :"
    say "   http://$(local_ips | head -n 1)/lims-ca.crt  (guide : docs/guides/installer-sur-ubuntu.md)"
fi
say "2. L'assistant demande ce code d'installation : ${C_BOLD}${TOKEN}${C_RESET}"
say "   (à retrouver à tout moment avec : sudo lims setup-token)"
say "3. Choisissez où envoyer les sauvegardes : ${C_BOLD}lims backup setup${C_RESET}"
say ""
say "Commandes utiles : lims (menu), lims check, lims backup status, lims update. Durée : $(( $(date +%s) - STARTED )) s."
log_action "Installation terminée"
