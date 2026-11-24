# Restaurer une sauvegarde

Une restauration **remplace toute la base** par le contenu d'une sauvegarde. Les saisies faites après cette sauvegarde sont perdues.

Avant de remplacer quoi que ce soit, le LIMS prend une copie de sécurité de la base actuelle. Elle est nommée `…-avant-restauration.dump` et se trouve dans `/opt/lims/shared/backups/db`. Une restauration se défait donc en restaurant cette copie.

## Depuis une sauvegarde de ce serveur

```bash
sudo lims restore
```

1. Choisissez la sauvegarde dans la liste. La plus récente est en premier ; le nom contient la date, l'heure et la version du LIMS.
2. Confirmez avec `o`.

Le LIMS fait alors tout, dans cet ordre :
- il contrôle l'empreinte SHA-256 de la sauvegarde ;
- il arrête l'API et remplace la base ;
- il remet les droits des rôles PostgreSQL ;
- il applique les migrations si la sauvegarde vient d'une version plus ancienne ;
- il redémarre et vérifie que le site répond.

Pour voir la liste sans rien restaurer : `sudo lims restore --list`. Pour un fichier précis : `sudo lims restore --file /chemin/sauvegarde.dump`.

## Depuis la destination hors machine

Ce cas se présente quand le serveur est neuf, ou quand ses sauvegardes locales sont perdues.

```bash
sudo lims restore --from-destination
```

1. Si ce serveur ne connaît pas encore la destination, répondez aux questions de [Configurer les sauvegardes hors machine](sauvegardes-hors-machine.md). Donnez la destination qu'utilisait l'ancien serveur.
2. Choisissez le laboratoire, puis la sauvegarde.
3. Saisissez la **clé de sauvegarde** de l'ancien serveur, avec ou sans les tirets. Elle n'est demandée qu'une fois : ce serveur la garde ensuite, et ses propres copies hors machine resteront lisibles avec la même clé.

    !!! failure "« Déchiffrement impossible : clé de sauvegarde incorrecte ou copie altérée »"
        La clé saisie n'est pas celle de l'ancien serveur. Rien n'a été modifié : relancez la commande avec la bonne clé. Sur l'ancien serveur, s'il fonctionne encore, `sudo lims backup key` l'affiche.

4. Confirmez avec `o`.

Restaurée depuis la destination, la sauvegarde ramène aussi la **configuration** de l'ancien serveur. C'est elle qui contient la clé `INTEROP_SECRET_KEY` : sans elle, les mots de passe des connexions DHIS2, VLSM et OpenHIM devraient être ressaisis. Ce qui appartient à la nouvelle machine est conservé : mot de passe de la base, adresse web, mode HTTPS.

## Vérifier après une restauration

```bash
sudo lims check
```

Puis, dans le navigateur, avec un compte administrateur :

- **Piste d'audit → Vérifier l'intégrité** : la chaîne d'audit doit être intacte ;
- **Interopérabilité → Connexions → Tester** : le test doit aboutir, ou échouer pour une raison réseau, jamais par un « secret illisible » ;
- quelques dossiers récents doivent être présents.

Consignez la restauration (date, sauvegarde utilisée, motif, vérifications) dans le registre qualité.
