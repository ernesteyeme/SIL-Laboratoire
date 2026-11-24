# Connecteur de poste du LIMS

Petit programme à installer sur le PC relié à un automate. Il reçoit les résultats de l'automate et les transmet au SIL. Il ne demande **aucune dépendance** : Node.js 20 ou plus suffit.

## Ce qu'il fait

| Mode (`mode`) | Protocole (`protocol`) | Usage |
|---|---|---|
| `tcp-server` | `astm` ou `hl7` | L'automate se connecte au PC (cas le plus courant). |
| `tcp-client` | `astm` ou `hl7` | Le connecteur se connecte à l'automate ou à un convertisseur série/IP ; il se reconnecte seul après une coupure. |
| `folder` | `file` | L'automate dépose des fichiers d'export (CSV, ASTM, HL7) dans un dossier. |

- **ASTM E1381 (couche liaison)** : établissement ENQ/ACK, trames numérotées, vérification des sommes de contrôle (NAK si erreur, l'automate renvoie la trame), trames fragmentées ETB recollées, retransmissions sans doublon, fin EOT, abandon après 30 s d'inactivité.
- **Requête hôte ASTM** : quand l'automate envoie un enregistrement `Q` pour un tube, le connecteur lui renvoie les tests demandés pour ce tube (liste de travail du SIL).
- **HL7 MLLP** : l'accusé de réception (ACK) du SIL est renvoyé à l'automate.
- **File d'attente sur disque** : chaque message est écrit **avant** d'être envoyé et n'est effacé qu'après acceptation par le SIL. Coupure réseau, SIL arrêté ou redémarrage du PC : rien n'est perdu, l'envoi reprend seul (5 s, puis jusqu'à 5 min entre deux essais). En HL7, si le SIL est injoignable, un ACK local est renvoyé à l'automate et le message part dès le retour du réseau.
- Un message renvoyé deux fois est reconnu par le SIL et n'est pas réintégré.

**Liaison série (RS-232)** : le connecteur ne pilote pas directement un port série. Utilisez un convertisseur série/Ethernet (type Moxa NPort, très répandu en laboratoire) en mode `tcp-client`, ou le logiciel d'interface du fabricant en sortie TCP ou fichier.

## Installation

1. Installer Node.js 20 LTS ou plus récent sur le poste.
2. Copier ce dossier sur le poste. Il se trouve dans `apps/connector` de l'archive de version, ou sur le serveur dans `/opt/lims/current/apps/connector`.
3. Dans le LIMS : **Automates → l'automate → Émettre la clé** (administrateur). La clé et un `config.json` pré-rempli s'affichent **une seule fois** : enregistrez le fichier, puis adaptez le port, le dossier et l'encodage si besoin.
4. Installer le connecteur comme service. Il démarre avec le poste, se relance seul s'il s'arrête, et fait confiance au certificat de l'autorité locale du serveur, téléchargé depuis `http://<serveur>/lims-ca.crt`.

**Windows** (PowerShell « Exécuter en tant qu'administrateur », depuis ce dossier) :

```powershell
powershell -ExecutionPolicy Bypass -File install\install-windows.ps1 -Config C:\Users\labo\Downloads\config.json
```

Le connecteur est installé dans `C:\ProgramData\LIMS\connecteur-<nom>`. Il est lancé au démarrage de Windows par la tâche planifiée « LIMS connecteur <nom> », sous le compte SYSTEM. Le port d'écoute est ouvert dans le pare-feu Windows (mode `tcp-server`).

**Linux** (Ubuntu, Debian…) :

```bash
sudo bash install/install-linux.sh --config ~/config.json
journalctl -fu lims-connector-<nom>          # journal en direct
```

Le connecteur est installé dans `/opt/lims-connector/<nom>`, comme service systemd `lims-connector-<nom>` exécuté sous un compte système dédié. `config.json` n'est lisible que par ce service.

Le `<nom>` vient du code de l'automate (par exemple `xn1000`) ; on peut le choisir avec `-Name` ou `--name`. L'installateur affiche l'empreinte SHA-256 du certificat téléchargé : comparez-la à celle que donne `sudo lims certificate show` sur le serveur. Pour retirer un connecteur, utilisez `-Uninstall -Name <nom>` ou `--uninstall --name <nom>` : la file d'attente et les journaux sont conservés.

Sans installation, pour un essai : `node src/index.mjs config.json`. Au démarrage, le connecteur vérifie sa clé auprès du LIMS et affiche l'automate reconnu.

## Configuration (`config.json`)

| Clé | Rôle |
|---|---|
| `apiUrl` | Adresse de l'API du SIL, par exemple `https://sil.mon-labo.cd/api` |
| `instrumentKey` | Clé du connecteur émise dans le SIL (à garder secrète) |
| `protocol` | `astm`, `hl7` ou `file` |
| `mode` | `tcp-server`, `tcp-client` ou `folder` |
| `host`, `port` | Écoute (serveur) ou adresse de l'automate (client) |
| `encoding` | `latin1` (défaut, la plupart des automates) ou `utf8` |
| `hostQuery` | `false` pour ignorer les requêtes hôte ASTM |
| `dataDir` | Dossier des journaux, de la file d'attente et des archives (défaut : `donnees`) |
| `folder`, `extensions`, `pollSeconds` | Mode dossier : dossier surveillé, extensions acceptées, fréquence |

Dans `dataDir` :
- `connecteur-AAAA-MM-JJ.log` : journal du jour ;
- `file-attente/` : messages pas encore acceptés par le SIL ;
- `file-attente/erreurs/` : messages refusés définitivement, avec leur motif ;
- `archives/` (mode dossier) : fichiers transmis, rangés par jour.

Pour un diagnostic détaillé des échanges avec l'automate, lancez le connecteur avec la variable `LIMS_DEBUG=1`.

## Tester sans automate

```bash
npm test                                                  # tests de la couche liaison ASTM et MLLP
node src/simulate-instrument.mjs --port 5000 --specimen 2611220001             # numération ASTM
node src/simulate-instrument.mjs --port 5000 --specimen 2611220001 --corrupt   # trame corrompue → NAK puis renvoi
node src/simulate-instrument.mjs --port 5000 --specimen 2611220001 --query     # requête hôte
node src/simulate-instrument.mjs --port 5000 --qc QC-N1 --hgb 13.6             # contrôle qualité
node src/simulate-instrument.mjs --port 5001 --specimen 2611220002 --hl7 --glu 5.1   # HL7 MLLP
```
