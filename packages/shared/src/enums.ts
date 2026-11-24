export const ROLES = [
  'ADMIN',
  'RECEPTION',
  'CAISSE',
  'TECHNICIEN',
  'BIOLOGISTE',
  'QUALITE',
  'COMPTABLE',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrateur',
  RECEPTION: 'Réception',
  CAISSE: 'Caisse',
  TECHNICIEN: 'Technicien',
  BIOLOGISTE: 'Biologiste',
  QUALITE: 'Qualité',
  COMPTABLE: 'Comptable',
};

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'PASSWORD_CHANGE',
  'PASSWORD_RESET',
  'ACCOUNT_LOCKED',
  'ACCOUNT_UNLOCKED',
  'ACCESS_DENIED',
  'TOKEN_REUSE_DETECTED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Création',
  UPDATE: 'Modification',
  DELETE: 'Suppression logique',
  RESTORE: 'Réactivation',
  LOGIN_SUCCESS: 'Connexion réussie',
  LOGIN_FAILURE: 'Échec de connexion',
  LOGOUT: 'Déconnexion',
  PASSWORD_CHANGE: 'Changement de mot de passe',
  PASSWORD_RESET: 'Réinitialisation du mot de passe',
  ACCOUNT_LOCKED: 'Compte verrouillé',
  ACCOUNT_UNLOCKED: 'Compte déverrouillé',
  ACCESS_DENIED: 'Accès refusé',
  TOKEN_REUSE_DETECTED: 'Réutilisation de jeton détectée',
};

/** Entités journalisées. À compléter à chaque nouveau module. */
export const AUDIT_ENTITIES = [
  'User',
  'Session',
  'LabSettings',
  'Route',
  'Patient',
  'Prescriber',
  'LabSection',
  'SampleType',
  'Exam',
  'ExamParameter',
  'ReferenceRange',
  'Order',
  'Sample',
  'NonConformity',
  'Invoice',
  'Payment',
  'CashSession',
  'ExchangeRate',
  'Result',
  'CriticalAlert',
  'Report',
  'QcMaterial',
  'QcTarget',
  'QcRun',
  'QualityIssue',
  'Instrument',
  'InstrumentMessage',
  'InstrumentResult',
  'InteropEndpoint',
  'Dhis2Mapping',
  'VlsmMapping',
  'InteropRun',
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  User: 'Utilisateur',
  Session: 'Session',
  LabSettings: 'Paramètres du laboratoire',
  Route: 'Route API',
  Patient: 'Patient',
  Prescriber: 'Prescripteur',
  LabSection: 'Section du laboratoire',
  SampleType: 'Type d’échantillon',
  Exam: 'Examen',
  ExamParameter: 'Paramètre d’examen',
  ReferenceRange: 'Valeur de référence',
  Order: 'Demande d’examens',
  Sample: 'Échantillon',
  NonConformity: 'Non-conformité',
  Invoice: 'Facture',
  Payment: 'Paiement',
  CashSession: 'Session de caisse',
  ExchangeRate: 'Taux de change',
  Result: 'Résultat d’analyse',
  CriticalAlert: 'Alerte critique',
  Report: 'Compte rendu',
  QcMaterial: 'Matériau de contrôle',
  QcTarget: 'Cible de contrôle',
  QcRun: 'Série de contrôle qualité',
  QualityIssue: 'Fiche de non-conformité',
  Instrument: 'Automate',
  InstrumentMessage: 'Message d’automate',
  InstrumentResult: 'Résultat reçu d’un automate',
  InteropEndpoint: 'Connexion d’interopérabilité',
  Dhis2Mapping: 'Correspondance DHIS2',
  VlsmMapping: 'Correspondance VLSM',
  InteropRun: 'Échange d’interopérabilité',
};

// ---------------------------------------------------------------------------
// Étape 3 — Demandes, échantillons, facturation
// ---------------------------------------------------------------------------

export const ORDER_PRIORITIES = ['ROUTINE', 'URGENT'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];
export const ORDER_PRIORITY_LABELS: Record<OrderPriority, string> = { ROUTINE: 'Normale', URGENT: 'Urgente' };

