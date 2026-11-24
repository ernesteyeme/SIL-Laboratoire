#!/usr/bin/env bash
# Construit une version publiable du LIMS : dist-release/lims-<version>.tar.gz (+ .sha256).
#
# L'archive est autonome : API compilée avec ses dépendances de production, interface web compilée,
# connecteur de poste, scripts d'installation et d'exploitation, documentation. Un serveur de laboratoire
# n'a donc besoin ni de pnpm, ni d'outils de compilation, ni d'accès au registre npm.
#
# Usage : bash scripts/make-release.sh [--skip-tests] [--out DOSSIER]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/common.sh
. "${ROOT}/scripts/lib/common.sh"

SKIP_TESTS=0
OUT="${ROOT}/dist-release"
while [ $# -gt 0 ]; do
    case "$1" in
        --skip-tests) SKIP_TESTS=1 ;;
        --out) OUT="$2"; shift ;;
        --out=*) OUT="${1#*=}" ;;
        -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
        *) die "Option inconnue : $1" ;;
    esac
    shift
done

command -v node >/dev/null || die "Node.js est requis pour construire une version."
command -v pnpm >/dev/null || die "pnpm est requis pour construire une version (corepack enable)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "${NODE_MAJOR}" -ge 20 ] || die "Node.js 20 ou plus requis (trouvé : $(node -v))."

VERSION="$(app_version "${ROOT}")"
[ -n "${VERSION}" ] || die "Version introuvable dans package.json."
COMMIT="${LIMS_COMMIT:-$(git -C "${ROOT}" rev-parse --short=7 HEAD 2>/dev/null || true)}"
export LIMS_COMMIT="${COMMIT}"
NAME="lims-${VERSION}"
STAGE="${OUT}/${NAME}"

BUILD_LOG="$(mktemp /tmp/lims-release-XXXXXX.log)"
# run "message d'erreur" commande… : sortie dans le journal, affichée en cas d'échec.
run() {
    local failure="$1"; shift
    if ! "$@" >> "${BUILD_LOG}" 2>&1; then
        tail -n 40 "${BUILD_LOG}" >&2
        die "${failure} (journal complet : ${BUILD_LOG})"
    fi
}

header "Construction de ${NAME}${COMMIT:+ (${COMMIT})}"
cd "${ROOT}"
info "Dépendances (pnpm install --frozen-lockfile)…"
run "Installation des dépendances impossible" pnpm install --frozen-lockfile
info "Compilation : bibliothèque partagée, API, interface web…"
run "Compilation de @lims/shared impossible" pnpm --filter @lims/shared build
run "Compilation de l'API impossible" pnpm --filter @lims/api build
run "Compilation de l'interface web impossible" pnpm --filter @lims/web build
if [ "${SKIP_TESTS}" -eq 0 ]; then
    info "Tests unitaires…"
    run "Les tests unitaires échouent : version non publiée" pnpm --filter @lims/api test
    run "Les tests du connecteur échouent : version non publiée" node --test apps/connector/test/link.test.mjs
    success "Tests unitaires réussis."
fi

LOCK_BACKUP="$(mktemp)"
cp "${ROOT}/pnpm-lock.yaml" "${LOCK_BACKUP}"
rm -rf "${STAGE}" "${OUT}/${NAME}.tar.gz" "${OUT}/${NAME}.tar.gz.sha256"
mkdir -p "${STAGE}/apps/web"
info "API autonome (pnpm deploy --prod)…"
run "pnpm deploy a échoué" pnpm --filter @lims/api deploy --prod --legacy --ignore-scripts "${STAGE}/apps/api"
# pnpm deploy --legacy réécrit le fichier de verrouillage (dépendances « injectées ») : on le rétablit.
run "Restauration du fichier pnpm-lock.yaml impossible" cp "${LOCK_BACKUP}" "${ROOT}/pnpm-lock.yaml"
# Paquets tirés par les dépendances « pair » de @prisma/client mais inutiles à l'exécution
# (outil en ligne de commande Prisma, Prisma Studio, compilateur TypeScript, interface React).
PRUNE=(prisma @prisma+studio-core @prisma+dev @prisma+config typescript effect @electric-sql+pglite react react-dom @types+react @types+react-dom)
for pkg in "${PRUNE[@]}"; do
    find "${STAGE}/apps/api/node_modules/.pnpm" -maxdepth 1 -name "${pkg}@*" -exec rm -rf {} +
done
find "${STAGE}/apps/api/node_modules" -xtype l -delete 2>/dev/null || true
if [ ! -f "${STAGE}/apps/api/dist/main.js" ] || [ ! -f "${STAGE}/apps/api/dist/build-info.json" ]; then die "dist/ de l'API incomplet."; fi
[ ! -e "${STAGE}/apps/api/.env" ] || die "Un fichier .env s'est glissé dans la version : abandon."

info "Vérification du chargement des modules…"
(cd "${STAGE}/apps/api" && NODE_ENV=production node -e "require('./dist/app.module'); require('./dist/cli');") \
    || die "L'API de la version ne se charge pas (dépendance manquante ?)."

cp -r apps/web/dist "${STAGE}/apps/web/dist"
mkdir -p "${STAGE}/apps/connector"
cp -r apps/connector/src apps/connector/install apps/connector/package.json apps/connector/README.md apps/connector/config.example.json "${STAGE}/apps/connector/"
cp -r scripts "${STAGE}/scripts"
rm -f "${STAGE}/scripts/make-release.sh"
[ -d docs ] && cp -r docs "${STAGE}/docs"
[ -d docker ] && cp -r docker "${STAGE}/docker"
cp README.md package.json "${STAGE}/"
[ -f LICENSE ] && cp LICENSE "${STAGE}/"
cat > "${STAGE}/RELEASE.json" <<JSON
{
  "name": "lims",
  "version": "${VERSION}",
  "commit": "${COMMIT}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "node": ">=${LIMS_NODE_MAJOR}"
}
JSON

info "Archive…"
tar -C "${OUT}" -czf "${OUT}/${NAME}.tar.gz" "${NAME}"
(cd "${OUT}" && sha256sum "${NAME}.tar.gz" > "${NAME}.tar.gz.sha256")
# Canal de publication : déposer latest.json, l'archive et son .sha256 dans un même dossier web (ou partagé),
# puis sur chaque serveur : lims update-source https://…/dossier  →  « lims update » prend la dernière version.
printf '{\n  "version": "%s",\n  "file": "%s",\n  "sha256": "%s",\n  "builtAt": "%s"\n}\n' \
    "${VERSION}" "${NAME}.tar.gz" "$(cut -d' ' -f1 "${OUT}/${NAME}.tar.gz.sha256")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${OUT}/latest.json"
rm -rf "${STAGE}" "${LOCK_BACKUP}"
success "Version prête : ${OUT}/${NAME}.tar.gz ($(human_size "$(stat -c %s "${OUT}/${NAME}.tar.gz")"))"
say "Empreinte : $(cut -d' ' -f1 "${OUT}/${NAME}.tar.gz.sha256")"
