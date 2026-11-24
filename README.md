# SIL — Système d'information de laboratoire (ISO 15189)

Monorepo du logiciel de gestion de laboratoire médical.
| Étape | Contenu | État |
|---|---|---|
| 1 — Socle | Authentification, rôles, piste d'audit, utilisateurs, paramètres | ✔ livrée |
| 2 — Référentiels | Patients (détection des doublons), prescripteurs, catalogue | ✔ livrée |
| 3 — Demandes, échantillons, caisse | Demandes, prélèvement, étiquettes, réception, facturation, caisse CDF/USD | ✔ livrée |
| 4 — Résultats et validation | Paillasses, saisie, validations, valeurs critiques, comptes rendus PDF | ✔ livrée |
| 5 — Qualité | CIQ et Westgard, non-conformités, indicateurs de délais | ✔ livrée |
| 6 — Automates | ASTM, HL7, CSV, connecteur de poste, appariement, CIQ automatiques | ✔ livrée |
| 7 — Interopérabilité | DHIS2, VLSM / InteLIS, OpenHIM | ✔ livrée |
| Déploiement | Installateur Ubuntu, commande `lims`, assistant du navigateur, sauvegardes chiffrées hors machine, mises à jour avec retour arrière, Docker, installateurs du connecteur | ✔ livré |

> **Installer un laboratoire** (Ubuntu 24.04 LTS), comme InteLIS :
>
> ```bash
> cd ~ && wget -O install.sh "https://raw.githubusercontent.com/ernesteyeme/SIL-Laboratoire/main/scripts/install.sh?v=$(date +%s)" && sudo bash install.sh
> ```
>
> Le guide pas à pas est dans [docs/guides/installer-sur-ubuntu.md](docs/guides/installer-sur-ubuntu.md). Le sommaire de l'exploitation est dans [docs/index.md](docs/index.md) et la section 15 en résume le fonctionnement. Le démarrage rapide ci-dessous concerne le **développement**.

| Couche | Technologies |
|---|---|
| API | NestJS 11 · TypeScript · Prisma 7 (adaptateur `pg`) · PostgreSQL 16+ |
| Web | React 19 · Vite 7 · TypeScript · TailwindCSS 4 · Lucide · TanStack Query · React Hook Form |
| Partagé | Schémas Zod et énumérations (`packages/shared`), utilisés par l'API **et** le frontend |

---

## 1. Démarrage rapide (développement)

Prérequis : Node.js ≥ 20.19, pnpm 10 (`corepack enable`), Docker (ou un PostgreSQL existant).

```bash
# 1. Base de données
docker compose up -d

# 2. Configuration de l'API
cp apps/api/.env.example apps/api/.env
#    → remplacer JWT_ACCESS_SECRET (openssl rand -base64 48)
#    → choisir SEED_ADMIN_PASSWORD

# 3. Dépendances (génère aussi le client Prisma)
pnpm install

# 4. Schéma + données initiales
pnpm db:migrate
pnpm db:seed
pnpm db:seed:catalog   # facultatif : catalogue de démarrage (valeurs INDICATIVES à valider)

# 5. Lancement (deux terminaux)
pnpm dev:api     # http://localhost:3000/api
pnpm dev:web     # http://localhost:5173
```

Connectez-vous avec `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` : le changement de mot de passe est exigé à la première connexion.

Autres commandes :

```bash
pnpm test          # tests unitaires des services (Jest)
pnpm typecheck     # vérification TypeScript API + web
pnpm build         # build de production (apps/api/dist, apps/web/dist)

# Tests de fumée de bout en bout — base de TEST uniquement, jamais en production
cd apps/api
node --env-file=.env scripts/smoke-test.mjs         # étape 1 (46 contrôles) : base vierge
node --env-file=.env scripts/smoke-test-step2.mjs   # étape 2 (51 contrôles) : après l'étape 1 + db:seed:catalog
node --env-file=.env scripts/smoke-test-step3.mjs   # étape 3 (61 contrôles) : après l'étape 1 + db:seed:catalog
#   (attendre 1 minute entre deux scripts : limite de 10 connexions/minute)
```

---

## 2. Architecture

```
lims/
├── apps/api/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/            # SQL versionné (+ triggers d'audit)
│   │   └── seed.ts
│   └── src/
│       ├── core/                  # transversal, réutilisé par tous les modules
│       │   ├── audit/             # AuditService, chaîne de hash, endpoints /audit
│       │   ├── config/            # variables d'environnement validées par Zod
│       │   ├── context/           # contexte de requête (utilisateur, IP, requestId)
│       │   ├── errors/            # DomainException, filtre global d'erreurs
│       │   ├── prisma/            # PrismaService, type Db (client ou transaction)
│       │   ├── security/          # guards JWT + rôles, décorateurs, Argon2
│       │   └── validation/        # ZodValidationPipe
│       └── modules/
│           ├── auth/              # login, refresh, logout, me, change-password
│           ├── users/             # gestion des comptes (ADMIN)
│           ├── settings/          # paramètres du laboratoire
│           ├── patients/          # dossiers patients, détection des doublons
│           ├── prescribers/       # prescripteurs
│           ├── catalog/           # sections, échantillons, examens, paramètres, valeurs de référence
│           ├── orders/            # demandes, échantillons, non-conformités
│           ├── billing/           # factures, paiements, sessions de caisse, taux de change
│           ├── results/           # saisie, validations, alertes critiques, comptes rendus PDF
│           ├── quality/           # CIQ (Westgard), non-conformités, indicateurs
│           ├── instruments/       # automates, analyseurs ASTM/HL7/CSV, appariement, passerelle
│           ├── interop/           # DHIS2 (agrégats), VLSM/InteLIS (CV, EID), OpenHIM, journal des échanges
│           └── health/
├── apps/web/src/
│   ├── auth/                      # AuthProvider, RequireAuth, navigation par rôle
│   ├── components/                # ui/ (Button, Field, Modal…) + layout/
│   ├── features/                  # hooks d'accès API (TanStack Query) par domaine
│   ├── lib/                       # client API (refresh auto), utilitaires
│   └── pages/
├── apps/connector/                # connecteur de poste (Node sans dépendance) : ASTM E1381, HL7 MLLP,
│                                  # dossier d'export, file d'attente hors ligne, simulateur d'automate,
│                                  # install/ : service Windows (tâche planifiée) et Linux (systemd)
├── packages/shared/src/           # schémas Zod, types DTO, rôles, codes d'erreur,
│                                  # fonctions métier pures (âge, normalisation, valeurs de référence)
├── scripts/                       # setup.sh (installateur Ubuntu), lims (commande d'exploitation),
│   └── lib/                       # make-release.sh ; bibliothèques : sauvegarde, migrations, HTTPS, systemd…
├── docker/                        # images API et web, docker-compose de production, lims-docker.sh
└── docs/                          # guides d'installation et d'exploitation (index.md)
```

### Séparation des responsabilités (obligatoire pour chaque module)

| Fichier | Rôle | Interdit |
|---|---|---|
| `*.controller.ts` | HTTP : routes, rôles, validation (`ZodValidationPipe`), statut HTTP | logique métier, accès Prisma |
| `*.service.ts` | règles métier, transactions, audit | objets `Request`/`Response` |
| `*.repository.ts` | requêtes Prisma, accepte un `db: Db` pour participer à une transaction | règles métier |
| `*.mapper.ts` | entité → DTO (jamais de secret exposé) | — |

---

## 3. Sécurité

### Authentification
- **Jeton d'accès** JWT HS256, 15 min, en mémoire côté navigateur (jamais dans `localStorage`).
- **Jeton de rafraîchissement** opaque, 7 jours, dans un cookie `httpOnly`, `SameSite=Strict`, limité à `/api/auth`. Seul son SHA-256 est stocké.
- **Rotation à chaque usage** avec détection de réutilisation : un jeton déjà utilisé, s'il est rejoué après 15 s, révoque toute la session (indice de vol).
- **`tokenVersion`** : un changement ou une réinitialisation de mot de passe, ou une désactivation, invalide **immédiatement** tous les jetons d'accès émis.
- Mots de passe **Argon2id** (paramètres OWASP). Politique : 10 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial.
- **Verrouillage** après `LOGIN_MAX_ATTEMPTS` échecs pendant `LOGIN_LOCK_MINUTES`. Message générique sur identifiant inconnu, avec temps de réponse égalisé contre l'énumération des comptes.
- Limitation de débit : 10 tentatives de connexion par minute et par IP, 300 requêtes par minute au global.