export const ORDER_STATUSES = [
  'REGISTERED',
  'PARTIALLY_COLLECTED',
  'COLLECTED',
  'RECEIVED',
  'PARTIALLY_VALIDATED',
  'VALIDATED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  REGISTERED: 'Enregistrée',
  PARTIALLY_COLLECTED: 'Prélèvement partiel',
  COLLECTED: 'Prélevée',
  RECEIVED: 'Reçue au laboratoire',
  PARTIALLY_VALIDATED: 'Validée partiellement',
  VALIDATED: 'Validée',
  CANCELLED: 'Annulée',
};

export const SAMPLE_STATUSES = ['PENDING_COLLECTION', 'COLLECTED', 'RECEIVED', 'REJECTED'] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];
export const SAMPLE_STATUS_LABELS: Record<SampleStatus, string> = {
  PENDING_COLLECTION: 'À prélever',
  COLLECTED: 'Prélevé',
  RECEIVED: 'Reçu',
  REJECTED: 'Refusé',
};

export const NON_CONFORMITY_TYPES = [
  'HEMOLYZED',
  'CLOTTED',
  'INSUFFICIENT_VOLUME',
  'WRONG_CONTAINER',
  'IDENTIFICATION_ERROR',
  'TRANSPORT_DELAY',
  'TEMPERATURE',
  'LEAKED',
  'CONTAMINATED',
  'OTHER',
] as const;
export type NonConformityType = (typeof NON_CONFORMITY_TYPES)[number];
export const NON_CONFORMITY_TYPE_LABELS: Record<NonConformityType, string> = {
  HEMOLYZED: 'Échantillon hémolysé',
  CLOTTED: 'Échantillon coagulé',
  INSUFFICIENT_VOLUME: 'Volume insuffisant',
  WRONG_CONTAINER: 'Contenant inadapté',
  IDENTIFICATION_ERROR: 'Erreur ou absence d’identification',
  TRANSPORT_DELAY: 'Délai d’acheminement dépassé',
  TEMPERATURE: 'Température de transport non conforme',
  LEAKED: 'Contenant fuyant ou cassé',
  CONTAMINATED: 'Échantillon contaminé',
  OTHER: 'Autre',
};

export const NON_CONFORMITY_DECISIONS = ['REJECTED', 'ACCEPTED_WITH_RESERVATION'] as const;
export type NonConformityDecision = (typeof NON_CONFORMITY_DECISIONS)[number];
export const NON_CONFORMITY_DECISION_LABELS: Record<NonConformityDecision, string> = {
  REJECTED: 'Refus — nouveau prélèvement',
  ACCEPTED_WITH_RESERVATION: 'Acceptation sous réserve (dérogation)',
};

export const INVOICE_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  UNPAID: 'Non payée',
  PARTIALLY_PAID: 'Partiellement payée',
  PAID: 'Payée',
  CANCELLED: 'Annulée',
};

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Carte bancaire',
  BANK_TRANSFER: 'Virement',
  OTHER: 'Autre',
};
/** Moyens de paiement exigeant une référence de transaction. */
export const PAYMENT_METHODS_WITH_REFERENCE: PaymentMethod[] = ['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER'];

export const CASH_SESSION_STATUSES = ['OPEN', 'CLOSED'] as const;
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];

/** Remise maximale (en % du total) qu'un caissier peut accorder sans administrateur. */
export const MAX_CASHIER_DISCOUNT_PERCENT = 20;

export const SEXES = ['MALE', 'FEMALE', 'UNKNOWN'] as const;
export type Sex = (typeof SEXES)[number];
export const SEX_LABELS: Record<Sex, string> = { MALE: 'Masculin', FEMALE: 'Féminin', UNKNOWN: 'Non précisé' };

export const RANGE_SEXES = ['ANY', 'MALE', 'FEMALE'] as const;
export type RangeSex = (typeof RANGE_SEXES)[number];
export const RANGE_SEX_LABELS: Record<RangeSex, string> = { ANY: 'Tous', MALE: 'Hommes', FEMALE: 'Femmes' };

export const RESULT_TYPES = ['NUMERIC', 'TEXT', 'CHOICE'] as const;
export type ResultType = (typeof RESULT_TYPES)[number];
export const RESULT_TYPE_LABELS: Record<ResultType, string> = {
  NUMERIC: 'Numérique',
  TEXT: 'Texte libre',
  CHOICE: 'Liste de choix',
};

