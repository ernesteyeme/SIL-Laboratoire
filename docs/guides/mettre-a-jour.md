# Mettre à jour le LIMS

Une mise à jour dure quelques minutes, pendant lesquelles le site affiche une page de maintenance. Prévenez le personnel et choisissez un moment calme : pas pendant la validation des résultats du matin.

## Depuis GitHub (installation par install.sh)

Un serveur installé avec `install.sh` connaît déjà sa source de mises à jour, la page des versions du dépôt GitHub :

```bash
sudo lims update
```

La dernière version publiée est téléchargée, son empreinte est vérifiée, puis la mise à jour se déroule comme décrit ci-dessous. Si le serveur est déjà à jour, rien n'est modifié.

## Avec une archive

1. Copiez sur le serveur la nouvelle archive et son empreinte (`lims-1.8.0.tar.gz` et `lims-1.8.0.tar.gz.sha256`), dans le même dossier.
2. Lancez :

    ```bash
    sudo lims update --source ~/lims-1.8.0.tar.gz
    ```

3. Confirmez. Le LIMS fait tout, dans cet ordre :

    | Étape | En cas d'échec |
    | --- | --- |
    | Contrôle de l'empreinte SHA-256 de l'archive | Arrêt, rien n'est modifié. |
    | Sauvegarde de la base (`…-avant-maj-v1.8.0.dump`) | Arrêt, rien n'est modifié. |
    | Migrations de la base, chacune dans une transaction | La migration fautive est annulée, la base d'avant est restaurée, l'ancienne version reste en service. |
    | Bascule vers la nouvelle version, reconfiguration (services, Nginx), redémarrage | Si la nouvelle version ne répond pas en 90 s, retour **automatique** à l'ancienne version (et à l'ancienne base si le schéma avait changé). |
    | Vérification (`lims check`) | Les points à corriger sont affichés. |

4. Lisez le résumé : `Mise à jour réussie : 1.7.0 → 1.8.0`.

Le journal détaillé est dans `/opt/lims/shared/logs/update-<date>.log`, ou s'affiche avec `sudo lims logs update`.

## Depuis un autre dossier de publication

Si l'équipe technique publie les versions ailleurs que sur GitHub, dans un dossier web (voir [Publier une version](publier-une-version.md)), enregistrez-le une fois :

```bash
sudo lims update-source https://depot.pnls.cd/lims
```

Ensuite, `sudo lims update` installe la dernière version publiée. L'empreinte est lue dans `latest.json` et vérifiée.

## Revenir à la version précédente

Si un problème apparaît après la mise à jour :

```bash
sudo lims rollback
```

Les 3 dernières versions restent sur le disque. Si la mise à jour avait modifié la base, l'ancienne version ne peut fonctionner qu'avec la base d'avant : celle-ci est alors restaurée depuis la sauvegarde prise avant la mise à jour. **Les saisies faites depuis la mise à jour sont alors perdues.** Le LIMS l'annonce et prend d'abord une copie de sécurité (`…-avant-retour-arriere.dump`).

## Docker

Une installation Docker se met à jour avec son propre script. Voir [Installer le LIMS avec Docker](installer-avec-docker.md#mettre-a-jour).