### Contrôle d'accès (RBAC) — refus par défaut
Trois guards globaux s'exécutent dans cet ordre : `ThrottlerGuard`, `JwtAuthGuard`, `RolesGuard`.

```ts
@Public()                       // sans authentification
@AnyRole()                      // tout utilisateur connecté
@Roles('BIOLOGISTE', 'ADMIN')   // au moins un de ces rôles
```

**Une route sans aucun de ces décorateurs est refusée**, et le refus est journalisé. Les rôles sont relus en base à chaque requête : un retrait de rôle prend effet immédiatement. Le frontend masque les écrans non autorisés, mais c'est l'API qui fait foi.

Groupes de rôles : `apps/api/src/core/security/role-groups.ts`, repris dans `apps/web/src/auth/navigation.ts`.

| Écran / API | ADMIN | RECEPTION | CAISSE | TECHNICIEN | BIOLOGISTE | QUALITE | COMPTABLE |
|---|---|---|---|---|---|---|---|
| Utilisateurs | ✔ | — | — | — | — | — | — |
| Piste d'audit | ✔ | — | — | — | — | ✔ | — |
| Paramètres : lecture / modification | ✔ / ✔ | ✔ / — | ✔ / — | ✔ / — | ✔ / — | ✔ / — | ✔ / — |
| Patients, prescripteurs : lecture | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Patients, prescripteurs : création / modification | ✔ | ✔ | — | — | — | — | — |
| Patients : désactivation / réactivation | ✔ | — | — | — | — | — | — |
| Catalogue : lecture | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Sections, types d'échantillon : écriture | ✔ | — | — | — | — | — | — |
| Examens, paramètres, valeurs de référence : écriture | ✔ | — | — | — | ✔ | — | — |
| Tarif d'un examen : modification | ✔ | — | — | — | — | — | — |
| Demandes : lecture | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Demandes : création / annulation | ✔ | ✔ | — | — | — | — | — |
| Prélèvement | ✔ | ✔ | — | ✔ | ✔ | — | — |
| Réception au labo, non-conformité (refus) | ✔ | — | — | ✔ | ✔ | — | — |
| Dérogation (acceptation sous réserve) | ✔ | — | — | — | ✔ | — | — |
| Nouveau prélèvement après refus | ✔ | ✔ | — | ✔ | ✔ | — | — |
| Factures, reçus, rapports de caisse : lecture | ✔ | — | ✔ | — | — | — | ✔ |
| Encaissement, remise ≤ 20 %, session de caisse | ✔ | — | ✔ | — | — | — | — |
| Remise > 20 %, annulation d'un paiement | ✔ | — | — | — | — | — | — |
| Taux de change du jour : saisie | ✔ | — | — | — | — | — | ✔ |
| Paillasses, saisie des résultats, validation technique | — | — | — | ✔ | ✔ | — | — |
| Communication d'une valeur critique | — | — | — | ✔ | ✔ | — | — |
| Validation biologique, renvoi en saisie, correction, CR partiel | — | — | — | — | ✔ | — | — |
| Résultats et comptes rendus PDF : lecture | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| CIQ : consultation, Levey-Jennings | ✔ | — | — | ✔ | ✔ | ✔ | — |
| CIQ : lots et cibles | ✔ | — | — | — | ✔ | ✔ | — |
| CIQ : saisie d'une série | — | — | — | ✔ | ✔ | — | — |
| CIQ : action corrective / exclusion d'une série | — / — | — | — | ✔ / — | ✔ / ✔ | ✔ / ✔ | — |
| Non-conformités : déclaration | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Non-conformités : voir toutes les fiches (sinon les siennes) | ✔ | — | — | ✔ | ✔ | ✔ | — |
| Non-conformités : analyse et plan d'action | ✔ | — | — | — | ✔ | ✔ | — |
| Non-conformités : clôture, annulation | — | — | — | — | — | ✔ | — |
| Indicateurs qualité | ✔ | — | — | — | ✔ | ✔ | — |
| Automates : consultation, messages, file à traiter | ✔ | — | — | ✔ | ✔ | ✔ | — |
| Automates : déclaration, correspondances, contrôles | ✔ | — | — | — | ✔ | — | — |
| Automates : clé du connecteur | ✔ | — | — | — | — | — | — |
| Automates : import de fichier, retenir / relancer / écarter | — | — | — | ✔ | ✔ | — | — |
| Interopérabilité : connexions, aperçus, journal (lecture) | ✔ | — | — | — | ✔ | ✔ | — |
| Interopérabilité : déclarer / tester une connexion, secrets | ✔ | — | — | — | — | — | — |
| Interopérabilité : correspondances DHIS2 et VLSM | ✔ | — | — | — | ✔ | ✔ | — |
| Interopérabilité : simuler / envoyer à DHIS2, envoyer à VLSM | — | — | — | — | ✔ | ✔ | — |

Règles métier protégées : impossible de se désactiver soi-même, de retirer son propre rôle ADMIN, ou de supprimer le dernier administrateur actif. Toute désactivation, réactivation, réinitialisation ou tout déverrouillage exige un **motif**.

---

## 4. Piste d'audit (ISO 15189 §7.11, §8.4)

