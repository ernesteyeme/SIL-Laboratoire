# Installer le LIMS sur Ubuntu 24.04 LTS

Ce guide installe le LIMS sur une machine neuve. Il vaut pour le serveur d'un laboratoire comme pour un serveur central.

Ce qu'il faut :

- une machine sous **Ubuntu 24.04 LTS** (ou une LTS plus récente), 4 Go de mémoire et 40 Go de disque au moins ;
- un compte avec les droits `sudo` ;
- un accès à Internet pendant l'installation, pour les paquets Ubuntu, Node.js et le LIMS lui-même, publié sur GitHub ([ernesteyeme/SIL-Laboratoire](https://github.com/ernesteyeme/SIL-Laboratoire/releases)).

La machine doit être **réservée au LIMS**. Les ports 80 et 443 ne doivent pas être pris par un autre site : une installation d'InteLIS sur la même machine utilise déjà ces ports, et l'installateur s'arrête alors avec un message clair.

Pour déplacer un laboratoire existant, avec ses données, vers une nouvelle machine, suivez plutôt [Changer de serveur](changer-de-serveur.md).

## 1. Installer

1. Ouvrez un terminal et téléchargez l'installateur :

    ```bash
    cd ~ && wget -O install.sh "https://raw.githubusercontent.com/ernesteyeme/SIL-Laboratoire/main/scripts/install.sh?v=$(date +%s)"
    ```

    Téléchargez-le d'abord, puis lancez-le : ne l'envoyez **pas** dans bash par un tube (`curl … | bash`), car ses questions liraient le script lui-même.

2. Lancez l'installateur :

    ```bash
    sudo bash install.sh
    ```

    Il trouve la dernière version publiée, la télécharge, vérifie son empreinte SHA-256, puis lance l'installation. Pour une version précise : `sudo bash install.sh --version 1.7.0`.

    !!! failure "S'il s'arrête avec « Ce script requiert Ubuntu 24.04 LTS ou plus récent »"
        Réinstallez la machine en Ubuntu 24.04 LTS, puis recommencez à l'étape 1.

    !!! info "Machine sans accès à GitHub"
        Copiez sur la machine l'archive `lims-x.y.z.tar.gz` et son `.sha256`, téléchargées depuis la page des versions du dépôt (clé USB, `scp`…). Ensuite :
        `sha256sum -c lims-x.y.z.tar.gz.sha256 && tar -xzf lims-x.y.z.tar.gz && sudo bash lims-x.y.z/scripts/setup.sh`

3. Répondez aux questions :

    | Question | Réponse |
    | --- | --- |
    | Dossier d'installation | Appuyez sur Entrée (`/opt/lims`). |
    | Adresse web de ce serveur | Appuyez sur Entrée (`lims`), ou donnez le nom de domaine du serveur (`lims.pnls.cd`). |
    | Certificat HTTPS | **Autorité locale du laboratoire** pour un réseau local sans Internet. **Let's Encrypt** pour un nom de domaine public dont le port 80 est ouvert sur Internet. **Certificat fourni** si l'établissement a ses propres fichiers PEM. |
    | Fuseau horaire | `Africa/Kinshasa` (UTC+1) ou `Africa/Lubumbashi` (UTC+2). |
    | Est-ce correct ? | Relisez le résumé, puis appuyez sur Entrée (Oui). |

    !!! info "S'il demande « Reprendre avec les mêmes réponses ? »"
        Une installation précédente s'est arrêtée en cours de route. Appuyez sur Entrée (Oui) : l'installation reprend là où elle s'était arrêtée.

    !!! info "S'il signale « Une base lims contenant des données existe déjà »"
        L'installateur est relancé sur une machine qui contient déjà des données. Choisissez **Conserver une copie, puis repartir d'une base vide** pour mettre l'ancienne base de côté sans la perdre, ou **Garder les données existantes** pour la reprendre telle quelle.

4. Attendez la fin. L'installateur fait tout, dans cet ordre :
    - il installe PostgreSQL, Nginx, chrony (heure exacte) et les outils de sauvegarde ;
    - il crée la base et deux rôles : le propriétaire, pour les migrations, et le rôle applicatif, qui ne peut ni modifier le schéma ni désactiver les triggers d'audit ;
    - il génère les secrets ;
    - il démarre l'API ;
    - il configure le HTTPS ;
    - il programme les sauvegardes ;
    - il fait une première sauvegarde.

    Il se termine par `Installation terminée`.

5. Lisez la liste **Vérification de l'installation**, juste au-dessus :

    | Mot | Signification |
    | --- | --- |
    | `PASS` | Le contrôle est réussi. |
    | `WARN` | Le LIMS fonctionne, mais un réglage n'est pas celui d'un laboratoire. La ligne suivante donne la commande qui corrige. |
    | `FAIL` | Le LIMS ne peut pas fonctionner correctement tant que ce point n'est pas réglé. La ligne suivante donne la commande qui corrige. |
    | `SKIP` | Le contrôle ne concerne pas cette machine. |

    Après une installation neuve, deux avertissements sont normaux : **Sauvegarde hors machine** (étape 9) et **Assistant d'installation** (étapes 6 à 8). Lancez chaque commande indiquée, puis vérifiez de nouveau :

    ```bash
    sudo lims check
    ```

