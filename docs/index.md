# LIMS — documentation d'exploitation

Le LIMS est un système d'information de laboratoire conforme à l'ISO 15189. Il couvre les demandes, les échantillons, la caisse en CDF et en USD, les résultats, le contrôle qualité, les automates, ainsi que les échanges avec DHIS2, VLSM / InteLIS et OpenHIM.

Comme InteLIS, il s'installe sur une machine **Ubuntu 24.04 LTS** avec un seul script, téléchargé depuis GitHub :

```bash
cd ~ && wget -O install.sh "https://raw.githubusercontent.com/ernesteyeme/SIL-Laboratoire/main/scripts/install.sh?v=$(date +%s)" && sudo bash install.sh
```
 Une seule commande, `lims`, sert ensuite à tout l'entretien du serveur : mise à jour, sauvegarde, restauration, vérification, diagnostic.

## Par où commencer

| Situation | Guide |
| --- | --- |
| Installer un serveur de laboratoire | [Installer le LIMS sur Ubuntu](guides/installer-sur-ubuntu.md) |
| Essayer le LIMS, former, petit site | [Installer le LIMS avec Docker](guides/installer-avec-docker.md) |
| Le laboratoire n'a qu'un PC Windows | [Installer le LIMS sur Windows (WSL 2)](guides/installer-sur-windows.md) |
| Relier un automate | [Installer le connecteur d'automate sur un poste](guides/installer-le-connecteur.md) |
| Garder les données à l'abri | [Configurer les sauvegardes hors machine](guides/sauvegardes-hors-machine.md) |
| Revenir en arrière après une erreur ou une panne | [Restaurer une sauvegarde](guides/restaurer-une-sauvegarde.md) |
| Installer une nouvelle version | [Mettre à jour le LIMS](guides/mettre-a-jour.md) |
| Remplacer le serveur | [Changer de serveur](guides/changer-de-serveur.md) |
| Le site ne s'ouvre pas, une alerte s'affiche | [Dépannage et entretien](guides/depannage.md) |
| Préparer et diffuser une version (équipe technique) | [Publier une version](guides/publier-une-version.md) |

## La commande `lims`

| Commande | Rôle |
| --- | --- |
| `lims` | Menu numéroté des opérations courantes : rien à retenir. |
| `sudo lims check` | L'installation peut-elle fonctionner ? Chaque ligne est `PASS`, `WARN`, `FAIL` ou `SKIP`, avec la commande qui corrige. |
| `sudo lims health` | Le serveur va-t-il bien maintenant ? (disque, base, API, sauvegardes) |
| `sudo lims doctor` | Le site ne s'ouvre pas : diagnostic, puis réparations sûres proposées une à une. |
| `sudo lims status` | Version, adresse, état des services, prochaine sauvegarde. |
| `sudo lims update` | Installe une nouvelle version : sauvegarde, migrations, retour arrière automatique en cas d'échec. |
| `sudo lims rollback` | Revient à la version précédente. |
| `sudo lims backup` | Sauvegarde maintenant, sur le serveur et hors machine. |
| `sudo lims backup status` · `test` · `setup` · `enable` · `disable` · `key` | État, test de la destination, choix de la destination, reprise ou suspension, clé de chiffrement. |
| `sudo lims restore` | Restaure une sauvegarde locale, ou depuis la destination hors machine (`--from-destination`). |
| `sudo lims logs [api\|nginx\|postgresql\|update\|backup]` | Derniers journaux. |
| `sudo lims setup-token` | Code demandé par l'assistant d'installation du navigateur. |
| `sudo lims reset-password <identifiant>` | Mot de passe provisoire (administrateur bloqué ou mot de passe perdu). |
| `sudo lims certificate [show\|renew]` | Certificat HTTPS : affichage, empreinte de l'autorité locale, renouvellement. |
| `sudo lims update-source <url>` | Dossier de publication des versions, pour que `lims update` les trouve seul. |
| `lims version` · `lims help` | Version en service, aide. |

## Où sont les fichiers

| Emplacement | Contenu |
| --- | --- |
| `/opt/lims/current` | Version en service (lien vers `/opt/lims/releases/<version>-<date>`). Les 3 dernières versions sont gardées pour le retour arrière. |
| `/opt/lims/shared/.env` | Configuration et secrets (`root:lims`, 0640) : à ne jamais copier hors des sauvegardes. |
| `/opt/lims/shared/backups/` | Sauvegardes locales (base + configuration), 30 jours, 8 au moins. |
| `/opt/lims/shared/state/` | État des opérations, configuration des sauvegardes, clé de sauvegarde (0600). |
| `/opt/lims/shared/logs/` | Journaux des mises à jour, sauvegardes, restaurations. |
| `/opt/lims/shared/tls/` | Certificats HTTPS et autorité locale. |
| `/var/www/lims/` | Fichiers publics : certificat de l'autorité locale (`/lims-ca.crt`), page de maintenance. |

Les tâches planifiées sont des minuteries systemd. La sauvegarde tourne toutes les 6 heures, l'entretien chaque nuit et le contrôle de santé toutes les heures : `systemctl list-timers 'lims-*'`.
