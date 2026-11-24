# shellcheck shell=bash
# Sauvegardes : locales (pg_dump vérifié + configuration) et hors machine (autre machine Linux par SSH,
# dossier partagé Windows, clé ou disque USB). Restauration. Requiert common.sh, db-roles.sh, migrate.sh.

LIMS_BACKUP_DAYS="${LIMS_BACKUP_DAYS:-30}"
LIMS_BACKUP_KEEP_MIN="${LIMS_BACKUP_KEEP_MIN:-8}"
BACKUP_CONF() { printf '%s/backup.conf' "${LIMS_STATE}"; }
SSH_KEY=/root/.ssh/lims_backup_ed25519
CIFS_CREDENTIALS=/root/.lims-cifs-credentials
OFFSITE_MOUNT=/mnt/lims-offsite

conf_get() { sed -n "s/^$1=//p" "$(BACKUP_CONF)" 2>/dev/null | tail -n 1; }

# --- Clé de sauvegarde ------------------------------------------------------------------
# Les copies hors machine contiennent des données de patients ET le fichier .env (clé INTEROP_SECRET_KEY,
# secret des jetons) : elles quittent le serveur chiffrées (AES-256, gpg symétrique). La clé reste sur le
# serveur (0600 root) et doit AUSSI être notée hors du serveur : sans elle, une copie hors machine est illisible.
BACKUP_KEY() { printf '%s/backup.key' "${LIMS_STATE}"; }

# Crée la clé si besoin ; affiche 1 si elle vient d'être créée.
backup_key_ensure() {
    if [ -s "$(BACKUP_KEY)" ]; then printf '0'; return 0; fi
    umask 077
    # Groupes de 4 caractères sans ambiguïté : facile à recopier à la main.
    random_password 32 | sed 's/.\{4\}/&-/g; s/-$//' > "$(BACKUP_KEY)"
    umask 022
    chmod 0600 "$(BACKUP_KEY)"
    log_action "Clé de sauvegarde créée"
    printf '1'
}

backup_key_show() {
    [ -s "$(BACKUP_KEY)" ] || die "Aucune clé de sauvegarde sur ce serveur (elle est créée par : lims backup setup)."
    say "Clé de sauvegarde : ${C_BOLD}$(cat "$(BACKUP_KEY)")${C_RESET}"
    say "À conserver HORS du serveur (registre du laboratoire, enveloppe scellée, coffre-fort de mots de passe)."
    say "Elle est demandée pour restaurer une copie hors machine sur un autre serveur."
}

# Demande la clé (nouveau serveur qui reprend les sauvegardes d'un autre) et la conserve.
backup_key_prompt() {
    local key
    [ -s "$(BACKUP_KEY)" ] && return 0
    [ -t 0 ] || die "Copie chiffrée : la clé de sauvegarde est nécessaire. Créez $(BACKUP_KEY) (0600) avec la clé, ou relancez la commande dans un terminal."
    # Sur la sortie d'erreur : cette fonction est appelée dans une substitution qui capture la sortie standard.
    say "Les copies hors machine sont chiffrées. Saisissez la clé de sauvegarde de l'ancien serveur" >&2
    say "(affichée lors de « lims backup setup », retrouvable sur l'ancien serveur par « sudo lims backup key »)." >&2
    read -r -s -p "Clé de sauvegarde : " key; echo >&2
    key="$(printf '%s' "${key}" | tr -d '[:space:]')"
    # Clé saisie sans les tirets : on rétablit les groupes de 4 caractères.
    if [[ "${key}" != *-* ]] && [ "${#key}" -eq 32 ]; then key="$(printf '%s' "${key}" | sed 's/.\{4\}/&-/g; s/-$//')"; fi
    [ -n "${key}" ] || die "Clé vide : restauration annulée."
    umask 077; printf '%s\n' "${key}" > "$(BACKUP_KEY)"; umask 022
    chmod 0600 "$(BACKUP_KEY)"
    KEY_PROMPTED=1
}

encrypt_file() {
    # encrypt_file source cible.gpg
    gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$(BACKUP_KEY)" \
        --symmetric --cipher-algo AES256 --compress-algo none -o "$2.part" "$1" 2>> "${LIMS_OP_LOG:-/dev/null}" \
        && mv "$2.part" "$2" || { rm -f "$2.part"; return 1; }
}

decrypt_file() {
    # decrypt_file source.gpg cible — échoue si la clé est fausse ou la copie altérée (intégrité MDC).
    gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$(BACKUP_KEY)" \
        -o "$2.part" --decrypt "$1" 2>> "${LIMS_OP_LOG:-/dev/null}" \
        && mv "$2.part" "$2" || { rm -f "$2.part"; return 1; }
}

