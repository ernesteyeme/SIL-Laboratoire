import type { Role } from '@lims/shared';

/**
 * Groupes de rôles réutilisés par les contrôleurs, pour garder la matrice des droits lisible.
 * Toute évolution ici doit être reportée dans la matrice du README et dans la navigation du frontend.
 */
export const ROLE_GROUPS = {
  /** Consultation des dossiers patients : tous les rôles qui traitent des demandes (pas la comptabilité). */
  PATIENT_READ: ['ADMIN', 'RECEPTION', 'CAISSE', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE'],
  /** Création et modification des patients et prescripteurs. */
  REGISTRATION_WRITE: ['ADMIN', 'RECEPTION'],
  /** Définition technique du catalogue : examens, paramètres, valeurs de référence. */
  CATALOG_TECHNICAL_WRITE: ['ADMIN', 'BIOLOGISTE'],
  /** Prélèvement des échantillons (préleveurs). */
  SAMPLE_COLLECT: ['ADMIN', 'RECEPTION', 'TECHNICIEN', 'BIOLOGISTE'],
  /** Réception des échantillons au laboratoire et non-conformités pré-analytiques. */
  SAMPLE_RECEIVE: ['ADMIN', 'TECHNICIEN', 'BIOLOGISTE'],
  /** Demande de nouveau prélèvement après refus. */
  SAMPLE_RECOLLECT: ['ADMIN', 'RECEPTION', 'TECHNICIEN', 'BIOLOGISTE'],
  /** Consultation des factures, paiements et sessions de caisse. */
  BILLING_READ: ['ADMIN', 'CAISSE', 'COMPTABLE'],
  /** Encaissement, remises, sessions de caisse. */
  CASHIER: ['ADMIN', 'CAISSE'],
  /** Saisie des résultats, validation technique, communication des valeurs critiques. */
  ANALYSIS: ['TECHNICIEN', 'BIOLOGISTE'],
  /** Saisie du cours du jour USD/CDF. */
  EXCHANGE_RATE_WRITE: ['ADMIN', 'COMPTABLE'],
  /** Consultation du contrôle qualité interne (séries, graphiques de Levey-Jennings). */
  QC_READ: ['ADMIN', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE'],
  /** Lots de contrôle et valeurs cibles. */
  QC_CONFIG: ['ADMIN', 'BIOLOGISTE', 'QUALITE'],
  /** Action corrective après un CIQ rejeté. */
  QC_CORRECTIVE: ['TECHNICIEN', 'BIOLOGISTE', 'QUALITE'],
  /** Exclusion d'une série des statistiques (supervision). */
  QC_EXCLUDE: ['BIOLOGISTE', 'QUALITE'],
  /** Consultation de toutes les fiches de non-conformité (les autres rôles ne voient que les leurs). */
  QUALITY_READ_ALL: ['ADMIN', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE'],
  /** Analyse des causes et plan d'action d'une non-conformité. */
  QUALITY_MANAGE: ['ADMIN', 'BIOLOGISTE', 'QUALITE'],
  /** Clôture (vérification d'efficacité) ou annulation d'une non-conformité. */
  QUALITY_CLOSE: ['QUALITE'],
  /** Tableau de bord des indicateurs qualité. */
  INDICATORS: ['ADMIN', 'BIOLOGISTE', 'QUALITE'],
  /** Consultation des automates, des messages reçus et de la file à traiter. */
  INSTRUMENT_READ: ['ADMIN', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE'],
  /** Déclaration des automates, correspondances des codes tests et des contrôles. */
  INSTRUMENT_CONFIG: ['ADMIN', 'BIOLOGISTE'],
  /** Import de fichier et décisions sur les résultats reçus (accepter, relancer, écarter). */
  INSTRUMENT_OPERATE: ['TECHNICIEN', 'BIOLOGISTE'],
  /** Émission ou renouvellement de la clé d'API d'un connecteur. */
  INSTRUMENT_KEY: ['ADMIN'],
  /** Consultation des connexions DHIS2/VLSM, des correspondances, des aperçus et du journal des échanges. */
  INTEROP_READ: ['ADMIN', 'BIOLOGISTE', 'QUALITE'],
  /** Déclaration des connexions (adresses, comptes, secrets) et test de connexion. */
  INTEROP_CONFIG: ['ADMIN'],
  /** Correspondances paramètres → éléments de données DHIS2 / tests VLSM. */
  INTEROP_MAPPING: ['ADMIN', 'BIOLOGISTE', 'QUALITE'],
  /** Simulation et envoi des rapports DHIS2, envoi des résultats à VLSM. */
  INTEROP_SEND: ['BIOLOGISTE', 'QUALITE'],
} as const satisfies Record<string, readonly Role[]>;

export type RoleTuple = [Role, ...Role[]];

/** Conversion pour le décorateur @Roles(...). */
export function rolesOf(group: readonly Role[]): RoleTuple {
  return [...group] as RoleTuple;
}
