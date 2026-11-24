# shellcheck shell=bash
# Versions installées, mise à jour et retour arrière. Requiert common.sh, migrate.sh, services.sh, backup.sh.
#
# Chaque version vit dans /opt/lims/releases/<version>-<date> ; « current » pointe sur celle en service.
# Une mise à jour : sauvegarde → dépaquetage → migrations → bascule du lien → redémarrage → contrôle ;
# en cas d'échec, l'ancien code et la base d'avant la mise à jour sont remis en place.

LIMS_KEEP_RELEASES="${LIMS_KEEP_RELEASES:-3}"

is_release_dir() {
    [ -f "$1/RELEASE.json" ] && [ -f "$1/apps/api/dist/main.js" ] && [ -d "$1/apps/web/dist" ]
}

release_field() {
    node -e 'try{const r=require(process.argv[1]);process.stdout.write(String(r[process.argv[2]]??""))}catch(e){process.exit(1)}' "$1/RELEASE.json" "$2" 2>/dev/null
}

current_release() {
    readlink -f "${LIMS_HOME}/current" 2>/dev/null || true
}

# Télécharge si besoin et vérifie une archive ; affiche le chemin local de l'archive.
# Source : fichier .tar.gz, URL https://…tar.gz, ou dossier de canal contenant latest.json.
fetch_release_archive() {
    local source="$1" dest sum expected base
    dest="$(mktemp -d /tmp/lims-release-XXXXXX)"
    case "${source}" in
        http://*|https://*)
            if [[ "${source}" != *.tar.gz ]]; then
                base="${source%/}"
                curl -fsSL --max-time 30 "${base}/latest.json" -o "${dest}/latest.json" \
                    || die "Canal de publication injoignable : ${base}/latest.json"
                local file
                file="$(node -e 'const l=require(process.argv[1]);process.stdout.write(l.file||"")' "${dest}/latest.json")"
                expected="$(node -e 'const l=require(process.argv[1]);process.stdout.write(l.sha256||"")' "${dest}/latest.json")"
                [ -n "${file}" ] || die "latest.json ne désigne aucune archive."
                source="${base}/${file}"
            fi
            info "Téléchargement de ${source}…" >&2
            curl -fsSL --retry 3 --max-time 1800 -o "${dest}/release.tar.gz" "${source}" >&2 \
                || die "Téléchargement impossible : ${source}"
            if [ -z "${expected:-}" ]; then
                expected="$(curl -fsSL --max-time 30 "${source}.sha256" 2>/dev/null | awk '{print $1}' || true)"
            fi
            ;;
        *)
            [ -f "${source}" ] || die "Archive introuvable : ${source}"
            cp "${source}" "${dest}/release.tar.gz"
            [ -f "${source}.sha256" ] && expected="$(awk '{print $1}' "${source}.sha256")"
            ;;
    esac
    sum="$(sha256sum "${dest}/release.tar.gz" | awk '{print $1}')"
    if [ -n "${expected:-}" ]; then
        [ "${sum}" = "${expected}" ] || die "Empreinte SHA-256 incorrecte : archive corrompue ou altérée (attendu ${expected}, obtenu ${sum})."
        success "Empreinte SHA-256 vérifiée." >&2
    else
        warning "Aucune empreinte .sha256 fournie : intégrité de l'archive non vérifiée." >&2
    fi
    printf '%s' "${dest}/release.tar.gz"
}

# Dépaquette une archive (ou copie un dossier de version) dans releases/ ; affiche le dossier créé.
unpack_release() {
    local source="$1" tmp inner version target
    tmp="$(mktemp -d /tmp/lims-unpack-XXXXXX)"
    if [ -d "${source}" ]; then
        is_release_dir "${source}" || die "${source} n'est pas une version construite (RELEASE.json absent)."
        cp -a "${source}" "${tmp}/release"
        inner="${tmp}/release"
    else
        tar --warning=no-timestamp -xzf "${source}" -C "${tmp}" || die "Archive illisible : ${source}"
        inner="$(find "${tmp}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    fi
    is_release_dir "${inner}" || die "L'archive ne contient pas une version du LIMS (RELEASE.json, apps/api/dist, apps/web/dist)."
    version="$(release_field "${inner}" version)"
    [ -n "${version}" ] || die "Version absente de RELEASE.json."
    target="${LIMS_HOME}/releases/${version}-$(date +%Y%m%d%H%M%S)"
    mv "${inner}" "${target}"
    rm -rf "${tmp}"
    chown -R root:root "${target}"
    chmod -R go-w "${target}"
    # Le compte de service lit le code mais n'y écrit pas.
    find "${target}" -type d -exec chmod 0755 {} +
    printf '%s' "${target}"
}