# Prépare les copies chiffrées des sauvegardes locales (dossier offsite/), retire celles dont l'original a été purgé.
offsite_stage() {
    local kind src name stage
    backup_key_ensure >/dev/null
    for kind in db config; do
        stage="${LIMS_BACKUPS}/offsite/${kind}"
        install -d -m 0700 "${stage}"
        for src in "${LIMS_BACKUPS}/${kind}"/*.dump "${LIMS_BACKUPS}/${kind}"/*.tar.gz; do
            [ -f "${src}" ] || continue
            name="$(basename "${src}")"
            if [ ! -f "${stage}/${name}.gpg" ]; then
                encrypt_file "${src}" "${stage}/${name}.gpg" || { error "Chiffrement impossible : ${name}"; return 1; }
            fi
            # Empreinte du contenu en clair : vérifiée après déchiffrement lors d'une restauration.
            [ -f "${src}.sha256" ] && cp -p "${src}.sha256" "${stage}/${name}.sha256"
        done
        for src in "${stage}"/*.gpg; do
            [ -f "${src}" ] || continue
            name="$(basename "${src}" .gpg)"
            [ -f "${LIMS_BACKUPS}/${kind}/${name}" ] || rm -f "${src}" "${stage}/${name}.sha256"
        done
    done
}

json_state() {
    # json_state fichier clé=valeur… (valeurs texte, échappement minimal)
    local file="$1"; shift
    local out="{" first=1 kv k v
    for kv in "$@"; do
        k="${kv%%=*}"; v="${kv#*=}"
        v="${v//\\/\\\\}"; v="${v//\"/\\\"}"
        [ "${first}" -eq 1 ] || out="${out},"
        out="${out}\"${k}\":\"${v}\""; first=0
    done
    printf '%s}\n' "${out}" > "${file}"
}

json_read() {
    node -e 'try{process.stdout.write(String(require(process.argv[1])[process.argv[2]]??""))}catch(e){}' "$1" "$2" 2>/dev/null
}

# --- Sauvegarde locale -----------------------------------------------------------

# Sauvegarde la base (format personnalisé pg_dump, vérifié) et la configuration ; affiche le chemin du dump.
backup_database() {
    local label="${1:-auto}" ts version file conf
    ts="$(date +%Y%m%d-%H%M%S)"
    version="$(app_version || echo inconnue)"
    # Le nom de la machine figure dans le nom : après un déménagement, on distingue l'ancien serveur du nouveau.
    file="${LIMS_BACKUPS}/db/${LIMS_DB}-$(hostname -s)-${ts}-v${version}-${label}.dump"
    install -d -m 0700 "${LIMS_BACKUPS}/db" "${LIMS_BACKUPS}/config"
    if ! pg_admin_tool pg_dump --format=custom --compress=6 --dbname="$(admin_dsn "${LIMS_DB}")" > "${file}.part" 2>> "${LIMS_OP_LOG:-/dev/null}"; then
        rm -f "${file}.part"
        json_state "${LIMS_STATE}/last-local-backup.json" at="$(date -Is)" ok=false message="pg_dump a échoué"
        error "La sauvegarde locale n'a pas abouti (pg_dump). PostgreSQL fonctionne-t-il ? sudo lims doctor"
        return 1
    fi
    if ! pg_restore --list "${file}.part" >/dev/null 2>&1; then
        rm -f "${file}.part"
        json_state "${LIMS_STATE}/last-local-backup.json" at="$(date -Is)" ok=false message="archive illisible"
        error "La sauvegarde produite est illisible : elle a été supprimée."
        return 1
    fi
    mv "${file}.part" "${file}"
    (cd "$(dirname "${file}")" && sha256sum "$(basename "${file}")" > "$(basename "${file}").sha256")
    conf="${LIMS_BACKUPS}/config/config-${ts}.tar.gz"
    tar -czf "${conf}" -C "${LIMS_SHARED}" .env tls 2>/dev/null || tar -czf "${conf}" -C "${LIMS_SHARED}" .env
    chmod 0600 "${file}" "${file}.sha256" "${conf}"
    json_state "${LIMS_STATE}/last-local-backup.json" at="$(date -Is)" ok=true file="${file}" size="$(stat -c %s "${file}")"
    log_action "Sauvegarde locale : ${file}"
    printf '%s' "${file}"
}

# Supprime les sauvegardes locales de plus de LIMS_BACKUP_DAYS jours, en gardant toujours les plus récentes.
prune_local_backups() {
    local dir kind
    for kind in db config; do
        dir="${LIMS_BACKUPS}/${kind}"
        [ -d "${dir}" ] || continue
        find "${dir}" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.tar.gz' \) -printf '%T@ %p\n' | sort -rn \
            | awk -v keep="${LIMS_BACKUP_KEEP_MIN}" 'NR > keep {print $2}' \
            | while read -r f; do
                if [ -n "$(find "${f}" -mtime "+${LIMS_BACKUP_DAYS}" 2>/dev/null)" ]; then
                    rm -f "${f}" "${f}.sha256"
                fi
            done
    done
}

latest_local_dump() {
    find "${LIMS_BACKUPS}/db" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-
}

# --- Destinations hors machine ------------------------------------------------------

offsite_type() { conf_get DEST_TYPE; }
offsite_enabled() { [ "$(conf_get ENABLED)" = "1" ] && [ -n "$(offsite_type)" ] && [ "$(offsite_type)" != "none" ]; }
lab_id() { local id; id="$(conf_get LAB_ID)"; printf '%s' "${id:-$(hostname -s)}"; }

ssh_opts() {
    printf -- '-i %s -p %s -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new' "${SSH_KEY}" "$(conf_get SSH_PORT)"
}

# Monte la destination (partage Windows, USB) ; affiche la racine où écrire.
offsite_mount() {
    local type; type="$(offsite_type)"
    case "${type}" in
        ssh) printf '%s' "$(conf_get SSH_PATH)" ;;
        cifs)
            install -d -m 0700 "${OFFSITE_MOUNT}"
            mountpoint -q "${OFFSITE_MOUNT}" && umount "${OFFSITE_MOUNT}" 2>/dev/null
            mount -t cifs "$(conf_get CIFS_SHARE)" "${OFFSITE_MOUNT}" \
                -o "credentials=${CIFS_CREDENTIALS},uid=0,gid=0,file_mode=0600,dir_mode=0700,vers=$(conf_get CIFS_VERSION || echo 3.0)" >> "${LIMS_OP_LOG:-/dev/null}" 2>&1 \
                || { error "Montage du partage $(conf_get CIFS_SHARE) impossible (nom, partage, identifiants, pare-feu Windows ?)."; return 1; }
            printf '%s' "${OFFSITE_MOUNT}"
            ;;
        usb)
            local dev
            dev="$(blkid -U "$(conf_get USB_UUID)" 2>/dev/null || true)"
            [ -n "${dev}" ] || { error "Clé ou disque USB absent (UUID $(conf_get USB_UUID)) : branchez-le."; return 1; }
            install -d -m 0700 "${OFFSITE_MOUNT}"
            mountpoint -q "${OFFSITE_MOUNT}" && umount "${OFFSITE_MOUNT}" 2>/dev/null
            mount "${dev}" "${OFFSITE_MOUNT}" >> "${LIMS_OP_LOG:-/dev/null}" 2>&1 || { error "Montage du disque USB ${dev} impossible."; return 1; }
            printf '%s' "${OFFSITE_MOUNT}"
            ;;
        *) error "Aucune destination hors machine configurée (lims backup setup)."; return 1 ;;
    esac
}

offsite_umount() {
    case "$(offsite_type)" in cifs|usb) sync; mountpoint -q "${OFFSITE_MOUNT}" && umount "${OFFSITE_MOUNT}" 2>/dev/null; ;; esac
    return 0
}

offsite_describe() {
    case "$(offsite_type)" in
        ssh) printf 'machine Linux %s@%s:%s' "$(conf_get SSH_USER)" "$(conf_get SSH_HOST)" "$(conf_get SSH_PATH)" ;;
        cifs) printf 'partage Windows %s' "$(conf_get CIFS_SHARE)" ;;
        usb) printf 'disque USB %s (UUID %s)' "$(conf_get USB_LABEL)" "$(conf_get USB_UUID)" ;;
        *) printf 'aucune' ;;
    esac
}

# Copie les sauvegardes locales vers la destination (sans suppression à distance hors rétention).
offsite_sync() {
    local root dest days rc=0 message
    days="$(conf_get REMOTE_DAYS)"; days="${days:-90}"
    # Nouveau serveur pas encore initialisé alors que la destination contient déjà les sauvegardes d'un
    # laboratoire : copier maintenant mettrait une base vide en tête de liste. Il faut d'abord restaurer.
    if [ "${LIMS_FORCE_OFFSITE:-0}" != "1" ] && cli_run status 2>/dev/null | grep -q '"needsSetup":true' \
        && [ -n "$(offsite_list "$(lab_id)" 2>/dev/null | head -n 1)" ]; then
        warning "La destination contient déjà des sauvegardes de « $(lab_id) » alors que ce serveur est neuf."
        warning "Copie suspendue pour ne pas les mélanger avec une base vide. Pour reprendre ce laboratoire : sudo lims restore --from-destination"
        json_state "${LIMS_STATE}/last-offsite.json" at="$(date -Is)" ok=false dest="$(offsite_describe)" message="serveur neuf : restauration attendue"
        return 1
    fi
    offsite_stage || { json_state "${LIMS_STATE}/last-offsite.json" at="$(date -Is)" ok=false dest="$(offsite_describe)" message="chiffrement impossible"; return 1; }
    root="$(offsite_mount)" || { json_state "${LIMS_STATE}/last-offsite.json" at="$(date -Is)" ok=false dest="$(offsite_describe)" message="destination indisponible"; return 1; }
    dest="${root%/}/$(lab_id)"
    if [ "$(offsite_type)" = "ssh" ]; then
        local target
        target="$(conf_get SSH_USER)@$(conf_get SSH_HOST)"
        # shellcheck disable=SC2046
        ssh $(ssh_opts) "${target}" "mkdir -p '${dest}/db' '${dest}/config'" 2>> "${LIMS_OP_LOG:-/dev/null}" || rc=1
        # shellcheck disable=SC2046
        [ "${rc}" -eq 0 ] && { rsync -a --partial --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= -e "ssh $(ssh_opts)" "${LIMS_BACKUPS}/offsite/db/" "${target}:${dest}/db/" \
            && rsync -a --partial --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= -e "ssh $(ssh_opts)" "${LIMS_BACKUPS}/offsite/config/" "${target}:${dest}/config/"; } 2>> "${LIMS_OP_LOG:-/dev/null}" || rc=1
        # shellcheck disable=SC2046
        [ "${rc}" -eq 0 ] && ssh $(ssh_opts) "${target}" "find '${dest}' -type f -mtime +${days} -delete" 2>/dev/null || true
    else
        mkdir -p "${dest}/db" "${dest}/config" 2>/dev/null || rc=1
        [ "${rc}" -eq 0 ] && { rsync -rt --partial "${LIMS_BACKUPS}/offsite/db/" "${dest}/db/" && rsync -rt --partial "${LIMS_BACKUPS}/offsite/config/" "${dest}/config/"; } 2>> "${LIMS_OP_LOG:-/dev/null}" || rc=1
        [ "${rc}" -eq 0 ] && find "${dest}" -type f -mtime "+${days}" -delete 2>/dev/null
        offsite_umount
    fi
    if [ "${rc}" -eq 0 ]; then
        message="copie à jour sur $(offsite_describe)"
        json_state "${LIMS_STATE}/last-offsite.json" at="$(date -Is)" ok=true dest="$(offsite_describe)" message="${message}"
        log_action "Sauvegarde hors machine : ${message}"
        return 0
    fi
    json_state "${LIMS_STATE}/last-offsite.json" at="$(date -Is)" ok=false dest="$(offsite_describe)" message="copie interrompue"
    error "La copie hors machine a échoué ($(offsite_describe)). Diagnostic : lims backup test"
    return 1
}

# Vérifie la destination sans rien modifier d'autre qu'un fichier témoin.
offsite_test() {
    local root dest probe free
    : "${LIMS_OP_LOG:=${LIMS_LOGS}/backup.log}"; export LIMS_OP_LOG
    header "Test de la destination : $(offsite_describe)"
    root="$(offsite_mount)" || return 1
    dest="${root%/}/$(lab_id)"
    probe=".lims-test-$$"
    if [ "$(offsite_type)" = "ssh" ]; then
        local target
        target="$(conf_get SSH_USER)@$(conf_get SSH_HOST)"
        # shellcheck disable=SC2046
        if ! ssh $(ssh_opts) "${target}" "mkdir -p '${dest}' && echo ok > '${dest}/${probe}' && cat '${dest}/${probe}' && rm -f '${dest}/${probe}'" >/dev/null 2>&1; then
            # shellcheck disable=SC2046
            if ssh $(ssh_opts) "${target}" true >/dev/null 2>&1; then
                error "Connexion réussie, mais le compte $(conf_get SSH_USER) ne peut pas écrire dans ${dest}."
                say "  Choisissez un dossier de ce compte (ex. sauvegardes-lims) ou donnez-lui les droits sur ${dest}."
            else
                error "Connexion SSH impossible vers ${target} (port $(conf_get SSH_PORT))."
                say "  Vérifiez l'adresse, le port, le pare-feu, et que la clé est autorisée : cat ${SSH_KEY}.pub"
            fi
            return 1
        fi
        # shellcheck disable=SC2046
        if ! ssh $(ssh_opts) "${target}" "command -v rsync" >/dev/null 2>&1; then
            error "rsync est absent de la machine de sauvegarde. Sur celle-ci : sudo apt install rsync"
            return 1
        fi
        # shellcheck disable=SC2046
        free="$(ssh $(ssh_opts) "${target}" "df -Pk '${dest}' | awk 'NR==2 {print \$4}'" 2>/dev/null || echo 0)"
    else
        if ! { mkdir -p "${dest}" && echo ok > "${dest}/${probe}" && grep -q ok "${dest}/${probe}" && rm -f "${dest}/${probe}"; } 2>/dev/null; then
            offsite_umount
            error "Écriture impossible dans ${dest}."
            return 1
        fi
        free="$(df -Pk "${dest}" | awk 'NR==2 {print $4}')"
        offsite_umount
    fi
    success "Destination joignable et accessible en écriture (${dest})."
    say "Espace libre : $(human_size "$(( ${free:-0} * 1024 ))")"
}

# Partitions formatées hors disque système : « /dev/sdb1 TYPE=exfat UUID=… LABEL=… TAILLE=… ».
# blkid lit les systèmes de fichiers directement (fonctionne aussi sans udev).
usb_candidates() {
    local system dev type uuid label size
    system="$(findmnt -rno SOURCE / /boot /boot/efi 2>/dev/null | sed 's/\[.*//' | sort -u)"
    while read -r dev; do
        [ -n "${dev}" ] || continue
        case "${dev}" in /dev/loop*) [ "${LIMS_ALLOW_LOOP:-0}" = "1" ] || continue ;; esac
        printf '%s\n' "${system}" | grep -qx "${dev}" && continue
        type="$(blkid -s TYPE -o value "${dev}" 2>/dev/null)"
        case "${type}" in ext4|ext3|xfs|btrfs|exfat|vfat|ntfs|ntfs3) ;; *) continue ;; esac
        uuid="$(blkid -s UUID -o value "${dev}" 2>/dev/null)"
        [ -n "${uuid}" ] || continue
        label="$(blkid -s LABEL -o value "${dev}" 2>/dev/null)"
        size="$(lsblk -dnbo SIZE "${dev}" 2>/dev/null)"
        printf '%s TYPE=%s UUID=%s LABEL=%s TAILLE=%s\n' "${dev}" "${type}" "${uuid}" "${label:-sans-nom}" "$(human_size "${size:-0}")"
    done < <(blkid -o device 2>/dev/null | sort)
}

