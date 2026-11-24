# shellcheck shell=bash
# lims check (l'installation peut-elle fonctionner ?), lims health (va-t-elle bien maintenant ?),
# lims doctor (pourquoi le site ne s'ouvre pas, et réparations sûres). Requiert les autres bibliothèques.

CHECK_PASS=0; CHECK_WARN=0; CHECK_FAIL=0; CHECK_SKIP=0; CHECK_QUIET=0

_check_line() {
    local word="$1" color="$2" label="$3" detail="$4" fix="${5:-}"
    if [ "${CHECK_QUIET}" -eq 1 ] && { [ "${word}" = "PASS" ] || [ "${word}" = "SKIP" ]; }; then return 0; fi
    printf '%s%-4s%s  %s' "${color}" "${word}" "${C_RESET}" "${label}"
    [ -n "${detail}" ] && printf ' — %s' "${detail}"
    printf '\n'
    [ -n "${fix}" ] && printf '        → %s\n' "${fix}"
    return 0
}
pass() { CHECK_PASS=$((CHECK_PASS + 1)); _check_line PASS "${C_GREEN}" "$1" "${2:-}"; }
warn() { CHECK_WARN=$((CHECK_WARN + 1)); _check_line WARN "${C_YELLOW}" "$1" "${2:-}" "${3:-}"; }
fail() { CHECK_FAIL=$((CHECK_FAIL + 1)); _check_line FAIL "${C_RED}" "$1" "${2:-}" "${3:-}"; }
skip() { CHECK_SKIP=$((CHECK_SKIP + 1)); _check_line SKIP "${C_DIM}" "$1" "${2:-}"; }