activate_release() {
    local target="$1"
    ln -sfn "${target}" "${LIMS_HOME}/current.tmp"
    mv -Tf "${LIMS_HOME}/current.tmp" "${LIMS_HOME}/current"
    ln -sfn "${LIMS_HOME}/current/scripts/lims" /usr/local/bin/lims
    chmod 0755 "${target}/scripts/lims" "${target}/scripts/setup.sh" 2>/dev/null || true
}

prune_releases() {
    local keep="${LIMS_KEEP_RELEASES}" current old
    current="$(current_release)"
    while read -r old; do
        [ -n "${old}" ] && [ "${old}" != "${current}" ] || continue
        rm -rf "${old}"
        info "Ancienne version supprimée : $(basename "${old}")"
    done < <(find "${LIMS_HOME}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk -v k="${keep}" 'NR > k {print $2}')
}

# Régénère la configuration système à partir de la version en service (services, Nginx).
reconfigure_system() {
    local host
    host="$(env_get LIMS_HOSTNAME)"
    write_systemd_units
    enable_services
    [ -n "${host}" ] && configure_https "${host}"
}

# Reconfiguration par les scripts de la version qui va tourner : c'est elle qui connaît son arborescence,
# ses unités systemd et sa configuration Nginx (une version plus ancienne ne peut pas les deviner).
reconfigure_with() {
    local release="$1"
    if [ -f "${release}/scripts/lims" ] && grep -q '^    reconfigure)' "${release}/scripts/lims"; then
        LIMS_HOME="${LIMS_HOME}" LIMS_OP_LOG="${LIMS_OP_LOG:-}" bash "${release}/scripts/lims" reconfigure
    else
        reconfigure_system
    fi
}

# --- Mise à jour ---------------------------------------------------------------

lims_update() {
    local source="" force=0 yes=0 archive target previous new_version old_version started dump schema_changed=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --source) source="$2"; shift ;;
            --source=*) source="${1#*=}" ;;
            --force) force=1 ;;
            -y|--yes) yes=1 ;;
            *) die "Option inconnue : $1 (voir lims help)" ;;
        esac
        shift
    done
    started="$(date +%s)"
    LIMS_OP_LOG="${LIMS_LOGS}/update-$(date +%Y%m%d-%H%M%S).log"; export LIMS_OP_LOG
    header "Mise à jour du LIMS"
    if [ -z "${source}" ]; then
        source="$(sed -n 's/^UPDATE_URL=//p' "${LIMS_STATE}/update.conf" 2>/dev/null | tail -n 1)"
        [ -n "${source}" ] || die "Indiquez la nouvelle version : lims update --source /chemin/lims-x.y.z.tar.gz (ou une adresse https). Pour une source permanente : lims update-source <url>"
    fi
    previous="$(current_release)"
    old_version="$(app_version "${previous}" || echo "?")"

    archive="$(fetch_release_archive "${source}")"
    target="$(unpack_release "${archive}")"
    rm -rf "$(dirname "${archive}")"
    new_version="$(release_field "${target}" version)"
    local c_old c_new
    c_old="$(app_commit "${previous}" || true)"; c_new="$(release_field "${target}" commit)"
    info "Version en service : ${old_version}${c_old:+ (${c_old})} → nouvelle : ${new_version}${c_new:+ (${c_new})}"
    if [ "${force}" -eq 0 ] && [ -n "${previous}" ] && [ "$(release_field "${previous}" version)" = "${new_version}" ] \
        && [ "$(release_field "${previous}" commit)" = "$(release_field "${target}" commit)" ] \
        && [ "$(release_field "${previous}" builtAt)" = "$(release_field "${target}" builtAt)" ]; then
        rm -rf "${target}"
        success "Déjà à jour (version ${new_version})."
        return 0
    fi
    if [ "${yes}" -eq 0 ] && ! confirm "Le LIMS sera indisponible quelques minutes. Continuer ?" O; then
        rm -rf "${target}"
        die "Mise à jour annulée."
    fi

    info "Sauvegarde avant mise à jour…"
    dump="$(backup_database "avant-maj-v${new_version}")" || { rm -rf "${target}"; die "La sauvegarde a échoué : mise à jour annulée, rien n'a été modifié."; }
    migrations_status "${target}" >/dev/null
    [ "${#MIGRATIONS_PENDING[@]}" -gt 0 ] && schema_changed=1
    printf '{"at":"%s","from":"%s","to":"%s","dump":"%s","schemaChanged":%s}\n' "$(date -Is)" "${previous}" "${target}" "${dump}" \
        "$([ "${schema_changed}" -eq 1 ] && echo true || echo false)" > "${LIMS_STATE}/pending-update.json"
    api_stop || true
    if ! migrations_apply "${target}"; then
        error "Échec des migrations : retour à la version ${old_version}."
        restore_dump_file "${dump}" >/dev/null
        api_start || true
        rm -rf "${target}" "${LIMS_STATE}/pending-update.json"
        update_summary "${started}" "Échec de la mise à jour (base restaurée, version ${old_version} conservée)"
        return 1
    fi

    activate_release "${target}"
    reconfigure_with "${target}"
    api_restart
    local served
    if served="$(wait_for_api 90)" && [ "${served}" = "${new_version}" ]; then
        mv -f "${LIMS_STATE}/pending-update.json" "${LIMS_STATE}/last-update.json"
        prune_releases
        success "Version ${new_version} en service."
        update_summary "${started}" "Mise à jour réussie : ${old_version} → ${new_version}"
        post_check
        return 0
    fi

    error "La nouvelle version ne répond pas : retour automatique à ${old_version}."
    journalctl -u "${API_UNIT}" -n 30 --no-pager 2>/dev/null | tail -n 30 >> "${LIMS_OP_LOG}" || true
    if [ -n "${previous}" ]; then
        if [ "${schema_changed}" -eq 1 ]; then
            api_stop || true
            restore_dump_file "${dump}" >/dev/null
        fi
        activate_release "${previous}"
        reconfigure_with "${previous}"
        api_restart
        wait_for_api 60 >/dev/null || warning "L'ancienne version ne répond pas non plus : sudo lims doctor"
    fi
    rm -rf "${target}" "${LIMS_STATE}/pending-update.json"
    update_summary "${started}" "Échec de la mise à jour (retour à ${old_version}) — journal : ${LIMS_OP_LOG}"
    return 1
}