offsite_save_conf() {
    umask 077
    printf '%s\n' "$@" > "$(BACKUP_CONF)"
    umask 022
}

# Choix interactif de la destination hors machine.
backup_setup() {
    local choice id no_sync=0
    [ "${1:-}" = "--no-sync" ] && no_sync=1
    LIMS_OP_LOG="${LIMS_LOGS}/backup.log"; export LIMS_OP_LOG
    header "Sauvegardes hors machine"
    say "Une sauvegarde qui reste sur le serveur disparaît avec lui (panne de disque, vol, incendie)."
    choice="$(choose "Où envoyer les sauvegardes ?" "Une autre machine Linux (SSH)" "Un dossier partagé Windows" "Une clé ou un disque USB" "Aucune destination pour l'instant")"
    id="$(ask "Nom de ce laboratoire dans la destination" "$(lab_id)")"
    id="$(printf '%s' "${id}" | tr -c 'A-Za-z0-9._-' '-' | sed 's/-*$//')"
    case "${choice}" in
        1)
            local host port user path
            host="$(ask "Adresse de la machine de sauvegarde (nom ou IP)" "$(conf_get SSH_HOST)")"
            port="$(ask "Port SSH" "$(conf_get SSH_PORT || true)")"; port="${port:-22}"
            user="$(ask "Compte sur cette machine" "$(conf_get SSH_USER)")"
            path="$(ask "Dossier de destination (relatif au dossier personnel du compte, ou chemin absolu)" "$(conf_get SSH_PATH || true)")"; path="${path:-sauvegardes-lims}"
            [ -n "${host}" ] && [ -n "${user}" ] || die "Adresse et compte obligatoires."
            install -d -m 0700 /root/.ssh
            [ -f "${SSH_KEY}" ] || ssh-keygen -q -t ed25519 -N '' -C "lims-backup@$(hostname -s)" -f "${SSH_KEY}"
            offsite_save_conf "DEST_TYPE=ssh" "ENABLED=1" "LAB_ID=${id}" "SSH_HOST=${host}" "SSH_PORT=${port}" "SSH_USER=${user}" "SSH_PATH=${path}" "REMOTE_DAYS=90"
            info "Autorisation de la clé de sauvegarde sur ${user}@${host} (mot de passe de ce compte demandé une fois)…"
            if ! ssh-copy-id -i "${SSH_KEY}.pub" -p "${port}" -o StrictHostKeyChecking=accept-new "${user}@${host}" >/dev/null 2>&1; then
                warning "Copie automatique de la clé impossible. Ajoutez cette ligne au fichier ~/.ssh/authorized_keys de ${user}@${host} :"
                cat "${SSH_KEY}.pub"
            fi
            ;;
        2)
            local share user pass domain
            share="$(ask "Partage Windows (ex. //192.168.1.20/Sauvegardes)" "$(conf_get CIFS_SHARE)")"
            # \\serveur\partage (écriture Windows) ou //serveur/partage → //serveur/partage
            share="${share//\\//}"
            share="//$(printf '%s' "${share}" | sed -e 's#^/*##' -e 's#//*#/#g' -e 's#/$##')"
            [[ "${share}" =~ ^//[^/]+/[^/]+ ]] || die "Partage invalide : écrivez \\\\serveur\\partage ou //serveur/partage."
            user="$(ask "Compte Windows" "")"
            domain="$(ask "Domaine (vide si aucun)" "")"
            read -r -s -p "Mot de passe de ce compte : " pass; echo
            [ -n "${share}" ] && [ -n "${user}" ] || die "Partage et compte obligatoires."
            umask 077
            { printf 'username=%s\npassword=%s\n' "${user}" "${pass}"; [ -n "${domain}" ] && printf 'domain=%s\n' "${domain}"; } > "${CIFS_CREDENTIALS}"
            umask 022
            offsite_save_conf "DEST_TYPE=cifs" "ENABLED=1" "LAB_ID=${id}" "CIFS_SHARE=${share}" "CIFS_VERSION=3.0" "REMOTE_DAYS=90"
            ;;
        3)
            local devices n uuid label
            say "Disques détectés (branchez la clé ou le disque avant de choisir) :"
            mapfile -t devices < <(usb_candidates)
            [ "${#devices[@]}" -gt 0 ] || die "Aucun disque amovible formaté trouvé (formatez-le en ext4 ou exFAT, puis rebranchez-le)."
            n="$(choose "Disque à utiliser :" "${devices[@]}")"
            uuid="$(printf '%s' "${devices[$((n - 1))]}" | sed -n 's/.*UUID=\([^ ]*\).*/\1/p')"
            label="$(printf '%s' "${devices[$((n - 1))]}" | sed -n 's/.*LABEL=\([^ ]*\).*/\1/p')"
            offsite_save_conf "DEST_TYPE=usb" "ENABLED=1" "LAB_ID=${id}" "USB_UUID=${uuid}" "USB_LABEL=${label}" "REMOTE_DAYS=365"
            ;;
        4)
            offsite_save_conf "DEST_TYPE=none" "ENABLED=0" "LAB_ID=${id}"
            warning "Aucune destination : les sauvegardes restent sur ce serveur uniquement."
            return 0
            ;;
    esac
    offsite_test || return 1
    if [ "${no_sync}" -eq 0 ] && [ "$(backup_key_ensure)" = "1" ]; then
        header "Clé de sauvegarde — à noter maintenant"
        say "Les copies envoyées hors du serveur sont chiffrées (AES-256) avec cette clé :"
        say ""
        say "    ${C_BOLD}$(cat "$(BACKUP_KEY)")${C_RESET}"
        say ""
        warning "Recopiez-la dans le registre du laboratoire ou un coffre-fort de mots de passe, HORS de ce serveur."
        warning "Si le serveur est perdu, cette clé est indispensable pour restaurer les sauvegardes sur un autre."
        say "Pour l'afficher de nouveau : sudo lims backup key"
        [ -t 0 ] && read -r -p "Appuyez sur Entrée quand la clé est notée… " _
    fi
    if [ "${no_sync}" -eq 1 ]; then
        success "Destination enregistrée : $(offsite_describe)."
        return 0
    fi
    offsite_sync && success "Sauvegardes hors machine configurées : $(offsite_describe), toutes les 6 heures."
}

