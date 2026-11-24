# Configurer les sauvegardes hors machine

Le LIMS se sauvegarde lui-même **toutes les 6 heures**. Chaque sauvegarde contient la base de données, contrôlée par une relecture et une empreinte SHA-256, ainsi que la configuration (`.env` avec ses clés, certificats).

Les copies restent 30 jours sur le serveur, et les 8 plus récentes sont toujours gardées. Mais une sauvegarde qui reste sur le serveur disparaît avec lui, en cas de panne de disque, de vol ou d'incendie. Il faut donc au moins **une destination hors du serveur**.

## Ce qui part hors du serveur

Les copies envoyées hors du serveur sont **chiffrées (AES-256)** avec la **clé de sauvegarde**. Elles contiennent en effet des données de patients et les secrets du serveur. La clé est créée au premier `lims backup setup` et reste sur le serveur, lisible par root seulement.

!!! danger "Notez la clé de sauvegarde hors du serveur"
    Si le serveur est perdu, la clé est **indispensable** pour restaurer les copies sur une autre machine. Recopiez-la dans le registre du laboratoire, dans une enveloppe scellée ou dans un coffre-fort de mots de passe. Pour l'afficher de nouveau : `sudo lims backup key`.

## Choisir la destination

```bash
sudo lims backup setup
```

| Question | Réponse |
| --- | --- |
| Où envoyer les sauvegardes ? | Voir les trois cas ci-dessous. |
| Nom de ce laboratoire dans la destination | Un nom court et unique, par exemple `LPBM-Lubumbashi`. Plusieurs laboratoires peuvent partager la même destination : chacun a son dossier. |

### Une autre machine Linux (SSH) — recommandé

Il s'agit par exemple d'un serveur de la DPS, du PNLS ou d'un autre bâtiment. Sur cette machine, créez un compte dédié, par exemple `sudo adduser sauvegarde`.

| Question | Réponse |
| --- | --- |
| Adresse de la machine de sauvegarde | Son nom ou son adresse IP. |
| Port SSH | `22`, sauf configuration particulière. |
| Compte sur cette machine | `sauvegarde` |
| Dossier de destination | Appuyez sur Entrée (`sauvegardes-lims`, dans le dossier personnel du compte). |
| Mot de passe | Celui du compte `sauvegarde`, **demandé une seule fois** : le serveur installe ensuite sa propre clé SSH et n'en a plus besoin. |

### Un dossier partagé Windows

Il s'agit d'un poste ou d'un serveur Windows du laboratoire, avec un dossier partagé en lecture et écriture pour un compte Windows.

| Question | Réponse |
| --- | --- |
| Partage Windows | `\\192.168.1.20\Sauvegardes` (ou `//192.168.1.20/Sauvegardes`) |
| Compte Windows | Le compte qui a les droits sur le partage. |
| Domaine | Vide, sauf réseau avec domaine Active Directory. |
| Mot de passe | Le mot de passe de ce compte. Il est conservé sur le serveur, lisible par root seulement. |

### Une clé ou un disque USB

Formatez le disque en **exFAT** ou **ext4**, branchez-le sur le serveur, puis choisissez-le dans la liste. Le disque est reconnu par son identifiant (UUID) : on peut le débrancher pour le ranger au coffre et le rebrancher plus tard. Une copie programmée pendant son absence échoue sans rien perdre, et `lims health` le signale.

## Vérifier

```bash
sudo lims backup test      # la destination est-elle joignable et inscriptible ? (ne copie rien)
sudo lims backup           # sauvegarder maintenant, ici et hors machine
sudo lims backup status    # dernière sauvegarde locale, dernière copie hors machine, prochaine échéance
```

`sudo lims check` signale `WARN Sauvegarde hors machine` si aucune copie n'a réussi depuis 24 heures. Il signale aussi `FAIL Chiffrement des copies hors machine` si la clé de sauvegarde a disparu ou n'est plus protégée.

## Suspendre, reprendre, changer

```bash
sudo lims backup disable   # suspend les copies hors machine (les sauvegardes locales continuent)
sudo lims backup enable    # les reprend
sudo lims backup setup     # change de destination (la clé de sauvegarde ne change pas)
```

Sur la destination, les copies de plus de 90 jours sont effacées (365 jours sur un disque USB).

## Tester une restauration

Une sauvegarde n'est sûre qu'une fois restaurée avec succès. Au moins une fois par trimestre, restaurez la dernière copie hors machine sur une machine de test, en suivant [Restaurer une sauvegarde](restaurer-une-sauvegarde.md). Notez la date et le résultat dans le registre qualité (ISO 15189 §7.11).
