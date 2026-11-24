# shellcheck shell=bash
# HTTPS et Nginx. Requiert common.sh.
#
# Le LIMS impose des cookies « Secure » en production : il est donc toujours servi en HTTPS.
#   local       autorité de certification propre au laboratoire (réseau local, sans Internet) :
#               les postes importent une fois lims-ca.crt, téléchargeable sur http://<serveur>/lims-ca.crt
#   letsencrypt certificat public gratuit (nom de domaine public, port 80 joignable depuis Internet)
#   provided    certificat fourni par l'établissement (fichiers PEM)

nginx_at_least() {
    local v
    v="$(nginx -v 2>&1 | sed -n 's#.*nginx/\([0-9.]*\).*#\1#p')"
    [ -n "${v}" ] && [ "$(printf '%s\n%s\n' "$1" "${v}" | sort -V | head -n 1)" = "$1" ]
}

TLS_DIR() { printf '%s/tls' "${LIMS_SHARED}"; }

cert_paths() {
    # Affiche « certificat clé » selon le mode courant.
    local mode; mode="$(env_get LIMS_TLS_MODE 2>/dev/null || echo local)"
    if [ "${mode}" = "letsencrypt" ]; then
        local host; host="$(env_get LIMS_HOSTNAME)"
        printf '/etc/letsencrypt/live/%s/fullchain.pem /etc/letsencrypt/live/%s/privkey.pem' "${host}" "${host}"
    else
        printf '%s/server.crt %s/server.key' "$(TLS_DIR)" "$(TLS_DIR)"
    fi
}

# Autorité locale (10 ans) puis certificat serveur (825 jours, limite acceptée par les navigateurs).
generate_local_certificate() {
    local host="$1" dir san ip i=1
    dir="$(TLS_DIR)"
    install -d -m 0755 "${dir}"
    if [ ! -s "${dir}/ca.key" ] || [ ! -s "${dir}/ca.crt" ]; then
        openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -sha256 \
            -keyout "${dir}/ca.key" -out "${dir}/ca.crt" \
            -subj "/O=LIMS/CN=Autorite locale LIMS ($(hostname -s))" \
            -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
            -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1 \
            || die "Création de l'autorité de certification locale impossible."
        chmod 0600 "${dir}/ca.key"
        success "Autorité de certification locale créée."
    fi
    san="DNS.${i} = ${host}"
    i=$((i + 1)); san="${san}"$'\n'"DNS.${i} = localhost"
    if [ "${host}" != "$(hostname -s)" ]; then i=$((i + 1)); san="${san}"$'\n'"DNS.${i} = $(hostname -s)"; fi
    local n=1
    san="${san}"$'\n'"IP.${n} = 127.0.0.1"
    for ip in $(local_ips); do n=$((n + 1)); san="${san}"$'\n'"IP.${n} = ${ip}"; done
    cat > "${dir}/server.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no
[dn]
O = LIMS
CN = ${host}
[ext]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
${san}
CNF
    openssl req -new -newkey rsa:2048 -nodes -keyout "${dir}/server.key" -out "${dir}/server.csr" -config "${dir}/server.cnf" >/dev/null 2>&1 \
        || die "Création de la demande de certificat impossible."
    openssl x509 -req -in "${dir}/server.csr" -CA "${dir}/ca.crt" -CAkey "${dir}/ca.key" -CAcreateserial \
        -out "${dir}/server.crt" -days 825 -sha256 -extfile "${dir}/server.cnf" -extensions ext >/dev/null 2>&1 \
        || die "Signature du certificat serveur impossible."
    chmod 0600 "${dir}/server.key"
    rm -f "${dir}/server.csr"
    install -m 0644 "${dir}/ca.crt" "${LIMS_PUBLIC_WWW}/lims-ca.crt"
    success "Certificat HTTPS émis pour ${host} et $(local_ips | tr '\n' ' ')(valable 825 jours)."
}

install_provided_certificate() {
    local cert="$1" key="$2" dir
    dir="$(TLS_DIR)"
    [ -s "${cert}" ] && [ -s "${key}" ] || die "Certificat ou clé introuvable : ${cert} / ${key}"
    openssl x509 -in "${cert}" -noout >/dev/null 2>&1 || die "Le fichier ${cert} n'est pas un certificat PEM."
    install -m 0644 "${cert}" "${dir}/server.crt"
    install -m 0600 "${key}" "${dir}/server.key"
    success "Certificat fourni installé."
}

# Jours avant expiration du certificat en service (négatif si expiré).
cert_days_left() {
    local cert end
    cert="$(cert_paths | cut -d' ' -f1)"
    [ -r "${cert}" ] || return 1
    end="$(openssl x509 -in "${cert}" -noout -enddate 2>/dev/null | cut -d= -f2)"
    [ -n "${end}" ] || return 1
    echo $(( ($(date -d "${end}" +%s) - $(date +%s)) / 86400 ))
}

