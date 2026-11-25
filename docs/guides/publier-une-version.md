# Publier une version (équipe technique)

Une version est une archive autonome, `lims-x.y.z.tar.gz`. Elle contient :
- l'API compilée avec ses dépendances de production ;
- l'interface web compilée ;
- le connecteur d'automate et ses installateurs ;
- les scripts d'installation et d'exploitation (`setup.sh`, `lims`), les fichiers Docker et cette documentation.

Un serveur de laboratoire n'a donc besoin ni de pnpm, ni d'outils de compilation, ni d'accès au registre npm.

## Publier sur GitHub (méthode habituelle)

Le dépôt [ernesteyeme/SIL-Laboratoire](https://github.com/ernesteyeme/SIL-Laboratoire) publie les versions lui-même :

1. Mettez à jour `version` dans `package.json`, puis envoyez la modification sur `main`. L'intégration continue vérifie les types, les tests et les scripts.
2. C'est tout : si la publication `vX.Y.Z` n'existe pas encore, le workflow la crée, étiquette comprise. Vous pouvez aussi poser l'étiquette vous-même (`git tag v1.8.0 && git push origin v1.8.0`) ou la créer depuis la page **Releases** de GitHub.
3. Le workflow **Publication** (`.github/workflows/release.yml`) construit l'archive, tests compris, puis la publie dans **Releases** avec son `.sha256` et `latest.json`.

Dès lors :
- `install.sh` installe cette version sur les nouveaux serveurs ;
- `sudo lims update` la propose aux serveurs existants.

Une étiquette qui ne correspond pas à `package.json` fait échouer la publication.

## Construire à la main

Sur un poste de développement (Node.js 20.19+, pnpm 10, accès au registre npm) :

1. Mettez à jour `version` dans `package.json` à la racine. Suivez la règle **majeure.mineure.correctif** : une nouvelle migration de base demande au moins une version **mineure**.
2. Lancez :

    ```bash
    pnpm release
    ```

Le script fait tout, dans cet ordre :
- il installe les dépendances (`--frozen-lockfile`) ;
- il passe les tests unitaires de l'API et du connecteur ;
- il compile ;
- il isole l'API avec ses seules dépendances de production ;
- il vérifie que l'API se charge ;
- il produit trois fichiers dans `dist-release/` : l'archive, son empreinte `.sha256` et `latest.json`.

`bash scripts/make-release.sh --skip-tests` saute les tests (dépannage uniquement).

## Diffuser

- **Clé USB ou partage** : copiez l'archive **et** son `.sha256`. `setup.sh` et `lims update` vérifient l'empreinte quand le fichier est à côté.
- **Dossier web** (intranet du programme, serveur de dépôt) : déposez les trois fichiers dans un même dossier, par exemple `https://depot.pnls.cd/lims/`. Sur chaque serveur, une fois : `sudo lims update-source https://depot.pnls.cd/lims`. Ensuite, `sudo lims update` installe la version désignée par `latest.json`, après contrôle de l'empreinte.

## Avant de diffuser

1. Installez la nouvelle version sur une machine de test qui a une **copie récente de la base d'un laboratoire** : `sudo lims restore --from-destination`, puis `sudo lims update --source …`.
2. Testez le retour arrière : `sudo lims rollback`, puis remettez la nouvelle version.
3. Passez les tests de fumée de bout en bout, sur une base de test (voir le README, section Démarrage rapide).
4. Rédigez les notes de version pour les laboratoires : nouveautés, migrations, actions à faire après la mise à jour.