lims_check() {
    [ "${1:-}" = "--quiet" ] && CHECK_QUIET=1
    CHECK_PASS=0; CHECK_WARN=0; CHECK_FAIL=0; CHECK_SKIP=0
    local cur version node req pct line url status served days

    header "Vérification de l'installation"
    # Système
    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        if [ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID%%.*}" -ge 24 ]; then pass "Système" "${PRETTY_NAME}"
        else warn "Système" "${PRETTY_NAME:-inconnu} (Ubuntu 24.04 LTS ou plus récent recommandé)"; fi
    fi
    node="$(node_major)"
    if [ "${node}" -ge "${LIMS_NODE_MAJOR}" ]; then pass "Node.js" "$(node -v)"
    else fail "Node.js" "version ${node} (${LIMS_NODE_MAJOR} requise)" "sudo bash ${LIMS_HOME}/current/scripts/setup.sh"; fi

    # Code
    cur="$(current_release)"
    if [ -n "${cur}" ] && is_release_dir "${cur}"; then
        version="$(release_field "${cur}" version)"
        pass "Version en service" "v${version}$( [ -n "$(release_field "${cur}" commit)" ] && printf ' (%s)' "$(release_field "${cur}" commit)") — $(basename "${cur}")"
        req="$(release_field "${cur}" node | tr -dc '0-9')"
        [ -n "${req}" ] && [ "${node}" -lt "${req}" ] && fail "Node.js pour cette version" "Node ${req} requis" "sudo bash ${cur}/scripts/setup.sh"
    else
        fail "Version en service" "lien ${LIMS_HOME}/current absent ou incomplet" "sudo lims update --source <archive>"
    fi

    # Configuration
    if [ ! -f "${LIMS_ENV_FILE}" ]; then
        fail "Configuration" "${LIMS_ENV_FILE} absent" "sudo bash ${cur:-.}/scripts/setup.sh"
    else
        local perms owner missing=() key
        perms="$(stat -c %a "${LIMS_ENV_FILE}")"; owner="$(stat -c %U:%G "${LIMS_ENV_FILE}")"
        for key in DATABASE_URL JWT_ACCESS_SECRET INTEROP_SECRET_KEY CORS_ORIGINS; do [ -n "$(env_get "${key}")" ] || missing+=("${key}"); done
        if [ "${#missing[@]}" -gt 0 ]; then fail "Configuration" "variables manquantes : ${missing[*]}" "sudo bash ${cur}/scripts/setup.sh"
        elif [ "${perms}" != "640" ] || [ "${owner}" != "root:${LIMS_USER}" ]; then warn "Configuration" "droits ${perms} ${owner} (attendu 640 root:${LIMS_USER})" "sudo chown root:${LIMS_USER} ${LIMS_ENV_FILE} && sudo chmod 640 ${LIMS_ENV_FILE}"
        else pass "Configuration" "${LIMS_ENV_FILE} (640 root:${LIMS_USER})"; fi
        [ "$(env_get NODE_ENV)" = "production" ] && [ "$(env_get COOKIE_SECURE)" = "true" ] \
            && pass "Mode production" "cookies sécurisés, HTTPS" || warn "Mode production" "NODE_ENV=$(env_get NODE_ENV), COOKIE_SECURE=$(env_get COOKIE_SECURE)" "éditez ${LIMS_ENV_FILE} puis sudo systemctl restart lims-api"
        [ "$(env_get JWT_ACCESS_SECRET | wc -c)" -ge 33 ] && pass "Secret des jetons" "longueur suffisante" || fail "Secret des jetons" "JWT_ACCESS_SECRET trop court" "générez-en un : openssl rand -hex 48"
        [[ "$(env_get INTEROP_SECRET_KEY)" =~ ^[0-9a-fA-F]{64}$ ]] && pass "Clé de chiffrement des secrets" "INTEROP_SECRET_KEY (256 bits)" || warn "Clé de chiffrement des secrets" "INTEROP_SECRET_KEY absente ou mal formée"
    fi

    # Base de données
    if pg_isready -q 2>/dev/null; then pass "PostgreSQL" "$(psql_admin postgres -tAc 'SHOW server_version' 2>/dev/null | cut -d' ' -f1)"
    else fail "PostgreSQL" "ne répond pas" "sudo lims doctor"; fi
    if pg_isready -q 2>/dev/null && db_exists; then
        url="$(env_get DATABASE_URL)"
        if [ -n "${url}" ] && psql "${url%%\?*}" -X -tAc 'SELECT 1' >/dev/null 2>&1; then pass "Connexion de l'application" "rôle ${LIMS_DB_APP}"
        else fail "Connexion de l'application" "le rôle ${LIMS_DB_APP} ne peut pas se connecter" "sudo bash ${cur}/scripts/setup.sh"; fi
        line="$(migrations_status "${cur}")"
        # shellcheck disable=SC2086
        set -- ${line}
        if [ "$4" -gt 0 ]; then fail "Migrations" "en échec : ${MIGRATIONS_FAILED[*]}" "sudo lims restore (sauvegarde d'avant la mise à jour)"
        elif [ "$3" -gt 0 ]; then fail "Migrations" "modifiées depuis leur application : ${MIGRATIONS_CHANGED[*]}" "contactez le support"
        elif [ "$2" -gt 0 ]; then fail "Migrations" "$2 en attente (${MIGRATIONS_PENDING[*]})" "sudo lims migrate"
        else pass "Migrations" "$1 appliquée(s), schéma à jour"; fi
        local super owner_tables
        super="$(psql_admin postgres -tAc "SELECT rolsuper FROM pg_roles WHERE rolname = '${LIMS_DB_APP}'" 2>/dev/null)"
        owner_tables="$(psql_admin "${LIMS_DB}" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner = '${LIMS_DB_APP}'" 2>/dev/null)"
        if [ "${super}" = "f" ] && [ "${owner_tables:-1}" = "0" ]; then pass "Protection de l'audit" "le rôle applicatif ne peut ni modifier le schéma ni désactiver les triggers"
        else fail "Protection de l'audit" "le rôle ${LIMS_DB_APP} est superutilisateur ou propriétaire de tables" "sudo lims migrate (réapplique les droits)"; fi
    elif pg_isready -q 2>/dev/null; then
        fail "Base de données" "${LIMS_DB} absente" "sudo bash ${cur}/scripts/setup.sh"
    fi

    # Services
    if is_systemd; then
        systemctl is-active --quiet lims-api && pass "Service lims-api" "actif" || fail "Service lims-api" "arrêté" "sudo lims doctor"
        status="$(curl -fsS --max-time 5 "http://127.0.0.1:${LIMS_API_PORT}/api/health" 2>/dev/null || true)"
        served="$(printf '%s' "${status}" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
        if [ -z "${status}" ]; then fail "API" "ne répond pas sur 127.0.0.1:${LIMS_API_PORT}" "sudo lims doctor"
        elif [ -n "${version:-}" ] && [ "${served}" != "${version}" ]; then warn "API" "sert v${served}, code v${version}" "sudo systemctl restart lims-api"
        else pass "API" "répond (v${served})"; fi
        systemctl is-active --quiet nginx && pass "Nginx" "actif" || fail "Nginx" "arrêté" "sudo lims doctor"
        local t missing_timers=()
        for t in lims-backup.timer lims-housekeeping.timer lims-health.timer; do systemctl is-active --quiet "${t}" || missing_timers+=("${t}"); done
        [ "${#missing_timers[@]}" -eq 0 ] && pass "Tâches planifiées" "sauvegarde, entretien, santé" || fail "Tâches planifiées" "inactives : ${missing_timers[*]}" "sudo systemctl enable --now ${missing_timers[*]}"
        if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = "yes" ]; then pass "Heure synchronisée" "$(timedatectl show -p Timezone --value)"
        else warn "Heure synchronisée" "non (l'horodatage de l'audit en dépend)" "sudo systemctl enable --now chrony"; fi
    else
        skip "Services systemd" "systemd absent (conteneur ?)"
    fi
    if command -v nginx >/dev/null 2>&1; then
        nginx -t >/dev/null 2>&1 && pass "Configuration Nginx" "valide" || fail "Configuration Nginx" "invalide" "sudo nginx -t"
    fi
    if days="$(cert_days_left)"; then
        if [ "${days}" -lt 0 ]; then fail "Certificat HTTPS" "expiré" "sudo lims certificate renew"
        elif [ "${days}" -lt 30 ]; then warn "Certificat HTTPS" "expire dans ${days} jours" "sudo lims certificate renew"
        else pass "Certificat HTTPS" "valable encore ${days} jours ($(env_get LIMS_TLS_MODE || echo local))"; fi
    else
        skip "Certificat HTTPS" "aucun certificat trouvé"
    fi

    # Espace disque
    for line in / "${LIMS_HOME}"; do
        pct="$(df -P "${line}" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
        [ -n "${pct}" ] || continue
        if [ "${pct}" -ge 95 ]; then fail "Espace disque ${line}" "${pct} % utilisés" "sudo lims housekeeping"
        elif [ "${pct}" -ge 85 ]; then warn "Espace disque ${line}" "${pct} % utilisés" "sudo lims housekeeping"
        else pass "Espace disque ${line}" "${pct} % utilisés"; fi
    done

    # Sauvegardes
    local f="${LIMS_STATE}/last-local-backup.json" age
    if [ -f "${f}" ] && [ "$(json_read "${f}" ok)" = "true" ]; then
        age="$(file_age_hours "${f}")"
        [ "${age}" -le 12 ] && pass "Sauvegarde locale" "il y a ${age} h" || warn "Sauvegarde locale" "dernière il y a ${age} h" "sudo lims backup"
    else
        warn "Sauvegarde locale" "aucune sauvegarde réussie" "sudo lims backup"
    fi
    if offsite_enabled; then
        f="${LIMS_STATE}/last-offsite.json"
        if [ -f "${f}" ] && [ "$(json_read "${f}" ok)" = "true" ] && [ "$(file_age_hours "${f}")" -le 24 ]; then pass "Sauvegarde hors machine" "$(json_read "${f}" dest), il y a $(file_age_hours "${f}") h"
        else warn "Sauvegarde hors machine" "pas de copie réussie depuis 24 h ($(offsite_describe))" "lims backup test"; fi
        if [ -s "$(BACKUP_KEY)" ] && [ "$(stat -c '%a %U' "$(BACKUP_KEY)")" = "600 root" ]; then pass "Chiffrement des copies hors machine" "AES-256, clé présente (à noter hors du serveur : sudo lims backup key)"
        else fail "Chiffrement des copies hors machine" "clé de sauvegarde absente ou mal protégée" "sudo lims backup setup"; fi
    else
        warn "Sauvegarde hors machine" "non configurée" "lims backup setup"
    fi

    # Premier démarrage
    if [ -n "${cur}" ] && [ -f "${LIMS_ENV_FILE}" ]; then
        local st
        st="$(cli_run status 2>/dev/null || true)"
        if printf '%s' "${st}" | grep -q '"needsSetup":true'; then
            warn "Assistant d'installation" "pas encore terminé" "ouvrez https://$(env_get LIMS_HOSTNAME)/ (code : sudo lims setup-token)"
        elif [ -n "${st}" ]; then
            pass "Assistant d'installation" "terminé — $(printf '%s' "${st}" | sed -n 's/.*"lab":"\([^"]*\)".*/\1/p')"
        fi
    fi

    printf '\n%s réussi(s), %s avertissement(s), %s échec(s), %s ignoré(s)\n' "${CHECK_PASS}" "${CHECK_WARN}" "${CHECK_FAIL}" "${CHECK_SKIP}"
    [ "${CHECK_FAIL}" -eq 0 ]
}

# Commande d'exploitation Node (dist/cli.js) avec la configuration du serveur.
cli_run() {
    ( load_env "${LIMS_ENV_FILE}" && cd "${LIMS_HOME}/current/apps/api" && node dist/cli.js "$@" )
}

lims_health() {
    local quiet=0 problems=() pct ms f t0 t1
    [ "${1:-}" = "--quiet" ] && quiet=1
    pct="$(df -P "${LIMS_HOME}" | awk 'NR==2 {gsub("%","",$5); print $5}')"
    [ "${pct}" -ge 90 ] && problems+=("disque plein à ${pct} %")
    t0="$(date +%s%N)"
    if psql_admin "${LIMS_DB}" -tAc 'SELECT 1' >/dev/null 2>&1; then
        t1="$(date +%s%N)"; ms=$(( (t1 - t0) / 1000000 ))
        [ "${ms}" -gt 2000 ] && problems+=("PostgreSQL lent (${ms} ms)")
    else
        problems+=("PostgreSQL ne répond pas"); ms=-1
    fi
    curl -fsS --max-time 5 "http://127.0.0.1:${LIMS_API_PORT}/api/health" >/dev/null 2>&1 || problems+=("l'API ne répond pas")
    f="${LIMS_STATE}/last-local-backup.json"
    { [ -f "${f}" ] && [ "$(json_read "${f}" ok)" = "true" ] && [ "$(file_age_hours "${f}")" -le 12 ]; } || problems+=("pas de sauvegarde locale réussie depuis 12 h")
    if offsite_enabled; then
        f="${LIMS_STATE}/last-offsite.json"
        { [ -f "${f}" ] && [ "$(json_read "${f}" ok)" = "true" ] && [ "$(file_age_hours "${f}")" -le 24 ]; } || problems+=("pas de copie hors machine réussie depuis 24 h")
    fi
    json_state "${LIMS_STATE}/health.json" at="$(date -Is)" ok="$([ "${#problems[@]}" -eq 0 ] && echo true || echo false)" disk="${pct}" dbMs="${ms}" problems="$(IFS=';'; echo "${problems[*]}")"
    if [ "${#problems[@]}" -eq 0 ]; then
        [ "${quiet}" -eq 1 ] || success "Tout va bien : disque ${pct} %, PostgreSQL ${ms} ms, API, sauvegardes."
        return 0
    fi
    for t in "${problems[@]}"; do
        if [ "${quiet}" -eq 1 ]; then logger -t lims-health "${t}" 2>/dev/null || true; fi
        warning "${t}"
    done
    return 1
}

# Pourquoi le site ne s'ouvre pas ? Diagnostic et réparations sûres (--check : constat seul ; --yes : tout réparer).
lims_doctor() {
    local mode="ask" report fixes=0
    case "${1:-}" in --check) mode=check ;; --yes|-y) mode=yes ;; esac
    report="/var/log/lims-doctor-$(date +%Y%m%d-%H%M%S).log"
    header "Diagnostic du LIMS"
    exec 3>&1
    {
        repair() {
            local what="$1"; shift
            if [ "${mode}" = "check" ]; then say "   Réparation possible : ${what}"; return 1; fi
            if [ "${mode}" = "ask" ] && ! confirm "   Réparer : ${what} ?" O; then return 1; fi
            "$@" && { success "   ${what} : fait."; fixes=$((fixes + 1)); }
        }
        local pct
        pct="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"
        if [ "${pct}" -ge 98 ]; then
            error "Disque plein (${pct} %) : PostgreSQL et Nginx ne peuvent plus écrire."
            repair "purger journaux et anciennes sauvegardes" lims_housekeeping
        fi
        if [ -f "${LIMS_ENV_FILE}" ] && [ "$(stat -c '%a %U:%G' "${LIMS_ENV_FILE}")" != "640 root:${LIMS_USER}" ]; then
            error "Le fichier de configuration ${LIMS_ENV_FILE} est mal protégé ($(stat -c '%a %U:%G' "${LIMS_ENV_FILE}")) : il contient les secrets."
            repair "rétablir les droits de ${LIMS_ENV_FILE} (640 root:${LIMS_USER})" sh -c "chown root:${LIMS_USER} '${LIMS_ENV_FILE}' && chmod 0640 '${LIMS_ENV_FILE}'"
        fi
        if [ ! -x /usr/local/bin/lims ]; then
            error "La commande « lims » n'est plus installée."
            repair "réinstaller la commande lims" ln -sfn "${LIMS_HOME}/current/scripts/lims" /usr/local/bin/lims
        fi
        if ! pg_isready -q 2>/dev/null; then
            error "PostgreSQL ne répond pas."
            journalctl -u 'postgresql*' -n 15 --no-pager 2>/dev/null | sed 's/^/   /'
            repair "redémarrer PostgreSQL" systemctl restart postgresql && sleep 3
        else
            success "PostgreSQL répond."
        fi
        if is_systemd && ! systemctl is-active --quiet lims-api; then
            error "Le service lims-api est arrêté."
            # Seules les lignes d'erreur du dernier démarrage : le journal complet est dans le rapport de journalctl.
            journalctl -u lims-api -n 200 --no-pager 2>/dev/null | grep -iE 'erreur|error|invalide|refus|fatal|EADDRINUSE|ECONNREFUSED' | tail -n 8 | sed 's/^/   /'
            repair "redémarrer l'API" systemctl restart lims-api
        fi
        if ! wait_for_api 20 >/dev/null; then
            error "L'API ne répond pas sur 127.0.0.1:${LIMS_API_PORT}."
            journalctl -u lims-api -n 25 --no-pager 2>/dev/null | grep -iE 'erreur|error|invalide|refus' | tail -n 8 | sed 's/^/   /'
            migrations_status >/dev/null 2>&1 && [ "${#MIGRATIONS_PENDING[@]}" -gt 0 ] && repair "appliquer ${#MIGRATIONS_PENDING[@]} migration(s) en attente" migrations_apply
            repair "redémarrer l'API" systemctl restart lims-api
        else
            success "L'API répond."
        fi
        if ! nginx -t >/dev/null 2>&1; then
            error "Configuration Nginx invalide :"; nginx -t 2>&1 | sed 's/^/   /'
            repair "régénérer la configuration Nginx du LIMS" configure_https "$(env_get LIMS_HOSTNAME)"
        elif is_systemd && ! systemctl is-active --quiet nginx; then
            error "Nginx est arrêté."
            repair "démarrer Nginx" systemctl restart nginx
        else
            success "Nginx fonctionne."
        fi
        local code
        code="$(curl -ks -o /dev/null -w '%{http_code}' --max-time 10 https://127.0.0.1/api/health || echo 000)"
        if [ "${code}" = "200" ]; then success "Le site répond en HTTPS (https://$(env_get LIMS_HOSTNAME)/)."
        else error "Le site ne répond pas en HTTPS (code ${code})."; fi
        local days
        if days="$(cert_days_left)" && [ "${days}" -lt 0 ]; then
            error "Certificat HTTPS expiré."
            repair "renouveler le certificat" configure_https "$(env_get LIMS_HOSTNAME)"
        fi
    } 2>&1 | tee "${report}" >&3
    exec 3>&-
    chmod 0600 "${report}"
    say ""
    say "Rapport complet : ${report}"
    if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
        local home; home="$(getent passwd "${SUDO_USER}" | cut -d: -f6)"
        sed -E 's#(postgresql://[^:]+:)[^@]+@#\1***@#g' "${report}" > "${home}/site-report.txt" && chown "${SUDO_USER}" "${home}/site-report.txt"
        say "Copie (sans mots de passe) pour le support : ${home}/site-report.txt"
    fi
}

lims_housekeeping() {
    LIMS_OP_LOG="${LIMS_LOGS}/housekeeping.log"; export LIMS_OP_LOG
    prune_local_backups
    find "${LIMS_LOGS}" -type f -name '*.log' -mtime +90 -delete 2>/dev/null || true
    find /var/log -maxdepth 1 -name 'lims-*.log' -mtime +90 -delete 2>/dev/null || true
    find /tmp -maxdepth 1 \( -name 'lims-release-*' -o -name 'lims-unpack-*' \) -mtime +2 -exec rm -rf {} + 2>/dev/null || true
    is_systemd && journalctl --vacuum-time=60d >/dev/null 2>&1 || true
    psql_owner -c 'ANALYZE' >/dev/null 2>&1 || true
    log_action "Entretien effectué"
    return 0
}