backup_status() {
    local f age
    header "État des sauvegardes"
    f="${LIMS_STATE}/last-local-backup.json"
    if [ -f "${f}" ]; then
        age="$(file_age_hours "${f}")"
        if [ "$(json_read "${f}" ok)" = "true" ]; then
            success "Dernière sauvegarde locale : $(json_read "${f}" at) (il y a ${age} h) — $(basename "$(json_read "${f}" file)"), $(human_size "$(json_read "${f}" size)")"
        else
            error "Dernière sauvegarde locale en échec : $(json_read "${f}" at) — $(json_read "${f}" message)"
        fi
    else
        warning "Aucune sauvegarde locale enregistrée."
    fi
    say "Sauvegardes locales conservées : $(find "${LIMS_BACKUPS}/db" -maxdepth 1 -name '*.dump' 2>/dev/null | wc -l) (${LIMS_BACKUPS}/db, ${LIMS_BACKUP_DAYS} jours)"
    if ! offsite_enabled; then
        warning "Sauvegardes hors machine : $( [ "$(offsite_type)" = "" ] || [ "$(offsite_type)" = "none" ] && echo "non configurées (lims backup setup)" || echo "désactivées (lims backup enable)")"
    else
        f="${LIMS_STATE}/last-offsite.json"
        if [ -f "${f}" ] && [ "$(json_read "${f}" ok)" = "true" ]; then
            success "Dernière copie hors machine : $(json_read "${f}" at) (il y a $(file_age_hours "${f}") h) — $(json_read "${f}" dest)"
        elif [ -f "${f}" ]; then
            error "Dernière copie hors machine en échec : $(json_read "${f}" at) — $(json_read "${f}" message). Diagnostic : lims backup test"
        else
            warning "Aucune copie hors machine encore effectuée vers $(offsite_describe)."
        fi
    fi
    if is_systemd; then
        say "Prochaine sauvegarde planifiée : $(systemctl show lims-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null || echo '?')"
    fi
}