write_maintenance_page() {
    cat > "${LIMS_PUBLIC_WWW}/maintenance.html" <<'HTML'
<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="15">
<title>LIMS — maintenance</title>
<style>body{font-family:system-ui,sans-serif;background:#0f3d3e;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.4rem}p{opacity:.85}</style></head>
<body><main><h1>Le système d’information du laboratoire redémarre</h1>
<p>Mise à jour ou maintenance en cours. Cette page se recharge toute seule dans quelques secondes.</p>
<p>Si elle reste affichée plus de 10 minutes, prévenez l’administrateur (commande : <code>sudo lims doctor</code>).</p></main></body></html>
HTML
}

# Site Nginx : interface web statique + relais /api vers l'API (127.0.0.1), HTTP → HTTPS.
write_nginx_site() {
    local host="$1" mode cert key web
    mode="$(env_get LIMS_TLS_MODE 2>/dev/null || echo local)"
    read -r cert key < <(cert_paths)
    web="${LIMS_HOME}/current/apps/web/dist"
    install -d -m 0755 -o root -g root "${LIMS_PUBLIC_WWW}"
    write_maintenance_page
    # Certificat de l'autorité locale téléchargeable par les postes (y compris après une mise à jour
    # depuis une version qui le publiait ailleurs).
    [ -s "$(TLS_DIR)/ca.crt" ] && install -m 0644 "$(TLS_DIR)/ca.crt" "${LIMS_PUBLIC_WWW}/lims-ca.crt"
    install -d -m 0755 /var/www/letsencrypt
    local listen6_80="" listen6_443="" http2_listen="" http2_directive=""
    # « http2 on; » n'existe qu'à partir de Nginx 1.25.1 (Ubuntu 24.04 fournit 1.24).
    if nginx_at_least 1.25.1; then http2_directive="    http2 on;"; else http2_listen=" http2"; fi
    if ipv6_enabled; then
        listen6_80="    listen [::]:80 default_server;"
        listen6_443="    listen [::]:443 ssl${http2_listen} default_server;"
    fi
    cat > /etc/nginx/sites-available/lims <<NGINX
# Site du LIMS — généré par scripts/setup.sh (lims update le régénère : ne pas modifier à la main).
upstream lims_api {
    server 127.0.0.1:${LIMS_API_PORT};
    keepalive 16;
}

server {
    listen 80 default_server;
${listen6_80}
    server_name ${host} _;

    # Certificat de l'autorité locale, à importer une fois sur chaque poste du laboratoire.
    location = /lims-ca.crt {
        root ${LIMS_PUBLIC_WWW};
        default_type application/x-x509-ca-cert;
    }
    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl${http2_listen} default_server;
${listen6_443}
${http2_directive}
    server_name ${host} _;

    ssl_certificate     ${cert};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:lims_ssl:10m;
    ssl_session_timeout 1d;

    root ${web};
    index index.html;
    client_max_body_size 5m;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy same-origin always;
$( [ "${mode}" = "local" ] || printf '    add_header Strict-Transport-Security "max-age=31536000" always;\n' )
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass http://lims_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location = /lims-ca.crt {
        root ${LIMS_PUBLIC_WWW};
        default_type application/x-x509-ca-cert;
    }

    location / {
        add_header Cache-Control "no-cache";
        try_files \$uri /index.html;
    }

    error_page 502 503 504 =503 /maintenance.html;
    location = /maintenance.html {
        root ${LIMS_PUBLIC_WWW};
        internal;
    }
}
NGINX
    ln -sfn /etc/nginx/sites-available/lims /etc/nginx/sites-enabled/lims
    rm -f /etc/nginx/sites-enabled/default
    nginx -t >> "${LIMS_OP_LOG:-/dev/null}" 2>&1 || { nginx -t; die "Configuration Nginx invalide."; }
    if is_systemd; then
        systemctl enable nginx >/dev/null 2>&1 || true
        systemctl reload-or-restart nginx || die "Nginx ne redémarre pas : sudo lims doctor"
    elif pgrep -x nginx >/dev/null; then
        nginx -s reload
    else
        nginx
    fi
    success "Nginx configuré pour https://${host}/"
}

obtain_letsencrypt() {
    local host="$1" email="$2"
    apt_install certbot || die "Installation de certbot impossible."
    certbot certonly --webroot -w /var/www/letsencrypt -d "${host}" -m "${email}" --agree-tos --non-interactive \
        >> "${LIMS_OP_LOG:-/dev/null}" 2>&1 \
        || die "Let's Encrypt a refusé le certificat : le nom ${host} doit pointer vers ce serveur et le port 80 être joignable depuis Internet."
    install -d /etc/letsencrypt/renewal-hooks/deploy
    printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/lims-reload-nginx
    chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/lims-reload-nginx
    success "Certificat Let's Encrypt obtenu (renouvellement automatique par certbot)."
}

# Mise en place du HTTPS selon LIMS_TLS_MODE ; Let's Encrypt part d'un certificat local provisoire
# (Nginx doit déjà servir le défi HTTP).
configure_https() {
    local host="$1" mode email
    mode="$(env_get LIMS_TLS_MODE 2>/dev/null || echo local)"
    case "${mode}" in
        local)
            local cert; cert="$(TLS_DIR)/server.crt"
            if [ ! -s "${cert}" ] || ! openssl x509 -in "${cert}" -noout -checkhost "${host}" 2>/dev/null | grep -q 'does match' \
                || [ "$(cert_days_left || echo 0)" -lt 30 ]; then
                generate_local_certificate "${host}"
            fi
            write_nginx_site "${host}"
            ;;
        provided)
            write_nginx_site "${host}"
            ;;
        letsencrypt)
            email="$(env_get LIMS_TLS_EMAIL)"
            if [ ! -s "/etc/letsencrypt/live/${host}/fullchain.pem" ]; then
                env_set LIMS_TLS_MODE local
                [ -s "$(TLS_DIR)/server.crt" ] || generate_local_certificate "${host}"
                write_nginx_site "${host}"
                env_set LIMS_TLS_MODE letsencrypt
                obtain_letsencrypt "${host}" "${email}"
            fi
            write_nginx_site "${host}"
            ;;
        *) die "Mode HTTPS inconnu : ${mode}" ;;
    esac
}
