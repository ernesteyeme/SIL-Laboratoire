# Changer de serveur

Ce guide déplace un laboratoire, avec toutes ses données, de l'ancien serveur vers une nouvelle machine : remplacement du matériel, panne, nouvelle salle serveur. Il fonctionne même si l'ancien serveur est hors service, pourvu que ses sauvegardes hors machine et sa **clé de sauvegarde** soient disponibles.

## Avant de commencer

- La nouvelle machine est sous Ubuntu 24.04 LTS, comme dans [Installer le LIMS sur Ubuntu](installer-sur-ubuntu.md).
- Vous avez la **clé de sauvegarde** de l'ancien serveur, notée lors de `lims backup setup`. Si l'ancien serveur fonctionne encore, `sudo lims backup key` l'affiche.
- La destination hors machine (machine Linux, partage Windows ou disque USB) est joignable depuis la nouvelle machine.
- Utilisez sur la nouvelle machine **la même version du LIMS, ou une plus récente** : la restauration applique d'elle-même les migrations manquantes.

## 1. Dernière sauvegarde de l'ancien serveur

Si l'ancien serveur fonctionne encore, prévenez le personnel, arrêtez les saisies, puis envoyez une dernière copie hors machine :

```bash
sudo lims backup
sudo systemctl stop lims-api        # plus aucune saisie ne doit partir sur l'ancien serveur
```

## 2. Installer le LIMS sur la nouvelle machine

Suivez [Installer le LIMS sur Ubuntu](installer-sur-ubuntu.md), **étapes 1 à 5 seulement**. Ne terminez pas l'assistant du navigateur : la base restaurée apportera le laboratoire et les comptes.

## 3. Restaurer

```bash
sudo lims restore --from-destination
```

1. Indiquez la destination qu'utilisait l'ancien serveur : même adresse, même compte et même dossier, ou le même disque USB.
2. Choisissez le laboratoire, puis la sauvegarde la plus récente, en tête de liste.
3. Saisissez la clé de sauvegarde de l'ancien serveur.
4. Confirmez avec `o`.

La base et la configuration de l'ancien serveur sont restaurées : clé `INTEROP_SECRET_KEY` (secrets DHIS2, VLSM et OpenHIM), secret des jetons. La nouvelle machine garde son propre mot de passe de base, son adresse web et son certificat. La destination et la clé de sauvegarde restent enregistrées : les sauvegardes de la nouvelle machine continuent dans le même dossier.

## 4. Vérifier

```bash
sudo lims check
sudo lims backup status
```

Connectez-vous avec un compte habituel, puis :

- **Piste d'audit → Vérifier l'intégrité** : chaîne intacte ;
- **Interopérabilité → Connexions → Tester** sur chaque connexion : le secret doit être lisible ;
- les derniers dossiers saisis sur l'ancien serveur doivent être présents.

## 5. Basculer les postes

- **Même nom, même adresse IP** (ancienne machine retirée) : rien à faire, sauf avec l'autorité locale. Le nouveau serveur a sa propre autorité locale : chaque poste doit importer son nouveau certificat `http://<serveur>/lims-ca.crt`.
- **Nouvelle adresse IP** : mettez à jour le DNS du réseau ou le fichier `hosts` des postes.
- **Connecteurs d'automates** : ils gardent leur clé, qui est dans la base restaurée. Mettez à jour `apiUrl` si l'adresse a changé, et le certificat de l'autorité locale : réinstallez le connecteur avec le même `config.json` (voir [Installer le connecteur](installer-le-connecteur.md)).

## 6. Retirer l'ancien serveur

Gardez l'ancien serveur éteint, sans l'effacer, pendant au moins un mois. Effacez ensuite ses disques de façon sûre : ils contiennent des données de patients.