backup_set_enabled() {
    local value="$1" tmp
    [ -f "$(BACKUP_CONF)" ] || die "Aucune destination configurée : lims backup setup"
    tmp="$(mktemp)"
    grep -v '^ENABLED=' "$(BACKUP_CONF)" > "${tmp}"; echo "ENABLED=${value}" >> "${tmp}"
    cat "${tmp}" > "$(BACKUP_CONF)"; rm -f "${tmp}"
    if [ "${value}" = "1" ]; then success "Sauvegardes hors machine réactivées."; else warning "Sauvegardes hors machine suspendues (lims backup enable pour reprendre)."; fi
}

# lims backup [--scheduled]
lims_backup() {
    local scheduled=0 dump
    [ "${1:-}" = "--scheduled" ] && scheduled=1
    LIMS_OP_LOG="${LIMS_LOGS}/backup.log"; export LIMS_OP_LOG
    dump="$(backup_database "$([ "${scheduled}" -eq 1 ] && echo auto || echo manuel)")" || return 1
    [ "${scheduled}" -eq 1 ] || success "Base de données et configuration sauvegardées sur ce serveur : $(basename "${dump}")"
    prune_local_backups
    if offsite_enabled; then
        offsite_sync || return 1
        [ "${scheduled}" -eq 1 ] || success "Copie envoyée hors machine : $(offsite_describe)"
    elif [ "${scheduled}" -eq 0 ]; then
        warning "Aucune sauvegarde hors machine n'est configurée."
        if [ -t 0 ] && confirm "Configurer les sauvegardes hors machine maintenant ?" N; then backup_setup; fi
    fi
}

