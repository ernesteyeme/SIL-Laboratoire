# Installer le LIMS sur Windows (WSL 2)

Le LIMS tourne sous Ubuntu. Sur un PC Windows, il s'installe dans **Ubuntu pour Windows (WSL 2)**, avec le même installateur et la même commande `lims` que sur un vrai serveur Ubuntu.

Cette installation convient à un petit laboratoire qui n'a qu'un PC. Un serveur Ubuntu dédié reste préférable : le LIMS dépend alors aussi des mises à jour et des redémarrages de Windows.

Ce qu'il faut :

- **Windows 11** (22H2 ou plus récent), à jour ;
- 8 Go de mémoire au moins ;
- un compte administrateur ;
- l'archive de version `lims-x.y.z.tar.gz` et son `.sha256`.

## 1. Installer Ubuntu 24.04 dans WSL

1. Ouvrez PowerShell avec **Exécuter en tant qu'administrateur**, puis lancez :

    ```powershell
    wsl --install -d Ubuntu-24.04
    ```

2. Redémarrez si Windows le demande. À l'ouverture d'Ubuntu, créez un compte Linux : un identifiant et un mot de passe, à noter.

3. Rendez le LIMS joignable depuis les autres postes : créez le fichier `C:\Users\<vous>\.wslconfig` avec ces lignes. La partie 3 le garde ensuite actif en permanence.

    ```ini
    [wsl2]
    networkingMode=mirrored
    ```

4. Dans Ubuntu, vérifiez que systemd est actif. C'est le cas par défaut avec Ubuntu 24.04 :

    ```bash
    cat /etc/wsl.conf        # doit contenir : [boot] systemd=true
    ```

    S'il manque, ajoutez ces deux lignes au fichier avec `sudo nano /etc/wsl.conf`.

5. Dans PowerShell administrateur, redémarrez WSL et ouvrez les ports du site :

    ```powershell
    wsl --shutdown
    New-NetFirewallHyperVRule -Name LIMS-Web -DisplayName "LIMS (HTTP/HTTPS)" -Direction Inbound `
      -VMCreatorId "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}" -Protocol TCP -LocalPorts 80,443
    ```

## 2. Installer le LIMS

1. Copiez l'archive dans Ubuntu. L'Explorateur Windows montre le dossier Linux sous **Linux → Ubuntu-24.04 → home → <compte>**.
2. Suivez [Installer le LIMS sur Ubuntu](installer-sur-ubuntu.md) à partir de l'étape 1, dans le terminal Ubuntu. L'**adresse web** proposée est le nom du PC Windows, ou `lims`.
3. Depuis les autres postes, ouvrez `https://<adresse IP du PC Windows>/`.

## 3. Démarrer le LIMS avec Windows

WSL ne démarre pas tout seul. Créez une tâche planifiée qui le lance au démarrage du PC :

1. Ouvrez le **Planificateur de tâches**, puis **Créer une tâche**.
2. Onglet **Général** : nom « LIMS — WSL », votre compte Windows, **Exécuter même si l'utilisateur n'est pas connecté**.
3. Onglet **Déclencheurs** : **Au démarrage**.
4. Onglet **Actions** : programme `wsl.exe`, arguments `-d Ubuntu-24.04 --exec sleep infinity`.
5. Onglet **Paramètres** : décochez **Arrêter la tâche si elle s'exécute plus de**.

Redémarrez le PC, puis vérifiez depuis un autre poste que le site s'ouvre sans avoir ouvert de session.

## 4. Sauvegardes

Les sauvegardes locales sont **dans le même PC** que le LIMS : configurez absolument une destination hors machine, comme un disque USB ou un dossier partagé d'un autre poste (voir [Configurer les sauvegardes hors machine](sauvegardes-hors-machine.md)). Un disque USB doit être rattaché à WSL avec `usbipd`. Le plus simple sous Windows est donc un **dossier partagé d'un autre poste** ou une **autre machine Linux**.

## Mises à jour de Windows

Programmez les redémarrages de Windows en dehors des heures d'activité du laboratoire : **Paramètres → Windows Update → Options avancées → Heures d'activité**. Après chaque redémarrage, `sudo lims health` dans Ubuntu confirme que tout est reparti.
