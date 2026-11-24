#!/usr/bin/env bash
# Installe le connecteur d'automate comme service systemd sur un poste Linux (Ubuntu, Debian…).
#
#   sudo bash install/install-linux.sh --config /chemin/config.json [--name xn1000] [--ca http://serveur/lims-ca.crt]
#   sudo bash install/install-linux.sh --uninstall --name xn1000
#
# --config  fichier config.json émis par le LIMS (Automates → l'automate → Émettre la clé)
# --name    nom court du service (lettres, chiffres, tirets) ; défaut : déduit du code de l'automate dans la clé
# --ca      certificat de l'autorité locale du serveur (adresse http ou fichier), si le serveur utilise
#           l'autorité locale du laboratoire ; défaut : http://<serveur>/lims-ca.crt quand il est publié
#
# Résultat : /opt/lims-connector/<nom>/ (programme, config.json 0600, données), service lims-connector-<nom>,
# compte système lims-connector, redémarrage automatique, journal : journalctl -u lims-connector-<nom>
set -euo pipefail

SRC="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
CONFIG=""; NAME=""; CA=""; UNINSTALL=0
say() { printf '%s\n' "$*"; }
ok() { printf '✔ %s\n' "$*"; }
die() { printf '✘ %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --config) CONFIG="$2"; shift ;; --config=*) CONFIG="${1#*=}" ;;
        --name) NAME="$2"; shift ;; --name=*) NAME="${1#*=}" ;;
        --ca) CA="$2"; shift ;; --ca=*) CA="${1#*=}" ;;
        --uninstall) UNINSTALL=1 ;;
        -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Option inconnue : $1 (--help)" ;;
    esac
    shift
done
[ "$(id -u)" -eq 0 ] || die "Lancez ce script avec sudo."
command -v systemctl >/dev/null 2>&1 || die "systemd est requis (sinon, lancez : node src/index.mjs config.json)."

if [ "${UNINSTALL}" -eq 1 ]; then
    [ -n "${NAME}" ] || die "Indiquez le service à retirer : --name <nom>"
    systemctl disable --now "lims-connector-${NAME}" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/lims-connector-${NAME}.service"
    systemctl daemon-reload
    ok "Service lims-connector-${NAME} retiré. Données conservées dans /opt/lims-connector/${NAME} (file d'attente, journaux)."
    exit 0
fi

[ -n "${CONFIG}" ] && [ -f "${CONFIG}" ] || die "Fichier de configuration introuvable : --config /chemin/config.json"
command -v node >/dev/null 2>&1 || die "Node.js 20 ou plus est requis : sudo apt install nodejs (ou https://nodejs.org)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js 20 ou plus est requis (trouvé : $(node -v))."

# Lecture et contrôle de la configuration (sans afficher la clé).
read -r API_URL KEY_PREFIX < <(node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const k of ["apiUrl", "instrumentKey", "mode", "protocol"]) if (!c[k]) { console.error("Paramètre manquant : " + k); process.exit(2); }
  const m = /^sil_([a-z0-9-]+)_/i.exec(c.instrumentKey) || /^([a-z0-9-]+)_/i.exec(c.instrumentKey);
  console.log(c.apiUrl.replace(/\/+$/, ""), m ? m[1].toLowerCase() : "automate");