# --- Restauration -------------------------------------------------------------------

terminate_connections() {
    psql_admin postgres -tAc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LIMS_DB}' AND pid <> pg_backend_pid()" >/dev/null 2>&1 || true
}

# Remplace la base par le contenu d'un dump vérifié.
restore_dump_file() {
    local file="$1" expected
    [ -s "${file}" ] || die "Sauvegarde introuvable : ${file}"
    if [ -f "${file}.sha256" ]; then
        expected="$(awk '{print $1}' "${file}.sha256")"
        [ "$(sha256sum "${file}" | awk '{print $1}')" = "${expected}" ] || die "Empreinte SHA-256 incorrecte : ${file} est corrompu."
    fi
    pg_restore --list "${file}" >/dev/null 2>&1 || die "Sauvegarde illisible : ${file}"
    info "Restauration de $(basename "${file}")…"
    terminate_connections
    psql_admin postgres -c "DROP DATABASE IF EXISTS \"${LIMS_DB}\" WITH (FORCE)" >/dev/null
    db_create "${LIMS_DB}" >/dev/null
    if [ -n "${LIMS_ADMIN_DATABASE_URL:-}" ] || [ "$(id -un)" = "postgres" ]; then
        pg_restore --no-owner --role="${LIMS_DB_OWNER}" --exit-on-error --dbname="$(admin_dsn "${LIMS_DB}")" "${file}" 2>> "${LIMS_OP_LOG:-/dev/null}"
    else
        sudo -u postgres pg_restore --no-owner --role="${LIMS_DB_OWNER}" --exit-on-error --dbname="${LIMS_DB}" < "${file}" 2>> "${LIMS_OP_LOG:-/dev/null}"
    fi || die "pg_restore a échoué (détail : ${LIMS_OP_LOG:-journal})."
    db_apply_grants "${LIMS_DB}" >/dev/null
    success "Base restaurée depuis $(basename "${file}")."
}

