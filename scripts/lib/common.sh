# shellcheck shell=bash
# Fonctions partagées par setup.sh, lims et les scripts d'exploitation.
# À sourcer (`. scripts/lib/common.sh`) ; ne s'exécute pas seul.

# --- Emplacements -----------------------------------------------------------
LIMS_HOME="${LIMS_HOME:-/opt/lims}"
LIMS_SHARED="${LIMS_SHARED:-${LIMS_HOME}/shared}"
LIMS_ENV_FILE="${LIMS_ENV_FILE:-${LIMS_SHARED}/.env}"
LIMS_STATE="${LIMS_STATE:-${LIMS_SHARED}/state}"
LIMS_BACKUPS="${LIMS_BACKUPS:-${LIMS_SHARED}/backups}"
LIMS_LOGS="${LIMS_LOGS:-${LIMS_SHARED}/logs}"
# Fichiers publics servis par Nginx (page de maintenance, certificat de l'autorité locale). Hors de
# /opt/lims/shared, que Nginx (www-data) ne doit pas pouvoir traverser : il contient le fichier .env.
LIMS_PUBLIC_WWW="${LIMS_PUBLIC_WWW:-/var/www/lims}"
LIMS_USER="${LIMS_USER:-lims}"
LIMS_DB="${LIMS_DB:-lims}"
LIMS_DB_OWNER="${LIMS_DB_OWNER:-lims_owner}"
LIMS_DB_APP="${LIMS_DB_APP:-lims_app}"
LIMS_API_PORT="${LIMS_API_PORT:-3000}"
LIMS_NODE_MAJOR="${LIMS_NODE_MAJOR:-22}"
LIMS_PG_MAJOR="${LIMS_PG_MAJOR:-16}"