update_summary() {
    local started="$1" message="$2"
    log_action "${message}"
    header "Résumé"
    say "${message}"
    say "Durée totale : $(( $(date +%s) - started )) s"
}

post_check() {
    header "Vérification après mise à jour"
    lims_check --quiet || true
}

# Retour à la version précédente. Si la dernière mise à jour a modifié le schéma, l'ancienne version ne
# fonctionne qu'avec la base d'avant : celle-ci est alors restaurée (les saisies faites depuis sont perdues).
lims_rollback() {
    local yes=0 from dump current schema_changed
    [ "${1:-}" = "--yes" ] && yes=1
    [ -f "${LIMS_STATE}/last-update.json" ] || die "Aucune mise à jour enregistrée : rien à annuler."
    from="$(json_read "${LIMS_STATE}/last-update.json" from)"
    dump="$(json_read "${LIMS_STATE}/last-update.json" dump)"
    schema_changed="$(json_read "${LIMS_STATE}/last-update.json" schemaChanged)"
    current="$(current_release)"
    if [ -z "${from}" ] || [ ! -d "${from}" ]; then die "La version précédente n'est plus sur le disque."; fi
    [ "${from}" != "${current}" ] || die "La version précédente est déjà en service."
    LIMS_OP_LOG="${LIMS_LOGS}/rollback-$(date +%Y%m%d-%H%M%S).log"; export LIMS_OP_LOG
    header "Retour à la version $(app_version "${from}")"
    if [ "${schema_changed}" = "true" ]; then
        warning "La mise à jour avait modifié la base : elle sera restaurée depuis ${dump##*/}."
        warning "Les données saisies depuis la mise à jour seront PERDUES (une copie de sécurité est prise avant)."
    fi
    if [ "${yes}" -eq 0 ] && ! confirm "Revenir à $(basename "${from}") ?" N; then die "Retour arrière annulé."; fi
    api_stop || true
    if [ "${schema_changed}" = "true" ]; then
        backup_database avant-retour-arriere >/dev/null || die "Copie de sécurité impossible : retour arrière annulé."
        restore_dump_file "${dump}"
    fi
    activate_release "${from}"
    reconfigure_with "${from}"
    api_restart
    if wait_for_api 60 >/dev/null; then
        rm -f "${LIMS_STATE}/last-update.json"
        success "Version $(app_version "${from}") de nouveau en service."
    else
        die "La version précédente ne répond pas : sudo lims doctor"
    fi
}