# Récupère depuis la destination hors machine un dump (et la configuration de même horodatage), déchiffrés ;
# affiche le chemin local du dump.
offsite_fetch_dump() {
    local lab="$1" name="$2" root dest tmp ts plain conf_name target=""
    root="$(offsite_mount)" || return 1
    dest="${root%/}/${lab}"
    tmp="$(mktemp -d /tmp/lims-restore-XXXXXX)"; chmod 0700 "${tmp}"
    ts="$(printf '%s' "${name}" | sed -n 's/.*-\([0-9]\{8\}-[0-9]\{6\}\)-.*/\1/p')"
    plain="${name%.gpg}"
    conf_name="config-${ts}.tar.gz"
    if [ "$(offsite_type)" = "ssh" ]; then
        target="$(conf_get SSH_USER)@$(conf_get SSH_HOST)"
        # shellcheck disable=SC2046
        rsync -a -e "ssh $(ssh_opts)" "${target}:${dest}/db/${name}" "${tmp}/" 2>> "${LIMS_OP_LOG:-/dev/null}" || { rm -rf "${tmp}"; error "Copie de ${name} impossible."; return 1; }
        # shellcheck disable=SC2046
        rsync -a -e "ssh $(ssh_opts)" "${target}:${dest}/db/${plain}.sha256" "${tmp}/" 2>/dev/null || true
        # shellcheck disable=SC2046
        rsync -a -e "ssh $(ssh_opts)" "${target}:${dest}/config/${conf_name}.gpg" "${target}:${dest}/config/${conf_name}" "${tmp}/" 2>/dev/null || true
    else
        cp "${dest}/db/${name}" "${tmp}/" || { offsite_umount; rm -rf "${tmp}"; error "Copie de ${name} impossible."; return 1; }
        cp "${dest}/db/${plain}.sha256" "${tmp}/" 2>/dev/null || true
        cp "${dest}/config/${conf_name}.gpg" "${tmp}/" 2>/dev/null || cp "${dest}/config/${conf_name}" "${tmp}/" 2>/dev/null || true
        offsite_umount
    fi
    install -d -m 0700 "${LIMS_BACKUPS}/db" "${LIMS_BACKUPS}/config"
    if [ "${name}" != "${plain}" ]; then
        backup_key_prompt
        decrypt_file "${tmp}/${name}" "${LIMS_BACKUPS}/db/${plain}" \
            || { rm -rf "${tmp}"; error "Déchiffrement impossible : clé de sauvegarde incorrecte ou copie altérée."; [ "${KEY_PROMPTED:-0}" = "1" ] && rm -f "$(BACKUP_KEY)"; return 1; }
    else
        mv "${tmp}/${name}" "${LIMS_BACKUPS}/db/${plain}"
    fi
    [ -f "${tmp}/${plain}.sha256" ] && mv "${tmp}/${plain}.sha256" "${LIMS_BACKUPS}/db/"
    if [ -f "${tmp}/${conf_name}.gpg" ]; then
        decrypt_file "${tmp}/${conf_name}.gpg" "${LIMS_BACKUPS}/config/${conf_name}" || warning "Configuration de ${ts} illisible : non restaurée." >&2
    elif [ -f "${tmp}/${conf_name}" ]; then
        mv "${tmp}/${conf_name}" "${LIMS_BACKUPS}/config/"
    fi
    chmod 0600 "${LIMS_BACKUPS}/db/${plain}" "${LIMS_BACKUPS}/config/${conf_name}" 2>/dev/null || true
    rm -rf "${tmp}"
    printf '%s' "${LIMS_BACKUPS}/db/${plain}"
}

# Garde les sauvegardes (.dump, .dump.gpg) et les trie par l'horodatage de leur nom, la plus récente d'abord :
# les dates des fichiers changent au fil des copies, pas leur nom.
by_backup_date() {
    grep -E '\.dump(\.gpg)?$' | sed -E 's/^(.*-([0-9]{8}-[0-9]{6})-.*)$/\2 \1/' | sort -r | cut -d' ' -f2-
}

offsite_list() {
    # offsite_list [labo] → noms des laboratoires (sans argument) ou des dumps (avec), plus récents d'abord.
    local lab="${1:-}" root
    root="$(offsite_mount)" || return 1
    if [ "$(offsite_type)" = "ssh" ]; then
        local target
        target="$(conf_get SSH_USER)@$(conf_get SSH_HOST)"
        # shellcheck disable=SC2046
        if [ -z "${lab}" ]; then
            ssh $(ssh_opts) "${target}" "cd '${root}' && find . -mindepth 1 -maxdepth 1 -type d -exec test -d {}/db ';' -print | sed 's#^\\./##' | sort" 2>/dev/null
        else
            ssh $(ssh_opts) "${target}" "ls -1 '${root}/${lab}/db'" 2>/dev/null | by_backup_date
        fi
    else
        # Noms de sauvegarde produits par le LIMS (sans espace) : le tri par date de ls est voulu.
        # shellcheck disable=SC2010
        # Seuls les dossiers de laboratoire (avec un sous-dossier db) : pas lost+found ni « System Volume Information ».
        if [ -z "${lab}" ]; then (cd "${root}" && find . -mindepth 1 -maxdepth 1 -type d -exec test -d '{}/db' ';' -print | sed 's#^\./##' | sort); else ls -1 "${root}/${lab}/db" 2>/dev/null | by_backup_date; fi
        offsite_umount
    fi
}

