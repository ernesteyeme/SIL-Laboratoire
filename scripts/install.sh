#!/usr/bin/env bash
# Installation du LIMS depuis GitHub, en une commande (comme InteLIS) :
#
#   cd ~ && wget -O install.sh "https://raw.githubusercontent.com/ernesteyeme/SIL-Laboratoire/main/scripts/install.sh?v=$(date +%s)" && sudo bash install.sh
#
# Le script télécharge la dernière version publiée (GitHub Releases), vérifie son empreinte SHA-256,
# puis lance l'installateur scripts/setup.sh de cette version. Les mises à jour suivent ensuite la même
# source : « sudo lims update » installe la dernière version publiée.
#
# Options : celles de setup.sh (--host, --tls, --timezone, --yes…), plus :
#   --version 1.7.0     installer une version précise plutôt que la dernière
#   --repo owner/nom    autre dépôt GitHub (défaut : ernesteyeme/SIL-Laboratoire, ou LIMS_REPO)
#   LIMS_RELEASE_BASE=https://miroir/lims   miroir interne (dossier contenant latest.json et l'archive)
set -euo pipefail

# Le script pose des questions : exécuté par « curl … | bash », il lirait sa propre suite au lieu du clavier.
if [ ! -t 0 ] && [ -z "${LIMS_NONINTERACTIVE:-}" ] && ! printf '%s\n' "$@" | grep -qx -- '--yes\|-y'; then
    echo "ERREUR : n'envoyez pas ce script dans bash par un tube (curl … | bash) : les questions liraient le script lui-même."
    echo "Téléchargez-le d'abord, puis lancez-le :"
    echo "  cd ~ && wget -O install.sh \"https://raw.githubusercontent.com/${LIMS_REPO:-ernesteyeme/SIL-Laboratoire}/main/scripts/install.sh\" && sudo bash install.sh"
    exit 1
fi

REPO="${LIMS_REPO:-ernesteyeme/SIL-Laboratoire}"
VERSION=""
PASS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2#v}"; shift ;;
        --version=*) VERSION="${1#*=}"; VERSION="${VERSION#v}" ;;
        --repo) REPO="$2"; shift ;;
        --repo=*) REPO="${1#*=}" ;;
        -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) PASS+=("$1") ;;
    esac
    shift
done

say() { printf '%s\n' "$*"; }
die() { printf '✘ %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Lancez ce script avec sudo : sudo bash install.sh"
[[ "${REPO}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "Dépôt invalide : ${REPO}"

if ! command -v curl >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1; then
    say "Installation de curl…"
    DEBIAN_FRONTEND=noninteractive apt-get update -q >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -q curl ca-certificates coreutils >/dev/null \
        || die "Installation de curl impossible : vérifiez l'accès à Internet."
fi

# Les fichiers d'une version publiée : latest.json (désigne l'archive), l'archive et son .sha256.
if [ -n "${LIMS_RELEASE_BASE:-}" ]; then
    # Miroir interne (serveur du programme, réseau sans accès à GitHub) : dossier contenant latest.json.
    BASE="${LIMS_RELEASE_BASE%/}"
elif [ -n "${VERSION}" ]; then
    BASE="https://github.com/${REPO}/releases/download/v${VERSION}"
else
    BASE="https://github.com/${REPO}/releases/latest/download"
fi
WORK="$(mktemp -d /tmp/lims-install-XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

say "Recherche de la version à installer (${REPO})…"
curl -fsSL --retry 3 --max-time 60 -o "${WORK}/latest.json" "${BASE}/latest.json" \
    || die "Aucune version publiée trouvée sur https://github.com/${REPO}/releases (accès à Internet ? dépôt public ?)."
FILE="$(sed -n 's/.*"file": *"\([^"]*\)".*/\1/p' "${WORK}/latest.json")"
SUM="$(sed -n 's/.*"sha256": *"\([0-9a-f]\{64\}\)".*/\1/p' "${WORK}/latest.json")"
REL_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "${WORK}/latest.json")"
[[ "${FILE}" =~ ^lims-[0-9A-Za-z.+-]+\.tar\.gz$ ]] && [ -n "${SUM}" ] || die "latest.json illisible sur ${BASE}."

say "Téléchargement du LIMS ${REL_VERSION} (${FILE})…"
curl -fL --retry 3 --max-time 1800 --progress-bar -o "${WORK}/${FILE}" "${BASE}/${FILE}" || die "Téléchargement impossible : ${BASE}/${FILE}"
[ "$(sha256sum "${WORK}/${FILE}" | cut -d' ' -f1)" = "${SUM}" ] || die "Empreinte SHA-256 incorrecte : archive corrompue ou altérée. Rien n'a été installé."
say "✔ Empreinte SHA-256 vérifiée."

tar --warning=no-timestamp -xzf "${WORK}/${FILE}" -C "${WORK}"
DIR="${WORK}/${FILE%.tar.gz}"
[ -f "${DIR}/scripts/setup.sh" ] || die "Archive incomplète : scripts/setup.sh absent."

# Les mises à jour suivront la même source : « sudo lims update » prendra la dernière version publiée.
if [ -n "${LIMS_RELEASE_BASE:-}" ]; then export LIMS_UPDATE_URL="${BASE}"; else export LIMS_UPDATE_URL="https://github.com/${REPO}/releases/latest/download"; fi
# Pas d'exec : le piège EXIT doit nettoyer le dossier temporaire après l'installation.
bash "${DIR}/scripts/setup.sh" --source "${DIR}" "${PASS[@]}"
