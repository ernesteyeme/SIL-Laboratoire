# Dépannage et entretien

## Le site ne s'ouvre pas

Sur le serveur :

```bash
sudo lims doctor
```

Le diagnostic contrôle, dans l'ordre :
- le disque ;
- les droits du fichier de configuration ;
- la commande `lims` ;
- PostgreSQL ;
- le service de l'API et ses migrations ;
- Nginx et le site en HTTPS ;
- le certificat.

Pour chaque problème trouvé, il propose une réparation sûre : `Réparer : … ? [O/n]`. Il ne supprime jamais de données.

- `sudo lims doctor --check` diagnostique sans rien réparer.
- `sudo lims doctor --yes` applique toutes les réparations sans poser de question.

Le rapport complet est écrit dans `/var/log/lims-doctor-<date>.log`. Une copie sans mots de passe est déposée dans votre dossier personnel (`site-report.txt`), pour l'envoyer au support.

Si le site ne répond toujours pas :

```bash
sudo lims status           # services, version, adresse
sudo lims logs api         # 200 dernières lignes du journal de l'API
sudo lims logs nginx
sudo lims logs postgresql
```

## Problèmes courants

| Symptôme | Cause probable | Que faire |
| --- | --- | --- |
| Page « Maintenance en cours » qui se recharge seule | L'API redémarre (mise à jour, restauration) ou ne démarre plus. | Attendre une minute, puis `sudo lims doctor`. |
| Le navigateur signale une connexion non sécurisée | Le certificat de l'autorité locale n'est pas importé sur ce poste. | Importer `http://<serveur>/lims-ca.crt` (voir [Installer sur Ubuntu](installer-sur-ubuntu.md#4-preparer-les-postes)). |
| L'avertissement apparaît sur tous les postes | Le certificat a expiré, ou le serveur a changé d'adresse IP. | `sudo lims certificate renew`. Avec un nouveau certificat d'autorité, l'importer de nouveau sur les postes. |
| L'administrateur a perdu son mot de passe ou son compte est bloqué | — | `sudo lims reset-password <identifiant>` donne un mot de passe provisoire, à changer à la connexion. L'opération est inscrite dans la piste d'audit. |
| `WARN Heure synchronisée` | chrony n'est pas actif : l'horodatage de l'audit et des résultats en dépend. | `sudo systemctl enable --now chrony`. |
| `WARN Sauvegarde hors machine` | Pas de copie réussie depuis 24 h (disque USB débranché, partage ou machine éteints, réseau…). | `sudo lims backup test`, puis `sudo lims backup`. |
| `FAIL Chiffrement des copies hors machine` | La clé de sauvegarde a disparu ou ses droits ont changé. | `sudo lims backup setup` ; noter la nouvelle clé si elle est recréée. |
| Disque plein | Journaux ou sauvegardes anciennes. | `sudo lims doctor` propose de purger ; `sudo lims housekeeping`. |
| Les résultats d'un automate n'arrivent plus | Le connecteur est arrêté, ou sa clé a été remplacée. | Sur le poste : `journalctl -u lims-connector-<nom>` (Linux) ou `C:\ProgramData\LIMS\connecteur-<nom>\donnees` (Windows). Les messages en attente partent seuls au retour. |
| Un connecteur signale un certificat refusé | Le serveur a une nouvelle autorité locale (nouveau serveur, certificat renouvelé). | Relancer l'installateur du connecteur avec le même `config.json`. |

## Entretien programmé

Ces tâches tournent seules : `systemctl list-timers 'lims-*'`.

| Tâche | Fréquence | Rôle |
| --- | --- | --- |
| `lims-backup` | toutes les 6 heures | Sauvegarde vérifiée de la base et de la configuration, copie chiffrée hors machine. |
| `lims-health` | toutes les heures | Disque, base, API, âge des sauvegardes. Les anomalies vont dans le journal système (`journalctl -t lims-health`). |
| `lims-housekeeping` | chaque nuit | Purge des journaux de plus de 90 jours et des sauvegardes locales de plus de 30 jours (les 8 dernières sont toujours gardées). |

## Contrôles réguliers conseillés

| Fréquence | Contrôle |
| --- | --- |
| Chaque semaine | `sudo lims health` et `sudo lims backup status`. |
| Chaque mois | `sudo lims check` ; **Piste d'audit → Vérifier l'intégrité** dans le LIMS. |
| Chaque trimestre | Restauration d'essai de la dernière copie hors machine sur une machine de test ([Restaurer une sauvegarde](restaurer-une-sauvegarde.md)), consignée dans le registre qualité. |
| Chaque année | Vérifier que la clé de sauvegarde notée hors du serveur est toujours lisible et retrouvable. |