' "${CONFIG}") || die "config.json invalide."
NAME="${NAME:-${KEY_PREFIX}}"
[[ "${NAME}" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "Nom de service invalide : ${NAME} (minuscules, chiffres, tirets)."
DEST="/opt/lims-connector/${NAME}"
UNIT="lims-connector-${NAME}"

id lims-connector >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /opt/lims-connector --shell /usr/sbin/nologin lims-connector
install -d -m 0755 /opt/lims-connector
install -d -m 0750 -o root -g lims-connector "${DEST}"
install -d -m 0770 -o lims-connector -g lims-connector "${DEST}/donnees"
rm -rf "${DEST}/src.new" && cp -r "${SRC}/src" "${DEST}/src.new" && rm -rf "${DEST}/src" && mv "${DEST}/src.new" "${DEST}/src"
cp "${SRC}/package.json" "${DEST}/"
[ -f "${SRC}/README.md" ] && cp "${SRC}/README.md" "${DEST}/"
# La clé du connecteur est un secret : lisible par le service seulement.
install -m 0640 -o root -g lims-connector "${CONFIG}" "${DEST}/config.json"
# Chemins relatifs du dossier surveillé : résolus depuis le dossier d'installation.
node -e '
  const fs = require("fs"), p = process.argv[1], c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.dataDir = "donnees";
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
' "${DEST}/config.json"

# Certificat de l'autorité locale du laboratoire (serveur installé avec « Autorité locale »).
CA_FILE=""
HOST="$(printf '%s' "${API_URL}" | sed -E 's#^https?://([^/:]+).*#\1#')"
if [ -z "${CA}" ] && [[ "${API_URL}" == https://* ]]; then
    if curl -fsS --max-time 10 -o /dev/null "http://${HOST}/lims-ca.crt" 2>/dev/null; then CA="http://${HOST}/lims-ca.crt"; fi
fi
if [ -n "${CA}" ]; then
    CA_FILE="${DEST}/lims-ca.crt"
    if [[ "${CA}" =~ ^https?:// ]]; then curl -fsS --max-time 20 -o "${CA_FILE}" "${CA}" || die "Téléchargement du certificat impossible : ${CA}"
    else install -m 0644 "${CA}" "${CA_FILE}"; fi
    openssl x509 -in "${CA_FILE}" -noout >/dev/null 2>&1 || die "Le fichier ${CA} n'est pas un certificat."
    chmod 0644 "${CA_FILE}"
    say "Autorité locale : $(openssl x509 -in "${CA_FILE}" -noout -subject | sed 's/^subject=//')"
    say "Empreinte SHA-256 : $(openssl x509 -in "${CA_FILE}" -noout -fingerprint -sha256 | cut -d= -f2)"
    say "  → comparez-la à celle affichée sur le serveur par : sudo lims certificate show"
fi

cat > "/etc/systemd/system/${UNIT}.service" <<UNITFILE
[Unit]
Description=Connecteur d'automate du LIMS (${NAME})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lims-connector
Group=lims-connector
WorkingDirectory=${DEST}
ExecStart=$(command -v node) ${DEST}/src/index.mjs ${DEST}/config.json
${CA_FILE:+Environment=NODE_EXTRA_CA_CERTS=${CA_FILE}}
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${DEST}/donnees
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNITFILE

# Mode dossier : le dossier surveillé doit être accessible en écriture (archivage des fichiers transmis).
WATCH="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if (c.mode==="folder") console.log(require("path").resolve(process.argv[2], c.folder || "depot"))' "${DEST}/config.json" "${DEST}")"
if [ -n "${WATCH}" ]; then
    install -d -m 0770 -o lims-connector -g lims-connector "${WATCH}"
    sed -i "s#^ReadWritePaths=.*#ReadWritePaths=${DEST}/donnees ${WATCH}#" "/etc/systemd/system/${UNIT}.service"
    say "Dossier surveillé : ${WATCH} (l'automate ou son logiciel doit y déposer ses fichiers)"
fi

systemctl daemon-reload
systemctl enable "${UNIT}" >/dev/null 2>&1
systemctl restart "${UNIT}"
sleep 3
if systemctl is-active --quiet "${UNIT}"; then
    ok "Service ${UNIT} démarré (redémarrage automatique, au démarrage du poste aussi)."
else
    journalctl -u "${UNIT}" -n 20 --no-pager
    die "Le service ne démarre pas (voir ci-dessus)."
fi
journalctl -u "${UNIT}" -n 5 --no-pager -o cat 2>/dev/null | sed 's/^/  /'
say ""
say "Journal en direct : journalctl -fu ${UNIT}"
say "Fichiers          : ${DEST}/donnees (journaux du jour, file d'attente, archives)"
