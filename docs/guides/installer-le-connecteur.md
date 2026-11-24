# Installer le connecteur d'automate sur un poste

Le connecteur est un petit programme installé sur le PC relié à l'automate. Il reçoit les résultats (ASTM, HL7 ou fichiers) et les transmet au LIMS. Il garde sur disque tout ce qu'il n'a pas encore pu transmettre : une coupure du réseau ou du serveur ne fait rien perdre.

Ce qu'il faut :

- un poste Windows 10/11 ou Linux, sur le même réseau que le serveur ;
- **Node.js 20 LTS** ou plus récent, installé depuis <https://nodejs.org> ;
- le dossier du connecteur. Il se trouve dans `apps/connector` de l'archive de version, ou sur le serveur dans `/opt/lims/current/apps/connector`. Copiez-le sur le poste.

## 1. Déclarer l'automate et émettre sa clé

Dans le LIMS, en administrateur :

1. Dans **Automates**, déclarez l'automate : code, nom, section, protocole.
2. Ouvrez sa fiche, puis choisissez **Émettre la clé**. La clé et un fichier `config.json` pré-rempli s'affichent **une seule fois** : téléchargez le fichier.
3. Adaptez `config.json` à l'automate. Le tableau complet est dans le `README.md` du connecteur.

| Automate | `mode` | Réglages |
| --- | --- | --- |
| Se connecte au PC (le plus courant) | `tcp-server` | `port` : le port configuré dans l'automate |
| Le PC se connecte à l'automate ou à un convertisseur série/IP | `tcp-client` | `host`, `port` |
| Dépose des fichiers d'export | `folder` | `folder` : dossier de dépôt |

## 2. Installer comme service

### Windows

Ouvrez PowerShell avec **Exécuter en tant qu'administrateur**, placez-vous dans le dossier du connecteur, puis lancez :

```powershell
powershell -ExecutionPolicy Bypass -File install\install-windows.ps1 -Config C:\Users\labo\Downloads\config.json
```

L'installateur fait tout, dans cet ordre :
- il copie le connecteur dans `C:\ProgramData\LIMS\connecteur-<nom>` ;
- il réserve `config.json` aux administrateurs, car il contient la clé ;
- il télécharge le certificat de l'autorité locale du serveur et affiche son empreinte ;
- il ouvre le port dans le pare-feu Windows ;
- il crée la tâche planifiée « LIMS connecteur <nom> », lancée au démarrage de Windows et relancée 5 secondes après tout arrêt.

### Linux

```bash
sudo bash install/install-linux.sh --config ~/config.json
```

Le connecteur devient le service `lims-connector-<nom>`. Il tourne sous un compte système dédié et redémarre seul. Son journal en direct s'affiche avec `journalctl -fu lims-connector-<nom>`.

## 3. Vérifier

1. Comparez l'**empreinte SHA-256** affichée par l'installateur à celle du serveur, obtenue par `sudo lims certificate show`. Si elles diffèrent, arrêtez : le poste ne parle pas au bon serveur.
2. Le journal doit afficher `Connecté au SIL : automate …` puis `En écoute sur …`.
3. Passez un contrôle ou un échantillon sur l'automate. Dans le LIMS, **Automates → l'automate → Messages** doit montrer le message reçu.

Les journaux du jour, la file d'attente et les archives sont dans le sous-dossier `donnees` du dossier d'installation.

## Changer ou retirer un connecteur

- **Nouvelle clé** (perte, départ d'un technicien) : émettez-la dans le LIMS, puis relancez l'installateur avec le nouveau `config.json`. L'ancienne clé est révoquée aussitôt.
- **Retirer** : `install-windows.ps1 -Uninstall -Name <nom>` ou `install-linux.sh --uninstall --name <nom>`. La file d'attente et les journaux sont conservés.
