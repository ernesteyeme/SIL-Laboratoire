import type { Role } from '@lims/shared';
import {
  Activity,
  BarChart3,
  BookOpenCheck,
  Cable,
  ClipboardList,
  TestTubes,
  Wallet,
  LayoutDashboard,
  Network,
  Microscope,
  ScrollText,
  ShieldAlert,
  Settings,
  Stethoscope,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Rôles autorisés ; absent = tout utilisateur connecté. */
  roles?: Role[];
  description: string;
  group: 'main' | 'activity' | 'quality' | 'referentials' | 'admin';
}

/** Mêmes groupes que ROLE_GROUPS côté API (apps/api/src/core/security/role-groups.ts). */
export const PATIENT_READ_ROLES: Role[] = ['ADMIN', 'RECEPTION', 'CAISSE', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE'];
export const REGISTRATION_WRITE_ROLES: Role[] = ['ADMIN', 'RECEPTION'];
export const CATALOG_TECHNICAL_WRITE_ROLES: Role[] = ['ADMIN', 'BIOLOGISTE'];
export const SAMPLE_COLLECT_ROLES: Role[] = ['ADMIN', 'RECEPTION', 'TECHNICIEN', 'BIOLOGISTE'];
export const SAMPLE_RECEIVE_ROLES: Role[] = ['ADMIN', 'TECHNICIEN', 'BIOLOGISTE'];
export const SAMPLE_RECOLLECT_ROLES: Role[] = ['ADMIN', 'RECEPTION', 'TECHNICIEN', 'BIOLOGISTE'];
export const DEROGATION_ROLES: Role[] = ['ADMIN', 'BIOLOGISTE'];
export const BILLING_READ_ROLES: Role[] = ['ADMIN', 'CAISSE', 'COMPTABLE'];
export const CASHIER_ROLES: Role[] = ['ADMIN', 'CAISSE'];
export const EXCHANGE_RATE_WRITE_ROLES: Role[] = ['ADMIN', 'COMPTABLE'];
/** Saisie des résultats, validation technique, communication des valeurs critiques. */
export const ANALYSIS_ROLES: Role[] = ['TECHNICIEN', 'BIOLOGISTE'];
/** Validation biologique, renvoi en saisie, correction, compte rendu partiel. */
export const BIOLOGIST_ROLES: Role[] = ['BIOLOGISTE'];
export const QC_READ_ROLES: Role[] = ['ADMIN', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE'];
export const QC_CONFIG_ROLES: Role[] = ['ADMIN', 'BIOLOGISTE', 'QUALITE'];
export const QC_CORRECTIVE_ROLES: Role[] = ['TECHNICIEN', 'BIOLOGISTE', 'QUALITE'];
export const QC_EXCLUDE_ROLES: Role[] = ['BIOLOGISTE', 'QUALITE'];
export const QUALITY_READ_ALL_ROLES: Role[] = ['ADMIN', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE'];
export const QUALITY_MANAGE_ROLES: Role[] = ['ADMIN', 'BIOLOGISTE', 'QUALITE'];
export const QUALITY_CLOSE_ROLES: Role[] = ['QUALITE'];
export const INDICATORS_ROLES: Role[] = ['ADMIN', 'BIOLOGISTE', 'QUALITE'];
export const INSTRUMENT_READ_ROLES: Role[] = ['ADMIN', 'TECHNICIEN', 'BIOLOGISTE', 'QUALITE'];
export const INSTRUMENT_CONFIG_ROLES: Role[] = ['ADMIN', 'BIOLOGISTE'];
export const INSTRUMENT_OPERATE_ROLES: Role[] = ['TECHNICIEN', 'BIOLOGISTE'];
export const INSTRUMENT_KEY_ROLES: Role[] = ['ADMIN'];
export const INTEROP_READ_ROLES: Role[] = ['ADMIN', 'BIOLOGISTE', 'QUALITE'];
export const INTEROP_CONFIG_ROLES: Role[] = ['ADMIN'];
export const INTEROP_MAPPING_ROLES: Role[] = ['ADMIN', 'BIOLOGISTE', 'QUALITE'];
export const INTEROP_SEND_ROLES: Role[] = ['BIOLOGISTE', 'QUALITE'];

/**
 * Source unique des écrans et des rôles qui y ont accès.
 * Les mêmes rôles sont vérifiés côté API : le frontend ne fait que masquer.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, description: 'Vue d’ensemble', group: 'main' },
  {
    to: '/demandes',
    label: 'Demandes',
    icon: ClipboardList,
    roles: PATIENT_READ_ROLES,
    description: 'Enregistrement et suivi des demandes',
    group: 'activity',
  },
  {
    to: '/echantillons',
    label: 'Échantillons',
    icon: TestTubes,
    roles: SAMPLE_COLLECT_ROLES,
    description: 'Prélèvement, réception, non-conformités',
    group: 'activity',
  },
  {
    to: '/paillasses',
    label: 'Paillasses',
    icon: Microscope,
    roles: ANALYSIS_ROLES,
    description: 'Saisie et validation des résultats',
    group: 'activity',
  },
  {
    to: '/automates',
    label: 'Automates',
    icon: Cable,
    roles: INSTRUMENT_READ_ROLES,
    description: 'Résultats reçus des analyseurs, connecteurs',
    group: 'activity',
  },
  {
    to: '/caisse',
    label: 'Caisse',
    icon: Wallet,
    roles: BILLING_READ_ROLES,
    description: 'Encaissements et sessions de caisse',
    group: 'activity',
  },
  {
    to: '/qualite/ciq',
    label: 'Contrôle qualité',
    icon: Activity,
    roles: QC_READ_ROLES,
    description: 'CIQ, règles de Westgard, Levey-Jennings',
    group: 'quality',
  },
  {
    to: '/qualite/non-conformites',
    label: 'Non-conformités',
    icon: ShieldAlert,
    description: 'Déclaration, actions correctives',
    group: 'quality',
  },
  {
    to: '/qualite/indicateurs',
    label: 'Indicateurs',
    icon: BarChart3,
    roles: INDICATORS_ROLES,
    description: 'Délais de rendu, rejets, CIQ',
    group: 'quality',
  },
  {
    to: '/patients',
    label: 'Patients',
    icon: UserRound,
    roles: PATIENT_READ_ROLES,
    description: 'Dossiers et identification',
    group: 'referentials',
  },
  {
    to: '/prescripteurs',
    label: 'Prescripteurs',
    icon: Stethoscope,
    roles: PATIENT_READ_ROLES,
    description: 'Médecins et structures',
    group: 'referentials',
  },
  {
    to: '/catalogue',
    label: 'Catalogue',
    icon: BookOpenCheck,
    description: 'Examens, tarifs, valeurs de référence',
    group: 'referentials',
  },
  {
    to: '/interoperabilite',
    label: 'Interopérabilité',
    icon: Network,
    roles: INTEROP_READ_ROLES,
    description: 'Rapports DHIS2, résultats CV/EID vers VLSM, OpenHIM',
    group: 'quality',
  },
  {
    to: '/utilisateurs',
    label: 'Utilisateurs',
    icon: Users,
    roles: ['ADMIN'],
    description: 'Comptes, rôles et accès',
    group: 'admin',
  },
  {
    to: '/audit',
    label: 'Piste d’audit',
    icon: ScrollText,
    roles: ['ADMIN', 'QUALITE'],
    description: 'Traçabilité et intégrité',
    group: 'admin',
  },
  {
    to: '/parametres',
    label: 'Paramètres',
    icon: Settings,
    roles: ['ADMIN'],
    description: 'Identité du laboratoire',
    group: 'admin',
  },
];

export const NAV_GROUP_LABELS: Record<NavItem['group'], string | null> = {
  main: null,
  activity: 'Activité',
  quality: 'Qualité',
  referentials: 'Référentiels',
  admin: 'Administration',
};

export function canAccess(item: Pick<NavItem, 'roles'>, userRoles: Role[]): boolean {
  return !item.roles || item.roles.some((r) => userRoles.includes(r));
}