## 2. Terminer dans le navigateur

6. Ouvrez `https://lims/` sur le serveur. Depuis un autre poste du réseau, ouvrez `https://<adresse IP du serveur>/`. L'installateur affiche les adresses à la fin.

    !!! info "Le navigateur signale une connexion non sécurisée"
        Avec l'autorité locale, chaque poste doit faire confiance une fois au certificat du laboratoire (étape 10). En attendant, le navigateur permet de continuer : « Paramètres avancés » puis « Continuer ».

7. L'assistant d'installation demande le **code d'installation** affiché à la fin de l'installateur. Si vous ne l'avez plus :

    ```bash
    sudo lims setup-token
    ```

8. Remplissez les deux écrans suivants :
    - **Laboratoire** : nom, sigle, ville, e-mail, fuseau horaire, devise de base (CDF ou USD) et, si besoin, la seconde devise. La case **catalogue de démarrage** charge des examens courants, dont la charge virale VIH et la PCR ADN VIH-1 (EID) : leurs tarifs et valeurs de référence sont **indicatifs** et doivent être validés par le biologiste.
    - **Administrateur** : identifiant, nom complet, e-mail et mot de passe (10 caractères au moins, avec majuscule, minuscule, chiffre et caractère spécial).

    Choisissez **Terminer**, puis **Se connecter**. Le code d'installation ne sert plus : l'assistant est fermé dès que le premier compte existe.

## 3. Mettre les sauvegardes à l'abri

9. Choisissez où envoyer les sauvegardes : une autre machine Linux, un dossier partagé Windows ou un disque USB.

    ```bash
    sudo lims backup setup
    ```

    L'installateur affiche alors une **clé de sauvegarde**. **Recopiez-la hors du serveur**, dans le registre du laboratoire ou un coffre-fort de mots de passe : elle est indispensable pour restaurer sur une autre machine. Le détail des questions est dans [Configurer les sauvegardes hors machine](sauvegardes-hors-machine.md).

## 4. Préparer les postes

10. Avec l'autorité locale, sur **chaque poste** (une seule fois) :
    1. Ouvrez `http://<adresse du serveur>/lims-ca.crt` pour télécharger le certificat du laboratoire.
    2. Installez-le selon le poste :
        - **Windows** : double-cliquez sur le fichier, puis **Installer le certificat**, **Ordinateur local**, **Placer tous les certificats dans le magasin suivant**, et choisissez **Autorités de certification racines de confiance**. Chrome et Edge l'utilisent aussitôt ; fermez puis rouvrez Firefox.
        - **Ubuntu** : `sudo cp lims-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates`.
        - **Android** : **Paramètres**, **Sécurité**, **Chiffrement et identifiants**, **Installer un certificat**, puis **Certificat CA**.
    3. Comparez l'empreinte affichée par le poste à celle du serveur : `sudo lims certificate show`.

    Pour que les postes ouvrent `https://lims/` plutôt que l'adresse IP, ajoutez le nom au DNS du réseau (box, serveur DNS). À défaut, ajoutez la ligne `192.168.1.10  lims` au fichier `hosts` de chaque poste, avec l'adresse IP réelle du serveur.

11. Pour relier un automate, suivez [Installer le connecteur d'automate](installer-le-connecteur.md).

## 5. Vérifier

12. Connectez-vous avec le compte créé à l'étape 8. Dans **Paramètres**, vérifiez le laboratoire, puis créez les comptes du personnel dans **Utilisateurs**.
13. Sur le serveur, vérifiez que tout est vert et que la sauvegarde hors machine a réussi :

    ```bash
    sudo lims check
    sudo lims backup status
    ```

Pour installer ensuite une nouvelle version, suivez [Mettre à jour le LIMS](mettre-a-jour.md).

## Installation sans questions

L'installateur accepte des options, ce qui permet de préparer plusieurs serveurs à l'identique :

```bash
sudo bash install.sh --yes --host lims --tls local --timezone Africa/Lubumbashi
sudo bash install.sh --yes --host lims.pnls.cd --tls letsencrypt --email informatique@pnls.cd
sudo bash install.sh --yes --tls provided --cert /root/lims.pem --key /root/lims.key --host lims.hopital.cd
```

`sudo bash install.sh --help` et `setup.sh --help` donnent la liste complète des options (`--dir`, `--db-strategy fresh|keep`, `--source` pour une archive ou une adresse).

L'installateur peut être relancé sans risque sur la même version : il répare la configuration (services, Nginx, droits des fichiers) sans toucher aux données.