# --- Affichage ----------------------------------------------------------------
# Couleurs utilisées par les autres bibliothèques (checks.sh…).
# shellcheck disable=SC2034
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[1;91m'; C_GREEN=$'\033[1;92m'
    C_YELLOW=$'\033[1;93m'; C_CYAN=$'\033[1;96m'; C_DIM=$'\033[2m'
else
    C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''; C_DIM=''
fi

say()     { printf '%s\n' "$*"; }
info()    { printf '%sℹ %s %s\n' "${C_CYAN}" "${C_RESET}" "$*"; }
success() { printf '%s✔%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warning() { printf '%s⚠%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*"; }
error()   { printf '%s✘%s %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; }
die()     { error "$*"; exit 1; }
header() {
    local line
    line="$(printf '%*s' "${#1}" '' | tr ' ' '=')"
    printf '\n%s%s\n%s%s\n\n' "${C_CYAN}" "$1" "${line}" "${C_RESET}"
}

# Journal horodaté (fichier de l'opération en cours, s'il est défini).
log_action() {
    local msg="$*"
    if [ -n "${LIMS_OP_LOG:-}" ]; then
        printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${msg}" >> "${LIMS_OP_LOG}" 2>/dev/null || true
    fi
}

# --- Questions -----------------------------------------------------------------
# ask "Question" "valeur par défaut" → réponse sur stdout (défaut si vide ou non interactif).
ask() {
    local prompt="$1" default="${2:-}" reply
    if [ "${LIMS_NONINTERACTIVE:-0}" = "1" ] || [ ! -t 0 ]; then
        printf '%s' "${default}"
        return 0
    fi
    if [ -n "${default}" ]; then
        read -r -p "${prompt} [${default}] : " reply
    else
        read -r -p "${prompt} : " reply
    fi
    printf '%s' "${reply:-${default}}"
}

# confirm "Question" O|N → code 0 si oui.
confirm() {
    local prompt="$1" default="${2:-O}" reply hint
    if [ "${LIMS_NONINTERACTIVE:-0}" = "1" ] || [ ! -t 0 ]; then
        [ "${default}" = "O" ]
        return
    fi
    if [ "${default}" = "O" ]; then hint="O/n"; else hint="o/N"; fi
    read -r -p "${prompt} [${hint}] : " reply
    reply="${reply:-${default}}"
    case "${reply}" in [oOyY]*) return 0 ;; *) return 1 ;; esac
}

# choose "Question" "option 1" "option 2" … → numéro choisi (1-based) sur stdout ; défaut 1.
choose() {
    local prompt="$1"; shift
    local i=1 opt reply
    if [ "${LIMS_NONINTERACTIVE:-0}" = "1" ] || [ ! -t 0 ]; then
        printf '%s' "${LIMS_CHOICE_DEFAULT:-1}"
        return 0
    fi
    say "${prompt}" >&2
    for opt in "$@"; do
        printf '  %s%d)%s %s\n' "${C_BOLD}" "${i}" "${C_RESET}" "${opt}" >&2
        i=$((i + 1))
    done
    while true; do
        read -r -p "Votre choix [1] : " reply
        reply="${reply:-1}"
        if [[ "${reply}" =~ ^[0-9]+$ ]] && [ "${reply}" -ge 1 ] && [ "${reply}" -le "$#" ]; then
            printf '%s' "${reply}"
            return 0
        fi
        say "Choisissez un nombre entre 1 et $#." >&2
    done
}

# --- Divers ----------------------------------------------------------------------
require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        die "Cette commande exige les droits administrateur : relancez-la avec sudo."
    fi
}

random_secret() {
    # $1 = nombre d'octets aléatoires (hexadécimal en sortie)
    openssl rand -hex "${1:-32}"
}

random_password() {
    # Mot de passe sans caractères ambigus ni guillemets, utilisable dans une URL.
    LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9' < /dev/urandom | head -c "${1:-24}"
}

# Lit une variable d'un fichier .env sans l'exécuter.
env_get() {
    local key="$1" file="${2:-${LIMS_ENV_FILE}}"
    [ -f "${file}" ] || return 1
    sed -n "s/^${key}=//p" "${file}" | tail -n 1 | sed -e 's/^"//' -e 's/"$//'
}

# Écrit ou remplace une variable dans un fichier .env.
env_set() {
    local key="$1" value="$2" file="${3:-${LIMS_ENV_FILE}}" tmp
    tmp="$(mktemp)"
    if [ -f "${file}" ]; then
        grep -v "^${key}=" "${file}" > "${tmp}" || true
    fi
    printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
    cat "${tmp}" > "${file}"
    rm -f "${tmp}"
}

# Exporte les variables du .env dans l'environnement courant (format clé=valeur simple).
load_env() {
    local file="${1:-${LIMS_ENV_FILE}}" line key value
    [ -r "${file}" ] || return 1
    while IFS= read -r line || [ -n "${line}" ]; do
        case "${line}" in ''|'#'*) continue ;; esac
        key="${line%%=*}"
        value="${line#*=}"
        value="${value#\"}"; value="${value%\"}"
        [[ "${key}" =~ ^[A-Z_][A-Z0-9_]*$ ]] && export "${key}=${value}"
    done < "${file}"
}

# Version de l'application dans un répertoire de code.
app_version() {
    local dir="${1:-${LIMS_HOME}/current}"
    node -e 'try{process.stdout.write(require(process.argv[1]).version)}catch(e){process.exit(1)}' "${dir}/package.json" 2>/dev/null
}

app_commit() {
    local dir="${1:-${LIMS_HOME}/current}"
    node -e 'try{const i=require(process.argv[1]);process.stdout.write(i.commit||"")}catch(e){}' "${dir}/apps/api/dist/build-info.json" 2>/dev/null
}

# Connexion d'administration à la base $1 : superutilisateur local (authentification « peer »),
# ou LIMS_ADMIN_DATABASE_URL (tests, serveur PostgreSQL distant), dont le nom de base est remplacé.
admin_dsn() {
    local db="${1:-postgres}"
    if [ -n "${LIMS_ADMIN_DATABASE_URL:-}" ]; then
        local url="${LIMS_ADMIN_DATABASE_URL%%\?*}"
        printf '%s/%s' "${url%/*}" "${db}"
    else
        printf '%s' "${db}"
    fi
}

# Exécute un outil PostgreSQL (psql, pg_dump, pg_restore…) avec les droits d'administration.
pg_admin_tool() {
    if [ -n "${LIMS_ADMIN_DATABASE_URL:-}" ] || [ "$(id -un)" = "postgres" ]; then
        "$@"
    else
        sudo -u postgres "$@"
    fi
}

# psql_admin BASE [arguments psql…]
psql_admin() {
    local db="$1"; shift
    pg_admin_tool psql -X -q -v ON_ERROR_STOP=1 -d "$(admin_dsn "${db}")" "$@"
}

# psql sur la base de l'application, avec le rôle propriétaire du schéma (objets créés à son nom).
psql_owner() {
    psql_admin "${LIMS_DB}" -c "SET ROLE ${LIMS_DB_OWNER}" "$@"
}

human_size() {
    numfmt --to=iec --suffix=o "${1:-0}" 2>/dev/null || printf '%s o' "${1:-0}"
}

# Âge en heures d'un fichier (vide si absent).
file_age_hours() {
    [ -e "$1" ] || return 1
    echo $(( ($(date +%s) - $(stat -c %Y "$1")) / 3600 ))
}

is_systemd() {
    [ -d /run/systemd/system ]
}
