# shellcheck shell=bash
# Services systemd : API et tâches planifiées. Requiert common.sh.
#
#   lims-api.service           API Node.js (compte « lims », 127.0.0.1:3000, durcie)
#   lims-backup.timer          sauvegarde locale + envoi hors machine — toutes les 6 h et 15 min après le démarrage
#   lims-housekeeping.timer    purge des journaux et vieilles sauvegardes, ANALYZE — chaque nuit à 00:45
#   lims-health.timer          contrôle de santé — toutes les heures

API_UNIT=lims-api.service

write_systemd_units() {
    local node_bin
    node_bin="$(command -v node)"
    cat > /etc/systemd/system/lims-api.service <<UNIT
[Unit]
Description=LIMS — API du système d'information de laboratoire
Documentation=file://${LIMS_HOME}/current/docs/guides/maintenance.md
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=${LIMS_USER}
Group=${LIMS_USER}
WorkingDirectory=${LIMS_HOME}/current/apps/api
EnvironmentFile=${LIMS_ENV_FILE}
Environment=HOST=127.0.0.1
ExecStart=${node_bin} dist/main.js
Restart=always
RestartSec=5
TimeoutStopSec=30
UMask=0027
# Durcissement : le service ne peut rien écrire sur le disque ni changer de privilèges.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictRealtime=yes
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
UNIT

    local name desc cmd calendar boot
    while IFS='|' read -r name desc cmd calendar boot; do
        cat > "/etc/systemd/system/lims-${name}.service" <<UNIT
[Unit]
Description=LIMS — ${desc}
After=postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/lims ${cmd}
Nice=10
IOSchedulingClass=idle
UNIT
        {
            printf '[Unit]\nDescription=LIMS — %s (planification)\n\n[Timer]\nOnCalendar=%s\nPersistent=true\nRandomizedDelaySec=120\n' "${desc}" "${calendar}"
            [ -n "${boot}" ] && printf 'OnBootSec=%s\n' "${boot}"
            printf '\n[Install]\nWantedBy=timers.target\n'
        } > "/etc/systemd/system/lims-${name}.timer"
    done <<'TIMERS'
backup|sauvegarde de la base et envoi hors machine|backup --scheduled|*-*-* 00/6:00:00|15min
housekeeping|entretien (journaux, sauvegardes anciennes, statistiques)|housekeeping|*-*-* 00:45:00|
health|contrôle de santé|health --quiet|hourly|
TIMERS

    cat > /etc/logrotate.d/lims <<ROT
${LIMS_LOGS}/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
ROT
}

enable_services() {
    if ! is_systemd; then
        warning "systemd absent : services et tâches planifiées non activés."
        return 0
    fi
    systemctl daemon-reload
    systemctl enable "${API_UNIT}" >/dev/null 2>&1
    systemctl enable --now lims-backup.timer lims-housekeeping.timer lims-health.timer >/dev/null 2>&1
    success "Services activés (API et tâches planifiées)."
}

api_start()   { is_systemd && systemctl start "${API_UNIT}"; }
api_stop()    { is_systemd && systemctl stop "${API_UNIT}"; }
api_restart() { is_systemd && systemctl restart "${API_UNIT}"; }

# Attend que l'API réponde (/api/health) ; affiche la version servie. Abandonne tôt si le service
# redémarre en boucle (plantage au démarrage).
wait_for_api() {
    local timeout="${1:-60}" i body restarts0=0 restarts
    is_systemd && restarts0="$(systemctl show -p NRestarts --value "${API_UNIT}" 2>/dev/null || echo 0)"
    for i in $(seq 1 "${timeout}"); do
        body="$(curl -fsS --max-time 3 "http://127.0.0.1:${LIMS_API_PORT}/api/health" 2>/dev/null || true)"
        if printf '%s' "${body}" | grep -q '"status":"ok"'; then
            printf '%s' "${body}" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'
            return 0
        fi
        if is_systemd && [ $((i % 5)) -eq 0 ]; then
            restarts="$(systemctl show -p NRestarts --value "${API_UNIT}" 2>/dev/null || echo 0)"
            [ $((restarts - restarts0)) -ge 3 ] && return 1
        fi
        sleep 1
    done
    return 1
}