/** Codes d'erreur stables renvoyés par l'API (champ `code`). */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  REFRESH_INVALID: 'REFRESH_INVALID',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  CURRENT_PASSWORD_INVALID: 'CURRENT_PASSWORD_INVALID',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BUSINESS_RULE: 'BUSINESS_RULE',
  DUPLICATE_SUSPECTED: 'DUPLICATE_SUSPECTED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];


/** Devises de la caisse bi-devise. */
export const DUAL_CURRENCIES = ['CDF', 'USD'] as const;

// ---------------------------------------------------------------------------
// Étape 4 — Analyse, validation, comptes rendus
// ---------------------------------------------------------------------------

export const ANALYSIS_STATUSES = ['AWAITING_SAMPLE', 'TO_ENTER', 'ENTERED', 'TECHNICAL_VALIDATED', 'VALIDATED'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export const ANALYSIS_STATUS_LABELS: Record<AnalysisStatus, string> = {
  AWAITING_SAMPLE: 'En attente d’échantillon',
  TO_ENTER: 'À saisir',
  ENTERED: 'Saisi',
  TECHNICAL_VALIDATED: 'Validé techniquement',
  VALIDATED: 'Validé biologiquement',
};

export const RESULT_FLAGS = ['CRITICAL_LOW', 'LOW', 'NORMAL', 'HIGH', 'CRITICAL_HIGH', 'ABNORMAL'] as const;
export type ResultFlag = (typeof RESULT_FLAGS)[number];
export const RESULT_FLAG_LABELS: Record<ResultFlag, string> = {
  CRITICAL_LOW: 'Critique bas',
  LOW: 'Bas',
  NORMAL: 'Normal',
  HIGH: 'Élevé',
  CRITICAL_HIGH: 'Critique haut',
  ABNORMAL: 'Anormal',
};
/** Marqueurs imprimés sur le compte rendu. */
export const RESULT_FLAG_MARKS: Record<ResultFlag, string> = {
  CRITICAL_LOW: '↓↓',
  LOW: '↓',
  NORMAL: '',
  HIGH: '↑',
  CRITICAL_HIGH: '↑↑',
  ABNORMAL: '*',
};
export const CRITICAL_FLAGS: ResultFlag[] = ['CRITICAL_LOW', 'CRITICAL_HIGH'];

export const REPORT_KINDS = ['PARTIAL', 'FINAL', 'AMENDED'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  PARTIAL: 'Compte rendu partiel',
  FINAL: 'Compte rendu définitif',
  AMENDED: 'Compte rendu rectificatif',
};

// ---------------------------------------------------------------------------
// Étape 5 — Qualité : CIQ, non-conformités, indicateurs
// ---------------------------------------------------------------------------

export const QC_STATUSES = ['ACCEPTED', 'WARNING', 'REJECTED'] as const;
export type QcStatus = (typeof QC_STATUSES)[number];
export const QC_STATUS_LABELS: Record<QcStatus, string> = {
  ACCEPTED: 'Accepté',
  WARNING: 'Avertissement',
  REJECTED: 'Rejeté',
};

/** Règles de Westgard évaluées (notation usuelle). */
export const WESTGARD_RULES = ['1-2s', '1-3s', '2-2s', 'R-4s', '4-1s', '10x'] as const;
export type WestgardRule = (typeof WESTGARD_RULES)[number];
export const WESTGARD_RULE_LABELS: Record<WestgardRule, string> = {
  '1-2s': '1-2s : un contrôle au-delà de ±2 ET (avertissement)',
  '1-3s': '1-3s : un contrôle au-delà de ±3 ET (erreur aléatoire)',
  '2-2s': '2-2s : deux contrôles consécutifs au-delà de 2 ET du même côté (erreur systématique)',
  'R-4s': 'R-4s : un niveau au-delà de +2 ET et un autre au-delà de −2 ET dans la même série (erreur aléatoire)',
  '4-1s': '4-1s : quatre contrôles consécutifs au-delà de 1 ET du même côté (erreur systématique)',
  '10x': '10x : dix contrôles consécutifs du même côté de la moyenne (erreur systématique)',
};
/** Seule 1-2s est un avertissement ; toutes les autres règles rejettent la série. */
export const WESTGARD_WARNING_RULES: WestgardRule[] = ['1-2s'];

export const QC_TARGET_SOURCES = ['MANUFACTURER', 'LABORATORY'] as const;
export type QcTargetSource = (typeof QC_TARGET_SOURCES)[number];
export const QC_TARGET_SOURCE_LABELS: Record<QcTargetSource, string> = {
  MANUFACTURER: 'Fabricant (notice du lot)',
  LABORATORY: 'Laboratoire (période probatoire)',
};

export const QUALITY_ISSUE_CATEGORIES = ['PRE_ANALYTICAL', 'ANALYTICAL', 'POST_ANALYTICAL', 'EQUIPMENT', 'REAGENT', 'COMPLAINT', 'SAFETY', 'OTHER'] as const;
export type QualityIssueCategory = (typeof QUALITY_ISSUE_CATEGORIES)[number];
export const QUALITY_ISSUE_CATEGORY_LABELS: Record<QualityIssueCategory, string> = {
  PRE_ANALYTICAL: 'Pré-analytique',
  ANALYTICAL: 'Analytique',
  POST_ANALYTICAL: 'Post-analytique',
  EQUIPMENT: 'Équipement',
  REAGENT: 'Réactifs et consommables',
  COMPLAINT: 'Réclamation',
  SAFETY: 'Hygiène et sécurité',
  OTHER: 'Autre',
};

export const QUALITY_ISSUE_SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
export type QualityIssueSeverity = (typeof QUALITY_ISSUE_SEVERITIES)[number];
export const QUALITY_ISSUE_SEVERITY_LABELS: Record<QualityIssueSeverity, string> = {
  MINOR: 'Mineure',
  MAJOR: 'Majeure',
  CRITICAL: 'Critique',
};

export const QUALITY_ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED'] as const;
export type QualityIssueStatus = (typeof QUALITY_ISSUE_STATUSES)[number];
export const QUALITY_ISSUE_STATUS_LABELS: Record<QualityIssueStatus, string> = {
  OPEN: 'Déclarée',
  IN_PROGRESS: 'Action en cours',
  CLOSED: 'Clôturée',
  CANCELLED: 'Annulée (non fondée)',
};

/** Délai cible de communication d'une valeur critique (indicateur). */
export const CRITICAL_NOTIFICATION_TARGET_MINUTES = 30;

// ---------------------------------------------------------------------------
// Étape 6 — Interfaçage des automates
// ---------------------------------------------------------------------------

export const INSTRUMENT_PROTOCOLS = ['ASTM', 'HL7', 'CSV'] as const;
export type InstrumentProtocol = (typeof INSTRUMENT_PROTOCOLS)[number];
export const INSTRUMENT_PROTOCOL_LABELS: Record<InstrumentProtocol, string> = {
  ASTM: 'ASTM E1394 / LIS2-A2',
  HL7: 'HL7 v2 (ORU^R01)',
  CSV: 'Fichier CSV',
};

export const INSTRUMENT_MESSAGE_STATUSES = ['PROCESSED', 'PARTIAL', 'FAILED'] as const;
export type InstrumentMessageStatus = (typeof INSTRUMENT_MESSAGE_STATUSES)[number];
export const INSTRUMENT_MESSAGE_STATUS_LABELS: Record<InstrumentMessageStatus, string> = {
  PROCESSED: 'Traité',
  PARTIAL: 'À compléter',
  FAILED: 'Illisible',
};

export const INSTRUMENT_MESSAGE_SOURCES = ['GATEWAY', 'UPLOAD'] as const;
export type InstrumentMessageSource = (typeof INSTRUMENT_MESSAGE_SOURCES)[number];
export const INSTRUMENT_MESSAGE_SOURCE_LABELS: Record<InstrumentMessageSource, string> = {
  GATEWAY: 'Connecteur',
  UPLOAD: 'Import de fichier',
};

export const INSTRUMENT_RESULT_KINDS = ['PATIENT', 'QC'] as const;
export type InstrumentResultKind = (typeof INSTRUMENT_RESULT_KINDS)[number];

export const INSTRUMENT_RESULT_STATUSES = ['APPLIED', 'QC_APPLIED', 'CONFLICT', 'UNMATCHED', 'LOCKED', 'NOT_PERFORMED', 'DISMISSED'] as const;
export type InstrumentResultStatus = (typeof INSTRUMENT_RESULT_STATUSES)[number];
export const INSTRUMENT_RESULT_STATUS_LABELS: Record<InstrumentResultStatus, string> = {
  APPLIED: 'Intégré',
  QC_APPLIED: 'CIQ intégré',
  CONFLICT: 'Conflit avec une saisie',
  UNMATCHED: 'Non apparié',
  LOCKED: 'Examen déjà validé',
  NOT_PERFORMED: 'Non réalisé par l’automate',
  DISMISSED: 'Écarté',
};
/** Statuts qui attendent une décision d'un technicien. */
export const INSTRUMENT_RESULT_TO_REVIEW: InstrumentResultStatus[] = ['CONFLICT', 'UNMATCHED', 'LOCKED'];

export const RESULT_SOURCES = ['MANUAL', 'INSTRUMENT'] as const;
export type ResultSource = (typeof RESULT_SOURCES)[number];

// ---------------------------------------------------------------------------
// Étape 7 — Interopérabilité DHIS2, VLSM (InteLIS) et OpenHIM
// ---------------------------------------------------------------------------

export const INTEROP_SYSTEMS = ['DHIS2', 'VLSM'] as const;
export type InteropSystem = (typeof INTEROP_SYSTEMS)[number];
export const INTEROP_SYSTEM_LABELS: Record<InteropSystem, string> = {
  DHIS2: 'DHIS2 (données agrégées)',
  VLSM: 'VLSM / InteLIS (résultats CV et EID)',
};

export const INTEROP_TRANSPORTS = ['DIRECT', 'OPENHIM'] as const;
export type InteropTransport = (typeof INTEROP_TRANSPORTS)[number];
export const INTEROP_TRANSPORT_LABELS: Record<InteropTransport, string> = {
  DIRECT: 'Connexion directe',
  OPENHIM: 'Via un canal OpenHIM',
};

/** BASIC : identifiant + mot de passe (DHIS2 : Basic ; VLSM : connexion /user/login.php). TOKEN : jeton d'API. */
export const INTEROP_AUTH_MODES = ['BASIC', 'TOKEN'] as const;
export type InteropAuthMode = (typeof INTEROP_AUTH_MODES)[number];
export const INTEROP_AUTH_MODE_LABELS: Record<InteropAuthMode, string> = {
  BASIC: 'Identifiant et mot de passe',
  TOKEN: 'Jeton d’API',
};

export const DHIS2_MEASURES = ['VALIDATED_COUNT', 'NUMERIC_BELOW', 'NUMERIC_AT_OR_ABOVE', 'TEXT_EQUALS'] as const;
export type Dhis2Measure = (typeof DHIS2_MEASURES)[number];
export const DHIS2_MEASURE_LABELS: Record<Dhis2Measure, string> = {
  VALIDATED_COUNT: 'Nombre de résultats validés',
  NUMERIC_BELOW: 'Nombre de résultats < seuil',
  NUMERIC_AT_OR_ABOVE: 'Nombre de résultats ≥ seuil',
  TEXT_EQUALS: 'Nombre de résultats égaux à un texte',
};

export const VLSM_TEST_TYPES = ['VL', 'EID'] as const;
export type VlsmTestType = (typeof VLSM_TEST_TYPES)[number];
export const VLSM_TEST_TYPE_LABELS: Record<VlsmTestType, string> = {
  VL: 'Charge virale VIH',
  EID: 'Diagnostic précoce (EID)',
};

export const INTEROP_RUN_KINDS = ['CONNECTION_TEST', 'DHIS2_DRY_RUN', 'DHIS2_SEND', 'VLSM_SEND'] as const;
export type InteropRunKind = (typeof INTEROP_RUN_KINDS)[number];
export const INTEROP_RUN_KIND_LABELS: Record<InteropRunKind, string> = {
  CONNECTION_TEST: 'Test de connexion',
  DHIS2_DRY_RUN: 'DHIS2 — simulation (dryRun)',
  DHIS2_SEND: 'DHIS2 — envoi',
  VLSM_SEND: 'VLSM — envoi de résultats',
};

export const INTEROP_RUN_STATUSES = ['SUCCESS', 'WARNING', 'ERROR'] as const;
export type InteropRunStatus = (typeof INTEROP_RUN_STATUSES)[number];
export const INTEROP_RUN_STATUS_LABELS: Record<InteropRunStatus, string> = {
  SUCCESS: 'Réussi',
  WARNING: 'Avec avertissements',
  ERROR: 'Échec',
};

export const VLSM_SUBMISSION_STATUSES = ['SENT', 'FAILED'] as const;
export type VlsmSubmissionStatus = (typeof VLSM_SUBMISSION_STATUSES)[number];