# lims restore [--list] [--file CHEMIN] [--from-destination] [--lab NOM] [--with-config] [--yes]
lims_restore() {
    local list=0 file="" remote=0 lab="" with_config=0 yes=0 candidates=() n safety ts conf
    while [ $# -gt 0 ]; do
        case "$1" in
            --list) list=1 ;;
            --file) file="$2"; shift ;;
            --file=*) file="${1#*=}" ;;
            --from-destination) remote=1 ;;
            --lab) lab="$2"; shift ;;
            --with-config) with_config=1 ;;
            -y|--yes) yes=1 ;;
            *) die "Option inconnue : $1" ;;
        esac
        shift
    done
    LIMS_OP_LOG="${LIMS_LOGS}/restore-$(date +%Y%m%d-%H%M%S).log"; export LIMS_OP_LOG
    header "Restauration"
    if [ "${remote}" -eq 1 ]; then
        if [ "$(offsite_type)" = "" ] || [ "$(offsite_type)" = "none" ]; then
            info "Indiquez la destination où l'ancien serveur envoyait ses sauvegardes."
            backup_setup --no-sync || die "Destination inaccessible."
        fi
        if [ -z "${lab}" ]; then
            mapfile -t candidates < <(offsite_list)
            [ "${#candidates[@]}" -gt 0 ] || die "Aucun laboratoire trouvé dans $(offsite_describe)."
            if [ "${list}" -eq 1 ]; then printf '%s\n' "${candidates[@]}"; return 0; fi
            n="$(choose "Laboratoire à restaurer :" "${candidates[@]}")"
            lab="${candidates[$((n - 1))]}"
        fi
        mapfile -t candidates < <(offsite_list "${lab}" | head -n 15)
        [ "${#candidates[@]}" -gt 0 ] || die "Aucune sauvegarde pour ${lab}."
        if [ "${list}" -eq 1 ]; then printf '%s\n' "${candidates[@]}"; return 0; fi
        n="$(choose "Sauvegarde à restaurer (la plus récente en premier) :" "${candidates[@]}")"
        file="$(offsite_fetch_dump "${lab}" "${candidates[$((n - 1))]}")" || die "Récupération impossible."
        with_config=1
    elif [ -z "${file}" ]; then
        mapfile -t candidates < <(find "${LIMS_BACKUPS}/db" -maxdepth 1 -name '*.dump' -printf '%T@ %f\n' | sort -rn | head -n 15 | cut -d' ' -f2-)
        [ "${#candidates[@]}" -gt 0 ] || die "Aucune sauvegarde locale. Depuis la destination hors machine : lims restore --from-destination"
        if [ "${list}" -eq 1 ]; then printf '%s\n' "${candidates[@]}"; return 0; fi
        n="$(choose "Sauvegarde à restaurer (la plus récente en premier) :" "${candidates[@]}")"
        file="${LIMS_BACKUPS}/db/${candidates[$((n - 1))]}"
    fi
    [ -f "${file}" ] || die "Fichier introuvable : ${file}"
    warning "La base actuelle sera REMPLACÉE par $(basename "${file}")."
    if [ "${yes}" -eq 0 ] && ! confirm "Confirmer la restauration ?" N; then die "Restauration annulée."; fi

    if db_exists && [ "$(db_table_count)" -gt 0 ]; then
        info "Copie de sécurité de la base actuelle…"
        safety="$(backup_database avant-restauration)" || die "Copie de sécurité impossible : restauration annulée."
        info "Copie de sécurité : $(basename "${safety}")"
    fi
    api_stop || true
    restore_dump_file "${file}"
    if [ "${with_config}" -eq 1 ]; then
        ts="$(basename "${file}" | sed -n 's/.*-\([0-9]\{8\}-[0-9]\{6\}\)-.*/\1/p')"
        conf="${LIMS_BACKUPS}/config/config-${ts}.tar.gz"
        if [ -f "${conf}" ]; then
            # Ce qui appartient à CETTE machine est conservé : mot de passe du rôle applicatif, adresse web, certificat.
            local keep_vars=(DATABASE_URL LIMS_HOSTNAME CORS_ORIGINS LIMS_TLS_MODE LIMS_TLS_EMAIL) k
            local -A keep=()
            for k in "${keep_vars[@]}"; do keep[$k]="$(env_get "${k}" || true)"; done
            tar -xzf "${conf}" -C "${LIMS_SHARED}" .env 2>/dev/null && info "Configuration (.env, clé de chiffrement) restaurée depuis $(basename "${conf}")."
            for k in "${keep_vars[@]}"; do [ -n "${keep[$k]}" ] && env_set "${k}" "${keep[$k]}"; done
            env_set HOST 127.0.0.1
            chown root:"${LIMS_USER}" "${LIMS_ENV_FILE}"; chmod 0640 "${LIMS_ENV_FILE}"
        else
            warning "Pas d'archive de configuration pour cette sauvegarde : la clé INTEROP_SECRET_KEY d'origine n'est pas restaurée (secrets DHIS2/VLSM à ressaisir)."
        fi
    fi
    migrations_apply "${LIMS_HOME}/current" || die "Migrations impossibles après restauration."
    api_start || true
    if wait_for_api 60 >/dev/null; then
        success "Restauration terminée : le LIMS répond."
    else
        die "Base restaurée mais l'API ne répond pas : sudo lims doctor"
    fi
}
