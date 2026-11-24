#!/bin/sh
# Certificat : celui monté dans /etc/lims/tls (server.crt / server.key), sinon une autorité locale et un
# certificat auto-générés et conservés dans le volume (le certificat de l'autorité est servi sur /lims-ca.crt).
set -eu
TLS=/etc/lims/tls
HOST="${LIMS_HOSTNAME:-lims}"
mkdir -p "${TLS}"
if [ ! -s "${TLS}/server.crt" ] || [ ! -s "${TLS}/server.key" ]; then
    if [ ! -s "${TLS}/ca.key" ]; then
        openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -sha256 -keyout "${TLS}/ca.key" -out "${TLS}/ca.crt" \
            -subj "/O=LIMS/CN=Autorite locale LIMS (docker)" -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
            -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
    fi
    printf '[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=%s\n[ext]\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:%s,DNS:localhost,IP:127.0.0.1%s\n' \
        "${HOST}" "${HOST}" "${LIMS_EXTRA_SAN:+,${LIMS_EXTRA_SAN}}" > "${TLS}/server.cnf"
    openssl req -new -newkey rsa:2048 -nodes -keyout "${TLS}/server.key" -out "${TLS}/server.csr" -config "${TLS}/server.cnf" >/dev/null 2>&1
    openssl x509 -req -in "${TLS}/server.csr" -CA "${TLS}/ca.crt" -CAkey "${TLS}/ca.key" -CAcreateserial -out "${TLS}/server.crt" \
        -days 825 -sha256 -extfile "${TLS}/server.cnf" -extensions ext >/dev/null 2>&1
    rm -f "${TLS}/server.csr"
    chmod 600 "${TLS}/server.key" "${TLS}/ca.key"
    echo "Certificat HTTPS généré pour ${HOST}."
fi
[ -s "${TLS}/ca.crt" ] && cp "${TLS}/ca.crt" /usr/share/lims/web/lims-ca.crt
exec "$@"