- Table `audit_log` en **ajout seul** : des triggers PostgreSQL bloquent `UPDATE`, `DELETE` et `TRUNCATE`, même pour l'application.
- **Chaînage SHA-256** : chaque entrée contient le hash de la précédente. `seq`, l'horodatage et le hash sont calculés **par la base** sous verrou, donc la chaîne reste linéaire même sous forte concurrence.
- Chaque entrée enregistre : acteur et rôles, action, entité, état **avant** et **après** (sans secrets), motif, IP, navigateur et identifiant de requête (également renvoyé dans l'en-tête `X-Request-Id`).
- `GET /api/audit/verify` recalcule toute la chaîne et signale `HASH_MISMATCH` (contenu modifié), `CHAIN_BROKEN` ou `SEQUENCE_GAP` (entrée supprimée).
- **Ancrage** : consignez périodiquement la dernière empreinte affichée (bouton « Vérifier l'intégrité ») dans votre registre qualité. Cela détecte même une falsification par un administrateur de la base qui recalculerait toute la chaîne.

### Règle pour tous les futurs modules
Toute écriture de donnée médicale ou financière passe par une transaction qui inclut sa trace :

```ts
return this.prisma.$transaction(async (tx) => {
  const before = await this.repo.findById(id, tx);
  const after = await this.repo.update(id, data, tx);
  await this.audit.record(tx, { action: 'UPDATE', entity: 'Result', entityId: id, before, after, reason });
  return after;
});
```

Si l'écriture de l'audit échoue, la modification est annulée. Les secrets (`passwordHash`, `tokenHash`…) sont retirés automatiquement par `toAuditJson`. Ajoutez chaque nouvelle entité à `AUDIT_ENTITIES` dans `packages/shared`.

---

## 5. Étape 2 — Référentiels

### Patients
- **Code patient unique** attribué par la base (`PAT-000001`, séquence PostgreSQL).
- Identité au format congolais : **Nom, Postnom, Prénom**, affichée « NOM POSTNOM Prénom ».
- **Âge seulement connu** : saisie de l'âge en années, la date de naissance est estimée et marquée comme telle.
- **Détection des doublons**, en direct pendant la saisie puis revérifiée par le serveur à l'enregistrement :
  - nom comparé par trigrammes (`pg_trgm`, index GIN), indépendamment de l'ordre des noms, des accents et de la casse ;
  - la date de naissance confirme ou infirme la ressemblance, et un sexe différent l'écarte ;
  - téléphone comparé sur ses 9 derniers chiffres (`+243 81…`, `0081…`, `081…` sont équivalents) ;
  - identifiant externe (n° de dossier, code TARV) identique : signal fort.

  Un téléphone partagé avec un nom sans rapport n'est **pas** signalé, car les téléphones familiaux sont courants. Au-delà d'un score de 50 %, la création est bloquée (409 `DUPLICATE_SUSPECTED`) jusqu'à confirmation explicite par l'opérateur. Cette confirmation est consignée dans l'audit avec les dossiers écartés.
- Recherche par nom (ordre libre, sans accents), code, téléphone dans n'importe quel format, ou identifiant externe.
- Un dossier n'est jamais supprimé. La désactivation est réservée à l'ADMIN, avec motif, par exemple pour un doublon fusionné.

### Catalogue
- **Section** (discipline) → **Examen** (commandable, tarifé) → **Paramètres** (résultats) → **Valeurs de référence**.
- Un examen créé est **inactif**. Il ne devient commandable qu'après ajout d'au moins un paramètre actif et activation explicite avec motif : c'est la revue du paramétrage.
- Types de résultat : numérique (unité, décimales), texte libre, liste de choix.
- **Valeurs de référence** par sexe (Tous / Hommes / Femmes) et tranche d'âge `[min, max[`, saisie en jours, mois ou ans et stockée en jours ; bornes normales et seuils critiques.
  - Choix de la plage applicable (`resolveReferenceRange`) : plage propre au sexe d'abord, puis tranche la plus étroite. Si le sexe est inconnu, seules les plages « Tous » s'appliquent.
  - Deux plages du même sexe ne peuvent pas avoir des tranches d'âge qui se chevauchent.
  - Toute modification ou suppression exige un motif ; l'état antérieur est conservé dans l'audit.
- Règles protégées : pas de désactivation d'une section ou d'un type d'échantillon utilisé par des examens actifs ; pas de désactivation du dernier paramètre actif d'un examen actif ; pas de changement de type de résultat tant que des valeurs de référence existent ; la valeur normale d'une liste de choix doit faire partie des choix.
- **Tarifs** : `DECIMAL(12,2)`, transmis en chaîne (`"8000.00"`). Seul l'ADMIN modifie un tarif, et le changement est audité avant/après. Changer la devise du laboratoire ne convertit pas les tarifs.
- `pnpm db:seed:catalog` charge 6 sections, 6 types d'échantillon et 7 examens courants (NFS, glycémie, créatinine, CD4, charge virale VIH, TDR VIH, goutte épaisse). **Les tarifs et valeurs de référence sont indicatifs : le biologiste responsable doit les valider avant usage.**

### API de l'étape 2

| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/patients?q&sex&status&page&pageSize` · `/api/patients/:id` | lecture patients |
| POST | `/api/patients/duplicates` | RECEPTION, ADMIN |
| POST · PATCH | `/api/patients` · `/api/patients/:id` | RECEPTION, ADMIN |
| POST | `/api/patients/:id/deactivate` · `reactivate` | ADMIN |
| GET · POST · PATCH | `/api/prescribers` · `/api/prescribers/:id` | lecture / RECEPTION, ADMIN |
| GET · POST · PATCH | `/api/catalog/sections` · `/api/catalog/sample-types` | lecture : tous / écriture : ADMIN |
| GET · POST · PATCH | `/api/catalog/exams` · `/api/catalog/exams/:id` | lecture : tous / écriture : ADMIN, BIOLOGISTE |
| POST | `/api/catalog/exams/:id/parameters` | ADMIN, BIOLOGISTE |
| PATCH | `/api/catalog/parameters/:id` | ADMIN, BIOLOGISTE |
| POST | `/api/catalog/parameters/:id/reference-ranges` | ADMIN, BIOLOGISTE |
| PUT · DELETE | `/api/catalog/reference-ranges/:id` (motif obligatoire) | ADMIN, BIOLOGISTE |

Activation et désactivation passent par `PATCH { isActive, reason }`, avec motif obligatoire.

---

## 6. Étape 3 — Demandes, échantillons, facturation, caisse

### Numérotation sans trou
Table `counters`, incrémentée par `INSERT … ON CONFLICT` **dans la transaction métier**. Une transaction annulée ne consomme aucun numéro, ce qui est exigé pour les factures et reçus. Les périodes suivent le **fuseau horaire du laboratoire** (paramètre), pas UTC.

| Document | Format | Remise à zéro |
|---|---|---|
| Demande | `DEM-2026-000001` | annuelle |
| Échantillon (code-barres) | `2611220001` (AAMMJJ + rang) | quotidienne |
| Facture | `FAC-2026-000001` | annuelle |
| Reçu | `REC-2026-000001` | annuelle |
| Session de caisse | `CS-2026-0001` | annuelle |

### Demande
- Une transaction unique crée : la demande, **un échantillon par type d'échantillon** (NFS et CD4 partagent le tube EDTA), les examens avec leur **tarif figé**, la facture et ses lignes, et la trace d'audit.
- Seuls des examens actifs peuvent être demandés, pour un patient et un prescripteur actifs.
- **Prise en charge** par un organisme (assurance, employeur, programme) en % : la facture distingue part tiers et part patient.
- Annulation avec motif, possible seulement si aucun échantillon n'est reçu et si aucun paiement n'est actif. La facture est annulée en même temps.
- Statut de la demande calculé à partir de ses échantillons : Enregistrée → Prélèvement partiel → Prélevée → Reçue au laboratoire. Un échantillon refusé non remplacé empêche la demande d'être complète.

### Échantillons (ISO 15189 §7.2)
- **Étiquettes** Code 128 pour imprimante thermique en rouleau 50 × 30 mm : patient (nom, code, sexe, âge), n° d'échantillon, nature, examens, date ou mention URGENT. Barres de 0,375 mm, soit 3 points à 203 dpi. **Lisibilité vérifiée par décodage automatique** des étiquettes générées.
- **Prélèvement** : heure réelle saisie (ni future, ni de plus de 7 jours), préleveur tracé. Paramètre facultatif « paiement avant prélèvement », dont les urgences sont dispensées.
- **Réception au laboratoire** par lecture du code-barres : réception conforme, ou **non-conformité** typée (hémolyse, coagulation, volume insuffisant, contenant inadapté, identification, délai, température, fuite, contamination, autre) avec deux décisions :
  - **refus** : un nouveau prélèvement crée un nouvel échantillon (nouveau code-barres) et y transfère les examens. L'échantillon refusé reste archivé et lié à son remplaçant ;
  - **dérogation** (biologiste uniquement, justification obligatoire) : accepté sous réserve. La réserve sera reportée sur le compte rendu à l'étape 4.

### Caisse
- **Session de caisse** obligatoire pour encaisser : ouverture avec fond de caisse, une seule session ouverte par caissier (index unique partiel en base).
- **Paiement** : espèces, mobile money, carte, virement, autre. Une référence de transaction est obligatoire pour le mobile money, la carte et le virement. En espèces, la somme remise peut dépasser le reste dû : la **monnaie à rendre** est calculée et enregistrée. Hors espèces, le trop-perçu est interdit. Un reçu ticket 80 mm s'imprime automatiquement.
- **Remise** avec motif : jusqu'à 20 % par le caissier, au-delà par l'administrateur. Elle ne peut pas rendre la part patient inférieure à ce qui est déjà encaissé.
- **Annulation d'un paiement** : administrateur uniquement, avec motif, et seulement tant que la session est ouverte. Le reçu est conservé et marqué annulé.
- **Clôture** : espèces attendues = fond de caisse + encaissements en espèces non annulés. Tout écart avec le comptage doit être justifié. Le récapitulatif est figé en base et un rapport A4 est imprimé avec les signatures.
- Montants calculés **en centimes entiers** (`toCents` / `fromCents`), jamais en virgule flottante. Contrainte en base : part tiers + part patient = total − remise ; encaissé ≤ part patient.
- Un caissier ne voit que ses propres sessions ; l'administrateur et le comptable voient toutes les sessions.

### API de l'étape 3

| Méthode | Route | Accès |
|---|---|---|
| GET · POST | `/api/orders` · `/api/orders/:id` | lecture / RECEPTION, ADMIN |
| POST | `/api/orders/:id/cancel` | RECEPTION, ADMIN |
| GET | `/api/samples?status&q` · `/api/samples/by-number/:number` | lecture |
| POST | `/api/samples/:id/collect` | préleveurs |
| POST | `/api/samples/:id/receive` · `/api/samples/:id/non-conformities` | TECHNICIEN, BIOLOGISTE, ADMIN |
| POST | `/api/samples/:id/recollect` | RECEPTION, TECHNICIEN, BIOLOGISTE, ADMIN |
| GET | `/api/invoices?q&status&outstanding` · `/api/invoices/:id` | CAISSE, COMPTABLE, ADMIN |
| POST | `/api/invoices/:id/discount` · `/api/invoices/:id/payments` | CAISSE, ADMIN |
| GET · POST | `/api/payments/:id/receipt` · `/api/payments/:id/cancel` | lecture / ADMIN |
| GET | `/api/cash-sessions` · `/api/cash-sessions/current` · `/api/cash-sessions/:id` | lecture / caissier |
| POST | `/api/cash-sessions/open` · `/api/cash-sessions/current/close` | CAISSE, ADMIN |

La caisse peut fonctionner en **CDF et USD** : voir la section 7.

---

## 7. Caisse bi-devise CDF / USD

Activation : **Paramètres → Accueil et caisse → Caisse bi-devise** (possible seulement si la devise de base est CDF ou USD). Les tarifs du catalogue restent dans la devise de base ; l’autre devise est acceptée en caisse.

- **Taux du jour** « X CDF pour 1 USD » (4 décimales), un par date locale du laboratoire. Saisi ou corrigé par l’**administrateur** ou le **comptable** (avec note, tracé dans l’audit) ; tout le monde le voit. Sans taux du jour, un paiement en devise secondaire est refusé (`RATE_NOT_SET`).
- **Paiement** : on saisit la somme **remise** dans la devise choisie. Le serveur convertit en devise de base (centimes entiers, arrondi au plus proche, `convertCents`), impute au plus le reste dû et calcule la **monnaie rendue en devise de base**, uniquement pour les espèces. Hors espèces, le trop-perçu reste interdit. Chaque paiement fige : devise, montant remis, taux, montant imputé, monnaie rendue.
- **Session** : fond de caisse déclaré dans chaque devise ; clôture avec un **comptage par devise**. Espèces attendues en devise de base = fond + espèces reçues en devise de base − monnaie rendue ; en devise secondaire = fond + espèces reçues dans cette devise. Tout écart, dans l’une ou l’autre devise, doit être justifié.
- Reçu et rapport de session indiquent le montant remis, le taux appliqué, le montant imputé et la monnaie rendue ; les totaux sont ventilés par moyen **et** par devise.

| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/exchange-rates/today` · `/api/exchange-rates` (60 derniers jours) | CAISSE, COMPTABLE, ADMIN |
| PUT | `/api/exchange-rates/today` | ADMIN, COMPTABLE |

---

## 8. Étape 4 — Cœur analytique

### Cycle d’un examen
`En attente d’échantillon` → (réception) `À saisir` → (tous paramètres renseignés) `Saisi` → `Validé techniquement` → `Validé biologiquement`.

- **À la réception** de l’échantillon (ou à son acceptation sous réserve), une ligne de résultat est créée par paramètre de l’examen avec un **instantané** du paramètre (unité, type, décimales, choix) et de la **valeur de référence applicable** au sexe du patient et à son âge à la date du prélèvement. Si la date de naissance est inconnue, seules les plages valables à tout âge sont utilisées. Modifier ensuite le catalogue ne change pas les résultats en cours.
- Un échantillon ne peut plus être refusé dès qu’un résultat a été saisi (`SAMPLE_HAS_RESULTS`).

### Saisie et interprétation automatique
- Saisie au format français (`12,5`, `1 250 000`) et limites de mesure (`<40`, `>1000`). Les qualitatifs sont choisis dans la liste du paramètre (insensible à la casse).
- Interprétation calculée à l’écran pendant la saisie **et** recalculée par le serveur : `↓↓` critique bas, `↓` bas, normal, `↑` élevé, `↑↑` critique haut, `*` qualitatif différent de la valeur attendue. `<x` n’est comparé qu’aux seuils bas, `>x` qu’aux seuils hauts.
- **Antériorité** : dernier résultat validé du patient pour le même paramètre, affiché à la saisie et imprimé.
- Une valeur rejetée renvoie une erreur ciblée sur le paramètre concerné ; rien n’est enregistré tant qu’une valeur est invalide. Chaque modification de valeur est tracée (avant/après) dans l’audit.

### Valeurs critiques (ISO 15189 §7.4.1.3)
- Une valeur critique **ouvre automatiquement une alerte**. Corrigée avant communication, l’alerte devenue sans objet est retirée.
- La **communication doit être tracée** (personne prévenue et moyen, note ; l’heure et l’auteur sont enregistrés) par le technicien ou le biologiste. **La validation biologique est bloquée** tant qu’une alerte de l’examen n’est pas communiquée (`CRITICAL_NOT_COMMUNICATED`).

### Validations
- **Technique** (technicien ou biologiste) : exige tous les paramètres renseignés ; les résultats sont ensuite verrouillés.
- **Biologique** (biologiste uniquement) : exige la validation technique, avec un commentaire d’interprétation facultatif imprimé sur le compte rendu. Le biologiste peut **renvoyer en saisie** (avec motif) un examen validé techniquement.
- La demande passe à `Partiellement validée` puis à `Validée`.
- L’administrateur ne saisit ni ne valide de résultats : séparation des fonctions.

### Comptes rendus
- **Émission automatique** du compte rendu définitif quand le dernier examen de la demande est validé biologiquement (dans la même transaction). Le biologiste peut émettre un **compte rendu partiel** quand une partie seulement des examens est validée.
- PDF A4 généré côté serveur (pdfkit, police DejaVu embarquée pour µ ≤ ≥ ↑ ↓) : identité du laboratoire et accréditation, patient (âge au prélèvement), demande, résultats par section avec interprétation, unité, valeurs de référence et antériorité, **réserves de dérogation**, commentaires, valideurs technique et biologique horodatés, légende, bandeaux « partiel » ou « annule et remplace », pagination et pied de page.
- Numérotation sans trou `CR-AAAA-NNNNNN`, version par demande. Le PDF est **archivé à l’identique** avec son empreinte **SHA-256** (renvoyée dans l’en-tête `X-Content-SHA256`). La table est **immuable** : un trigger PostgreSQL interdit toute modification ou suppression.

### Corrections après validation
Le biologiste ouvre une **correction** avec motif : les valeurs validées et leurs valideurs sont archivés (`result_amendments`), la version de l’examen est incrémentée et l’examen repasse en saisie. À la nouvelle validation, un **compte rendu rectificatif** est émis. Il annule et remplace le précédent, dont le PDF reste consultable, et mentionne le motif.

### Écrans
- **Paillasses** (`/paillasses`) : liste de travail par section et par étape (à saisir, validation technique, validation biologique, validés 72 h), triée urgences d’abord puis par ancienneté de réception, avec échéance de rendu (retards en rouge), critiques à communiquer et réserves. Recherche par n° d’échantillon (douchette).
- **Résultats d’une demande** (`/resultats/:id`, aussi accessible depuis la fiche demande) : saisie au clavier (Entrée passe au champ suivant), interprétation en direct, alertes, validations, corrections, liste des comptes rendus et ouverture des PDF.

### API de l’étape 4

| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/results/worklist?status&sectionId&q` | TECHNICIEN, BIOLOGISTE |
| GET | `/api/results/orders/:orderId` | lecture dossier patient |
| PUT | `/api/results/items/:id` | TECHNICIEN, BIOLOGISTE |
| POST | `/api/results/items/:id/technical-validation` | TECHNICIEN, BIOLOGISTE |
| POST | `/api/results/items/:id/biological-validation` · `/return` · `/amend` | BIOLOGISTE |
| POST | `/api/results/alerts/:id/acknowledge` | TECHNICIEN, BIOLOGISTE |
| GET | `/api/reports/orders/:orderId` · `/api/reports/:id/pdf` | lecture dossier patient |
| POST | `/api/reports/orders/:orderId/partial` | BIOLOGISTE |

### Tests
- Unitaires : `pnpm --filter api test` (102 tests, dont interprétation, alertes, enchaînement des validations, émission des comptes rendus, corrections, figeage des valeurs de référence, conversion de devises et rendu de monnaie).
- Fumée : `node --env-file=.env scripts/smoke-test-step4.mjs` (67 contrôles bout en bout : bi-devise, saisie, critiques, validations, PDF et empreinte, rectificatif, antériorité, audit). À lancer sur une base de test avec le catalogue de démarrage.

---

## 9. Étape 5 — Qualité : CIQ, non-conformités, indicateurs

### Contrôle qualité interne (ISO 15189 §7.3.7.2)
- **Lots de contrôle** : un lot par niveau (nom, fabricant, n° de lot, niveau, péremption, section). **Cibles** par paramètre numérique : moyenne, écart-type (> 0), origine (notice du fabricant ou période probatoire du laboratoire). Toute modification d’une cible exige un **motif** tracé.
- **Série** : un résultat par niveau, heure de passage (jamais future, jamais antérieure à la dernière série du paramètre). Les lots périmés sont refusés. Le score z et la cible sont **figés** sur chaque résultat. Les valeurs de CIQ sont **immuables** en base (trigger).
- **Règles de Westgard** (fonction pure partagée `evaluateWestgard`, aussi utilisée pour l’aperçu pendant la saisie) :

| Règle | Condition | Effet |
|---|---|---|
| 1-2s | un contrôle au-delà de ±2 ET | avertissement (série utilisable) |
| 1-3s | un contrôle au-delà de ±3 ET | rejet (erreur aléatoire) |
| 2-2s | deux séries consécutives du même niveau, ou deux niveaux de la série, au-delà de 2 ET du même côté | rejet (erreur systématique) |
| R-4s | dans la série, un niveau > +2 ET et un autre < −2 ET | rejet (erreur aléatoire) |
| 4-1s | quatre contrôles consécutifs du même niveau au-delà de 1 ET du même côté | rejet (erreur systématique) |
| 10x | dix contrôles consécutifs du même niveau du même côté de la moyenne | rejet (erreur systématique) |

  L’historique évalué exclut les séries rejetées et les séries exclues. Deux séries simultanées d’un même paramètre sont sérialisées (verrou consultatif PostgreSQL).
- **Série rejetée** :
  1. une **fiche de non-conformité** est ouverte automatiquement (catégorie analytique, gravité majeure), dans la même transaction ;
  2. la **validation technique et biologique** des résultats patients du paramètre est **bloquée** (`QC_REJECTED`) tant que la dernière série n’est pas acceptée ;
  3. aucune nouvelle série n’est possible avant que l’**action corrective** soit documentée (`QC_ACTION_REQUIRED`) ;
  4. le détail de la série liste les **résultats patients à réévaluer**, saisis depuis le dernier CIQ acceptable.
- **Exclusion** d’une série invalide (erreur de saisie, mauvais flacon) par le biologiste ou le responsable qualité, avec motif : la série reste visible, marquée exclue, et sort des statistiques.
- **Graphique de Levey-Jennings** par niveau : moyenne cible et ±1/2/3 ET, forme du point selon le statut (cercle, triangle, losange, cercle creux), détail au survol, vue tableau. Statistiques observées (n, moyenne, ET, CV, biais par rapport à la cible).

### Fiches de non-conformité (ISO 15189 §7.5, §8.7)
Numérotation `NC-AAAA-NNNN`. Cycle de vie contrôlé par l’API **et** par une contrainte en base :

`Déclarée` → (analyse des causes + action corrective + responsable + échéance) `Action en cours` → (vérification d’efficacité) `Clôturée`, ou `Annulée (non fondée)` avec motif.

- **Déclaration par tout le personnel**, rattachable à une demande ou à un échantillon par son numéro. Les rôles sans accès global ne voient que leurs propres déclarations ; une fiche d’un autre déclarant est « introuvable » pour eux.
- **Analyse et plan d’action** : biologiste, responsable qualité ou administrateur. L’échéance ne peut pas être passée ; les actions en retard sont signalées.
- **Clôture et annulation** : responsable qualité uniquement. Une fiche issue d’un CIQ ne peut être ni annulée, ni clôturée tant que l’action corrective du CIQ manque.

### Indicateurs (ISO 15189 §8.8)
Période de 1 à 366 jours locaux, filtre par section :
- **Délais de rendu** réception → validation biologique par examen : médiane, 90e centile, % dans le délai cible du catalogue, examens en retard à l’instant présent, délai prélèvement → réception.
- **Échantillons** : taux de refus, dérogations, motifs.
- **Valeurs critiques** : nombre, % communiquées en 30 min, délai médian.
- **Comptes rendus rectificatifs**, **CIQ** (séries, avertissements, taux de rejet par paramètre), **non-conformités** (par catégorie et gravité, ouvertes, actions en retard, délai médian de clôture).
- Export CSV des délais de rendu (séparateur « ; », décimales à la virgule, pour Excel en français).

### API de l’étape 5

| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/qc/materials` · `/api/qc/status` · `/api/qc/runs` · `/api/qc/runs/:id` · `/api/qc/targets/:id/levey-jennings` | ADMIN, TECHNICIEN, BIOLOGISTE, QUALITE |
| POST · PUT | `/api/qc/materials` · `/api/qc/materials/:id` · `/api/qc/materials/:id/targets` | ADMIN, BIOLOGISTE, QUALITE |
| POST | `/api/qc/runs` | TECHNICIEN, BIOLOGISTE |
| POST | `/api/qc/runs/:id/corrective-action` | TECHNICIEN, BIOLOGISTE, QUALITE |
| POST | `/api/qc/runs/:id/exclude` | BIOLOGISTE, QUALITE |
| GET · POST | `/api/quality-issues` · `/api/quality-issues/:id` | tout utilisateur connecté (visibilité restreinte, voir plus haut) |
| POST | `/api/quality-issues/:id/plan` | ADMIN, BIOLOGISTE, QUALITE |
| POST | `/api/quality-issues/:id/close` · `/cancel` | QUALITE |
| GET | `/api/quality/indicators?from&to&sectionId` | ADMIN, BIOLOGISTE, QUALITE |

### Tests
- Unitaires : 127 tests, dont chaque règle de Westgard et ses cas limites, la garde de validation, le cycle des non-conformités et les bornes de période en heure de Kinshasa et de Lubumbashi.
- Fumée : `node --env-file=.env scripts/smoke-test-step5.mjs` (54 contrôles bout en bout : configuration, séries, rejet 2-2s, NC automatique, blocage puis déblocage de la validation, Levey-Jennings, exclusion, cycle d’une fiche, visibilité, indicateurs, audit).

---

## 10. Étape 6 — Interfaçage des automates

Les résultats et les contrôles qualité arrivent des analyseurs sans ressaisie. **Une valeur d'automate n'écrase jamais une saisie et n'est jamais validée automatiquement** : la validation technique puis biologique restent humaines.

### Chaîne de transmission
`Automate` → (ASTM E1381/E1394 sur TCP, HL7 v2 MLLP, ou fichier d'export) → **connecteur de poste** (`apps/connector`, voir son README) → `POST /api/instrument-gateway/messages` (clé d'automate) → SIL.

Il est aussi possible d'**importer manuellement un fichier** exporté par l'automate (clé USB, dossier partagé) depuis la fiche de l'automate.

### Automates et comptes de service
- Chaque automate a un **compte de service**, créé avec lui. Ce compte n'a aucun rôle, la base refuse qu'il en ait un, il ne peut pas se connecter et il n'apparaît pas dans la liste des utilisateurs. Les valeurs saisies, les alertes critiques, les séries de CIQ et les non-conformités produites par l'automate apparaissent **à son nom** dans la piste d'audit.
- **Clé du connecteur** : aléatoire (192 bits), affichée **une seule fois**, stockée uniquement sous forme d'empreinte SHA-256. Elle est émise et renouvelée par l'administrateur ; un renouvellement révoque l'ancienne clé. Un automate désactivé voit sa clé refusée.
- **Correspondances** : code test de l'automate → paramètre du catalogue, avec un **facteur de conversion** pour les paramètres numériques (ex. glucose mmol/L → g/L : 0,18016) et une **table de valeurs** (« Target Not Detected » → « <40 », « POS » → « Positif »).
- **Contrôles** : identifiant d'échantillon que l'automate envoie pour un contrôle → lot de contrôle qualité.

### Analyse des messages
| Protocole | Lecture |
|---|---|
| ASTM E1394 / LIS2-A2 | Délimiteurs lus dans l'en-tête H, séquences d'échappement, trames E1381 retirées et sommes de contrôle vérifiées si présentes. O-3 : n° d'échantillon ; R-3 : code test (4e composante) ; R-4 valeur ; R-5 unité ; R-7 indicateurs ; R-9 statut (X = non réalisé) ; R-13 heure. |
| HL7 v2 ORU^R01 | Enveloppe MLLP retirée. N° d'échantillon : SPM-2, sinon OBR-3, sinon OBR-2. OBX-3, OBX-5, OBX-6, OBX-8, OBX-11, OBX-14. Un **ACK** (AA, ou AR si illisible) est renvoyé à l'automate. |
| CSV | Séparateur, en-tête ou numéros de colonnes configurables ; guillemets ; dates ISO ou françaises. |

Les horodatages des automates sont interprétés à l'heure locale du laboratoire. La notation scientifique (`1.23E3`) et les limites (`<40`, `>1000`) sont reconnues.

### Appariement : ce qui arrive à chaque résultat reçu
| Situation | Sort |
|---|---|
| Échantillon reçu, paramètre demandé, rien de saisi | **Intégré** : interprétation et alerte critique calculées par le SIL, source « automate » |
| Même valeur déjà enregistrée | Intégré (rien ne change) |
| Une autre valeur est déjà saisie | **Conflit** : la saisie est conservée ; un technicien peut « retenir » la valeur de l'automate (décision tracée) |
| Examen validé techniquement ou biologiquement | **Examen déjà validé** : rien n'est modifié ; le biologiste ouvre une correction, puis on relance |
| Code test inconnu, échantillon inconnu, non réceptionné, refusé, demande annulée, paramètre non demandé, valeur hors des choix | **Non apparié**, avec le motif |
| Statut X (non réalisé) ou valeur vide | **Non réalisé** |
| Identifiant d'un contrôle | **CIQ intégré** : les niveaux d'un même paramètre forment une série évaluée par les règles de Westgard (étape 5) ; un rejet ouvre la non-conformité et bloque la validation |

La file **« À traiter »** regroupe les conflits, les non appariés et les examens déjà validés. Trois actions y sont possibles, toutes tracées : **retenir** (conflit), **relancer** (après correction de la cause) ou **écarter** (avec motif).

### Traçabilité et intégrité
- Chaque **message brut** est conservé à l'identique, avec son empreinte SHA-256. Un trigger interdit d'en modifier le contenu ou de le supprimer.
- Une **retransmission** identique (même automate, même empreinte) est reconnue et n'est jamais réintégrée, même si deux envois arrivent en même temps.
- Les séries de CIQ transmises dans la même seconde sont départagées par leur ordre d'enregistrement.

### Liste de travail (requête hôte)
`GET /api/instrument-gateway/worklist[?specimens=…]` renvoie les échantillons reçus dont des paramètres réalisables par l'automate restent à saisir, urgences d'abord, en JSON et au format **ASTM** (H, P, O, L ; priorité S pour les urgences). Le connecteur la transmet à l'automate quand celui-ci interroge le SIL sur un tube.

### API de l'étape 6
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/instruments` · `/api/instruments/:id` · `/api/instruments/:id/worklist` | ADMIN, TECHNICIEN, BIOLOGISTE, QUALITE |
| POST · PUT | `/api/instruments` · `/api/instruments/:id` · `/:id/mappings` · `/:id/qc-materials` (et DELETE `/:id/qc-materials/:linkId`) | ADMIN, BIOLOGISTE |
| POST | `/api/instruments/:id/api-key` | ADMIN |
| POST | `/api/instruments/:id/upload` | TECHNICIEN, BIOLOGISTE |
| GET | `/api/instrument-messages` · `/api/instrument-messages/:id` · `/api/instrument-results?status=TO_REVIEW` | ADMIN, TECHNICIEN, BIOLOGISTE, QUALITE |
| POST | `/api/instrument-results/:id/accept` · `/retry` · `/dismiss` | TECHNICIEN, BIOLOGISTE |
| GET · POST | `/api/instrument-gateway/ping` · `/messages` · `/worklist` | **clé d'automate** (en-tête `X-Instrument-Key`) |

### Tests
- Unitaires : 149 tests au total, dont 20 sur les analyseurs et 2 sur la clé du connecteur (300 clés émises : le préfixe affiché ne révèle jamais plus de 4 caractères du secret) ASTM, HL7 et CSV (trames, sommes de contrôle, échappements, MLLP, ACK, conversions de valeurs, fuseau horaire). Le connecteur a 8 tests (`npm test` dans `apps/connector`) sur la couche liaison ASTM E1381 et MLLP.
- Fumée : `node --env-file=.env scripts/smoke-test-step6.mjs`, soit 57 contrôles bout en bout : configuration, comptes de service, clé, ASTM tramé, retransmission, conflit, relance, rejet, examen validé, CIQ et Westgard, liste de travail, HL7 et conversion d'unité, CSV, journal, désactivation, audit.
- Chaîne réelle vérifiée : simulateur d'automate → connecteur → API, pour une numération ASTM, une trame corrompue (NAK puis renvoi), une requête hôte, un message HL7 avec ACK, un fichier CSV déposé, et une **coupure du SIL** (message conservé puis transmis au retour).

---

## 11. Étape 7 — Interopérabilité DHIS2, VLSM / InteLIS et OpenHIM

Le LIMS alimente les deux systèmes nationaux du programme VIH : **DHIS2** reçoit les agrégats mensuels (canevas CV), **VLSM / InteLIS** reçoit chaque résultat de charge virale et d'EID. Chaque connexion est directe ou passe par un **canal OpenHIM**. L'API VLSM suivie est celle d'InteLIS v1.1, dont le contrat OpenAPI est publié dans `deforay/intelis` (`docs/api/openapi.yaml`). Pour DHIS2, c'est la ressource `POST /api/dataValueSets`, avec un résumé d'importation au format WebMessage (DHIS2 ≥ 2.38) ou ImportSummary (versions antérieures).

### Connexions et secrets
- Chaque connexion a un système (DHIS2 ou VLSM) et un acheminement (direct ou OpenHIM). Son adresse de base est la racine de DHIS2, l'API du STS (`…/api/v1.1`) ou l'URL du canal OpenHIM.
- Authentification en direct :
  - DHIS2 accepte Basic ou un jeton d'accès personnel (`ApiToken d2pat_…`) ;
  - VLSM accepte une connexion `/user/login.php`, qui délivre un jeton Bearer et suit sa rotation (`token_updated`), ou un jeton d'API statique.
- **Via OpenHIM**, le LIMS s'authentifie comme *client OpenHIM* (Basic). Les identifiants du système cible restent dans la route ou le médiateur du canal. L'en-tête `X-OpenHIM-TransactionID` est conservé au journal pour croiser les traces avec la console OpenHIM.
- Les mots de passe et jetons sont chiffrés en **AES-256-GCM**, avec la clé `INTEROP_SECRET_KEY` (32 octets : `openssl rand -hex 32`). Le code de la connexion sert de donnée authentifiée. Un secret n'est jamais renvoyé par l'API ni écrit dans l'audit : seule sa présence est visible. **Sauvegardez la clé** : sans elle, les secrets enregistrés sont perdus et doivent être saisis à nouveau.
- Règles :
  - pas d'identifiants dans l'URL ;
  - `https://` obligatoire en production, sauf sur `localhost` ;
  - le code et le système d'une connexion ne se modifient pas ;
  - toute modification efface le dernier test ;
  - une connexion inactive ne transmet rien.
- Le **test de connexion** appelle `/api/system/info` (DHIS2), ou `/user/login.php` puis `/version.php` (VLSM). Il est journalisé comme un échange.

### Rapport mensuel DHIS2
- Une **correspondance** relie un paramètre du catalogue à une cellule DHIS2 (élément de données × combinaison de catégories). Mesures disponibles :
  - nombre de résultats validés ;
  - nombre < seuil ou ≥ seuil ;
  - texte égal à une valeur.
  
  On peut filtrer sur le sexe et une tranche d'âge (min inclus, max exclu), ce qui reproduit les ventilations du canevas CV : < 1000 copies/ml, adultes ≥ 15 ans / enfants < 15 ans, M/F. Une cellule n'est alimentée que par une règle (index unique).
- **Limites de détection** : « < 40 » compte sous un seuil de 1000, et « > 10 000 000 » au-dessus. « < 2000 » face à un seuil de 1000 est **écarté et signalé** (indéterminé), jamais deviné. Un patient sans date de naissance est écarté des ventilations par âge, avec un avertissement.
- Période AAAAMM : sont comptés les résultats ayant reçu leur **validation biologique** pendant le mois, en heure locale du laboratoire, hors demandes annulées. L'âge est calculé à la date de la demande.
- L'**aperçu** donne les valeurs, les exclusions, les avertissements (période en cours…) et l'empreinte SHA-256 de la charge. Il indique aussi si elle est identique au dernier envoi.
- Actions possibles :
  - **CSV d'import** au format DHIS2, pour une saisie hors ligne ;
  - **simulation** (`dryRun=true`) : DHIS2 valide sans rien enregistrer ;
  - **envoi** (`CREATE_AND_UPDATE`) : une période future est refusée.
- Le résumé d'importation est conservé (importées, mises à jour, ignorées, supprimées, conflits avec leur code, ex. E7610). Un envoi avec conflits est un succès partiel. Une valeur inchangée est « ignorée » par DHIS2, sans avertissement.

### Résultats CV et EID vers VLSM / InteLIS
- Un paramètre est déclaré **VL** (charge virale, `/vl/save-request.php`) ou **EID** (`/eid/save-request.php`). Pour l'EID, on indique les valeurs du paramètre qui correspondent à `positive`, `negative` et `indeterminate`. Le catalogue de démarrage ajoute l'examen *PCR ADN VIH-1 (EID)* sur DBS.
- La **file d'envoi** contient les examens biologiquement validés (30 derniers jours par défaut) qui ne sont pas encore acceptés par VLSM dans leur version actuelle. Un résultat incomplet y apparaît avec sa raison et ne peut pas être envoyé : N° TARV ou code de l'enfant manquant (identifiant externe du dossier patient), date de prélèvement inconnue, valeur EID sans correspondance.
- Chaque enregistrement contient :
  - un `uniqueId` stable, dérivé de l'examen : **une correction après validation met à jour le même enregistrement VLSM** ;
  - `appSampleCode` = n° d'échantillon, `labId`, `facilityId`, `specimenType` (selon le type d'échantillon) ;
  - les dates au format VLSM (`01-Sep-2021 10:36`, heure du laboratoire) ;
  - `resultStatus` 7 (accepté) ;
  - pour la VL, « <40 » ou « Target Not Detected » (traduction de « Non détecté »).
- La réponse est lue enregistrement par enregistrement : code VLSM attribué, ou motif de refus. Les envois sont tracés par version d'examen. Un index unique garantit qu'un résultat n'est accepté qu'une fois par version. Un échec reste dans la file avec sa dernière tentative.
- Le journal **ne conserve pas les données patient** envoyées à VLSM, seulement les codes d'échantillon et versions. L'empreinte SHA-256 porte, elle, sur le contenu réellement transmis.

### Journal des échanges
`interop_runs` et `vlsm_submissions` sont **en ajout seul** : un trigger PostgreSQL refuse toute modification et toute suppression. Pour chaque test, simulation ou envoi, on y trouve l'auteur, la durée, le code HTTP, la transaction OpenHIM, le résumé et l'empreinte de la charge. Chaque échange est aussi inscrit dans la piste d'audit chaînée. Les correspondances sont auditées à la création, à la modification et à la suppression.

### API de l'étape 7
| Méthode | Route | Rôles |
|---|---|---|
| GET | `/api/interop/overview` · `/api/interop/endpoints` · `/:id` · `/:id/dhis2-mappings` · `/:id/vlsm-mappings` · `/:id/dhis2/preview?period=` · `/:id/dhis2/csv?period=` · `/:id/vlsm/pending` · `/api/interop/runs` · `/runs/:id` | ADMIN, BIOLOGISTE, QUALITE |
| POST · PUT | `/api/interop/endpoints` · `/:id` · POST `/:id/test` | ADMIN |
| POST · PUT · DELETE | `/:id/dhis2-mappings` · `/api/interop/dhis2-mappings/:id` · `/:id/vlsm-mappings` · `/api/interop/vlsm-mappings/:id` | ADMIN, BIOLOGISTE, QUALITE |
| POST | `/:id/dhis2/send` (`{ period, dryRun }`) · `/:id/vlsm/send` (`{ orderItemIds }`, 100 au plus) | BIOLOGISTE, QUALITE |

L'administrateur configure et teste les connexions, mais ne transmet pas de données de santé : les envois relèvent du biologiste et de la qualité (séparation des tâches).

### Tests
- Unitaires : 166 tests au total, dont 17 pour l'interopérabilité :
  - périodes et âges ;
  - seuils et limites de détection ;
  - agrégation selon le canevas CV et export CSV ;
  - lecture des réponses DHIS2 (2.36 → 2.41) et VLSM (connexion, enregistrement, rotation de jeton) ;
  - chiffrement AES-GCM et en-têtes d'authentification ;
  - format des enregistrements VL et EID.
- Serveurs simulés : `node scripts/mock-interop.mjs 3999` lance un faux DHIS2, un faux VLSM et un faux OpenHIM (canaux `/openhim/dhis2` et `/openhim/vlsm`).
- Fumée : `node --env-file=.env scripts/smoke-test-step7.mjs http://localhost:3000/api http://localhost:3999`, soit 76 contrôles bout en bout. Ils couvrent :
  - connexions, secrets et audit ;
  - tests en direct et via OpenHIM ;
  - délai dépassé, serveur arrêté, identifiants refusés ;
  - correspondances et ventilations par âge, sexe et seuil ;
  - aperçu, CSV, simulation, envoi, renvoi, conflit DHIS2 et période future ;
  - VLSM : file, blocage, envoi VL/EID, correction v2, structure inconnue, échec de connexion ;
  - journal en ajout seul, désactivation et chaîne d'audit.

---

## 12. Erreurs et validation

Toutes les erreurs ont le même format :

```json
{
  "statusCode": 422,
  "code": "BUSINESS_RULE",
  "message": "Vous ne pouvez pas désactiver votre propre compte.",
  "details": { "rule": "SELF_DEACTIVATION" },
  "requestId": "4b1c…",
  "path": "/api/users/…/deactivate",
  "timestamp": "2026-11-22T15:39:29.295Z"
}
```

- **400 `VALIDATION_ERROR`** : `details` contient `[{ path, message }]`, affichés directement sous les champs du formulaire.
- Les schémas Zod de `packages/shared` sont **stricts** (champ inconnu refusé) et ont des messages en français.
- Exceptions métier : `NotFoundError`, `ConflictError`, `BusinessRuleError(rule, message)`.
- Une erreur 500 n'expose jamais de détail technique ; le `requestId` permet de retrouver la trace dans les journaux du serveur.

---

## 13. API du socle

| Méthode | Route | Accès |
|---|---|---|
| POST | `/api/auth/login` | public |
| POST | `/api/auth/refresh` | public (cookie) |
| POST | `/api/auth/logout` | public (cookie) |
| GET | `/api/auth/me` | connecté |
| POST | `/api/auth/change-password` | connecté |
| GET | `/api/users?page&pageSize&search&role&status` | ADMIN |
| GET · PATCH | `/api/users/:id` | ADMIN |
| POST | `/api/users` | ADMIN |
| POST | `/api/users/:id/reset-password` · `deactivate` · `reactivate` · `unlock` | ADMIN |
| GET | `/api/settings/lab` | connecté |
| PUT | `/api/settings/lab` | ADMIN |
| GET | `/api/audit?entity&entityId&actorId&action&from&to` | ADMIN, QUALITE |
| GET | `/api/audit/verify` | ADMIN, QUALITE |
| GET | `/api/health` | public |

---

## 14. Mise en production (points de contrôle)

- `NODE_ENV=production`, `COOKIE_SECURE=true` (l'API refuse de démarrer sinon), HTTPS obligatoire.
- `TRUST_PROXY=true` derrière Nginx ou Traefik, pour journaliser la vraie IP du client.
- Servir `apps/web/dist` et relayer `/api` vers l'API sur **le même domaine** : c'est nécessaire au cookie `SameSite=Strict`.
- Rôle PostgreSQL applicatif **non superutilisateur** : il ne doit pas pouvoir désactiver les triggers d'audit.
- Imprimantes : étiquettes thermiques 50 × 30 mm (203 dpi ou plus), tickets 80 mm. Dans la boîte de dialogue d'impression, choisissez le bon format de papier et une échelle de 100 %.
- `INTEROP_SECRET_KEY` définie et **sauvegardée hors de la base** (coffre ou gestionnaire de secrets) ; connexions DHIS2/VLSM/OpenHIM en `https://` ; compte DHIS2 dédié au LIMS, limité à l'écriture des ensembles de données concernés ; client OpenHIM propre au LIMS.
- Sauvegardes chiffrées et testées. Synchronisation de l'heure (NTP) du serveur de base de données, car l'horodatage de l'audit en dépend.

L'installateur Ubuntu applique d'office tous ces points, sauf les imprimantes et les comptes DHIS2/OpenHIM. `sudo lims check` les contrôle ensuite (section 15).

---

## 15. Déploiement et exploitation (comme InteLIS)

Le déploiement reprend la démarche d'InteLIS :
- un **installateur unique** pour Ubuntu LTS ;
- une **commande unique** pour l'entretien (`lims`, l'équivalent d'`intelis`) ;
- un **assistant dans le navigateur** pour le premier démarrage ;
- des **sauvegardes hors machine** et des **mises à jour sûres**.

Les guides pas à pas sont dans [docs/](docs/index.md).

### Chaîne de livraison
1. Une étiquette `vX.Y.Z` poussée sur GitHub déclenche le workflow **Publication**. Il lance `pnpm release` puis publie l'archive, son `.sha256` et `latest.json` dans GitHub Releases. L'intégration continue (`.github/workflows/ci.yml`) vérifie à chaque envoi les types, les tests et les scripts (shellcheck). `pnpm release` construit `dist-release/lims-x.y.z.tar.gz`. L'archive est **autonome** : API compilée avec ses dépendances de production, web compilé, connecteur, scripts, Docker, documentation. Le script produit aussi son `.sha256` et `latest.json`, qui sert de canal de publication.
2. Sur le serveur, `install.sh` télécharge la dernière version publiée, vérifie son empreinte, puis lance `scripts/setup.sh` ; il enregistre aussi GitHub comme source des mises à jour, pour que `sudo lims update` suffise. Sans Internet : `sudo bash lims-x.y.z/scripts/setup.sh` depuis l'archive. Les réponses sont mémorisées pour reprendre une installation interrompue, et le script peut tourner sans questions (`--yes`). L'installateur fait tout, dans cet ordre :
   - il vérifie Ubuntu 24.04 LTS et installe Node.js 22, PostgreSQL, Nginx et chrony ;
   - il dépose le code dans `/opt/lims/releases/<version>-<date>`, avec le lien `current` ;
   - il génère les secrets dans `/opt/lims/shared/.env` (0640 root:lims) ;
   - il crée la base avec deux rôles. Le propriétaire sert aux migrations. Le rôle applicatif n'a pas de droits sur le schéma et ne peut pas désactiver les triggers d'audit ;
   - il applique les migrations : chaque fichier dans une transaction, journalisé dans `_prisma_migrations`, sans moteur Prisma sur le serveur ;
   - il crée le service systemd durci `lims-api` et les minuteries de sauvegarde (6 h), d'entretien et de santé ;
   - il configure Nginx en HTTPS. Trois modes : autorité locale du laboratoire (certificat publié sur `/lims-ca.crt` pour les postes), Let's Encrypt, ou certificat fourni. Une page de maintenance s'affiche quand l'API est arrêtée ;
   - il fait une première sauvegarde, puis la vérification `PASS / WARN / FAIL / SKIP`.
3. Dans le navigateur, l'**assistant du premier démarrage** (`/installation`) est protégé par un code d'installation. Ce code est affiché par l'installateur et retrouvé par `sudo lims setup-token`. L'assistant crée le laboratoire et l'administrateur, et charge en option le catalogue de démarrage. Il se ferme dès que le premier compte existe ; un verrou PostgreSQL empêche deux créations simultanées.

### Sauvegardes et restauration
- Les sauvegardes locales sont faites par `pg_dump` (format personnalisé), relues avant d'être gardées, accompagnées de leur empreinte SHA-256 et d'une copie de la configuration. Elles sont gardées 30 jours, 8 au moins.
- La copie **hors machine** peut aller vers une autre machine Linux (SSH, clé dédiée), un dossier partagé Windows (CIFS) ou un disque USB (reconnu par son UUID). Les copies sont **chiffrées en AES-256** (gpg) avec une clé de sauvegarde. Cette clé est montrée une fois, à noter hors du serveur, et `lims backup key` l'affiche de nouveau. Les dumps comme le `.env` ne quittent jamais le serveur en clair.
- `lims restore` fonctionne depuis une sauvegarde locale ou depuis la destination (`--from-destination`, qui demande la clé). Une copie de sécurité est prise avant toute restauration. Les migrations sont appliquées et les droits des rôles rétablis. En reprise sur une autre machine, la configuration de l'ancien serveur (dont `INTEROP_SECRET_KEY`) est restaurée ; ce qui est propre à la nouvelle machine est gardé.

### Mises à jour
`lims update --source <archive|url>` fait tout, dans cet ordre :
- il contrôle l'empreinte ;
- il sauvegarde ;
- il applique les migrations transactionnelles ;
- il bascule le lien ;
- il fait reconfigurer le système **par les scripts de la nouvelle version** ;
- il contrôle que la version servie est la bonne.

En cas d'échec, le retour est **automatique** : l'ancien code, et l'ancienne base si le schéma avait changé. `lims rollback` revient à la version précédente sur demande. Les 3 dernières versions sont gardées.

### Diagnostic
`lims check` passe 20 à 25 contrôles :
- système, Node.js, version, droits du `.env`, mode production, secrets ;
- PostgreSQL, rôles, migrations, protection de l'audit ;
- services, Nginx, certificat, heure, disque ;
- sauvegardes et leur chiffrement ;
- assistant d'installation.

`lims doctor` répare sans risque : services, droits du `.env`, commande manquante, migrations en attente, configuration Nginx, certificat expiré, disque plein. Son rapport est expurgé des mots de passe.

### Docker et Windows
- `docker/lims-docker.sh install|update|backup|restore|status|logs` déploie trois conteneurs : PostgreSQL, API et Nginx en HTTPS. L'API applique les rôles et les migrations au démarrage, avec les mêmes scripts. La mise à jour revient en arrière automatiquement.
- Windows passe par WSL 2 (Ubuntu 24.04, réseau en miroir, systemd) avec le même installateur. Voir `docs/guides/installer-sur-windows.md`.
- Connecteur d'automate : `apps/connector/install/install-windows.ps1` (tâche planifiée SYSTEM, relance automatique, pare-feu) et `install-linux.sh` (service systemd durci). Les deux font confiance à l'autorité locale du serveur et affichent son empreinte, à comparer avec `lims certificate show`.

### Tests du déploiement
Les essais ont été faits sur des machines Ubuntu 24.04 neuves (conteneurs systemd) :
- installation de bout en bout et assistant du navigateur ;
- sauvegarde SSH chiffrée, puis **changement de serveur** : nouvelle machine, restauration depuis la destination avec la clé, secrets DHIS2 relisibles, chaîne d'audit intacte ;
- refus d'une mauvaise clé ;
- disque USB ;
- mise à jour 1.7.0 → 1.7.1 avec migration, puis retour arrière ;
- migration volontairement fausse, avec retour automatique ;
- passage d'une ancienne arborescence à la nouvelle ;
- `lims doctor` sur des services arrêtés et des droits de `.env` altérés ;
- connecteur installé en service, qui reçoit une trame ASTM en HTTPS ;
- Docker : installation, assistant, sauvegarde et restauration, mise à jour.

Le partage Windows (CIFS) et l'installateur PowerShell n'ont pas pu être exécutés sur ce banc d'essai : le noyau n'a pas de CIFS et il n'y a pas de Windows. Leur code suit les mêmes chemins que le disque USB et l'installateur Linux.
