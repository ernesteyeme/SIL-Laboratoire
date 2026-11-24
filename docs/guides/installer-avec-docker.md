# Installer le LIMS avec Docker

Docker démarre le LIMS en quelques minutes. Il convient à l'évaluation, à la formation et aux petits sites qui ont déjà Docker.

Comme pour InteLIS, **l'installation Ubuntu reste recommandée pour un laboratoire en production** : `lims check`, `lims doctor`, les sauvegardes hors machine chiffrées et la restauration guidée n'y existent que là. Une installation Docker se met à jour avec son propre script, `lims-docker.sh`.

Ce qu'il faut : Docker Engine 24 ou plus, avec `docker compose`, et l'archive de version décompressée.

## Installer

```bash
tar -xzf lims-1.7.0.tar.gz
sudo LIMS_HOSTNAME=lims bash lims-1.7.0/docker/lims-docker.sh install
```

Le script fait tout, dans cet ordre :
- il construit les images `lims-api:1.7.0` et `lims-web:1.7.0` à partir de la version, sans rien compiler ;
- il génère les secrets dans `/opt/lims-docker/.env` (0600) ;
- il démarre trois conteneurs : `db` (PostgreSQL 16), `api` et `web` (Nginx en HTTPS) ;
- il affiche le **code d'installation**.

Le conteneur de l'API crée lui-même les rôles PostgreSQL et applique les migrations à chaque démarrage. Ce sont les mêmes scripts que sur Ubuntu : le rôle applicatif n'a pas de droits sur le schéma.

Ouvrez ensuite `https://lims/`, ou `https://<adresse IP>/`, et terminez l'assistant comme dans [Installer sur Ubuntu](installer-sur-ubuntu.md#2-terminer-dans-le-navigateur), étapes 6 à 8.

Variables utiles au moment de l'installation :

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `LIMS_HOSTNAME` | Nom inscrit dans le certificat HTTPS | `lims` |
| `LIMS_EXTRA_SAN` | Autres noms ou adresses du certificat, ex. `IP:192.168.1.10,DNS:lims.labo.cd` | vide |
| `LIMS_HTTP_PORT`, `LIMS_HTTPS_PORT` | Ports publiés sur la machine | `80`, `443` |
| `TZ` | Fuseau horaire | `Africa/Kinshasa` |
| `LIMS_DOCKER_DIR` | Dossier de l'installation | `/opt/lims-docker` |

Le certificat de l'autorité locale du conteneur est servi sur `http://<serveur>/lims-ca.crt`, à importer sur les postes comme sur Ubuntu. Pour un certificat de l'établissement, placez `server.crt` et `server.key` dans le volume `lims_tls`, puis redémarrez le conteneur `web`.

## Exploiter

```bash
cd /opt/lims-docker
sudo bash lims-docker.sh status          # conteneurs et santé de l'API
sudo bash lims-docker.sh logs api        # journaux (api, web ou db)
sudo bash lims-docker.sh setup-token     # code de l'assistant
sudo bash lims-docker.sh backup          # sauvegarde de la base + copie du .env dans backups/
sudo bash lims-docker.sh restore backups/lims-…-manuel.dump
```

Les sauvegardes Docker restent **sur la machine**, dans `/opt/lims-docker/backups`, et sont gardées 30 jours. Programmez-les, puis copiez le dossier hors de la machine. Exemple avec `/etc/cron.d/lims-docker` :

```cron
15 */6 * * * root bash /opt/lims-docker/lims-docker.sh backup >> /var/log/lims-docker-backup.log 2>&1
45 */6 * * * root rsync -a /opt/lims-docker/backups/ sauvegarde@serveur-sauvegarde:sauvegardes-lims/docker/
```

Le dossier `backups` contient aussi des copies du `.env` (clés et mots de passe) : la destination doit être protégée en conséquence.

## Mettre à jour

```bash
sudo bash /opt/lims-docker/lims-docker.sh update --source ~/lims-1.8.0.tar.gz
```

Le script fait tout, dans cet ordre :
- il vérifie l'empreinte `.sha256` placée à côté de l'archive ;
- il construit les nouvelles images ;
- il sauvegarde la base ;
- il démarre la nouvelle version ; les migrations s'appliquent au démarrage de l'API.

Si l'API ne répond pas dans les 3 minutes, il revient à l'ancienne version et restaure la base d'avant.

## Machine sans accès à Docker Hub

Les images de base sont `node:22-bookworm-slim`, `nginx:1.27-alpine` et `postgres:16-alpine`. Si la machine ne joint pas Docker Hub, préparez ces images sur une autre machine (`docker save` / `docker load`), ou indiquez celles d'un registre interne :

```bash
sudo POSTGRES_IMAGE=registre.local/postgres:16 \
     LIMS_DOCKER_BUILD_ARGS="--build-arg NODE_IMAGE=registre.local/node:22 --build-arg NGINX_IMAGE=registre.local/nginx:1.27" \
     bash lims-1.7.0/docker/lims-docker.sh install
```
