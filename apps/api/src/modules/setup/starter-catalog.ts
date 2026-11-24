/**
 * Catalogue de démarrage FACULTATIF : sections, types d'échantillon et quelques examens courants
 * (dont la charge virale VIH et la PCR ADN VIH-1 pour l'EID). Idempotent : un élément dont le code
 * existe déjà n'est pas modifié. Utilisé par l'assistant d'installation et par `pnpm db:seed:catalog`.
 *
 * ⚠ Les tarifs et valeurs de référence sont INDICATIFS. Ils doivent être revus et validés
 *   par le biologiste responsable avant toute utilisation (ISO 15189 §7.3.7 / §7.4.1.4).
 */
import { ageToDays } from '@lims/shared';
import type { Prisma, RangeSex, ResultType } from '../../generated/prisma/client';

const ADULT = ageToDays(18, 'YEARS');
const SIX_MONTHS = ageToDays(6, 'MONTHS');

const SECTIONS = [
  { code: 'HEMATO', name: 'Hématologie', displayOrder: 10 },
  { code: 'BIOCH', name: 'Biochimie', displayOrder: 20 },
  { code: 'IMMUNO', name: 'Immunologie – Sérologie', displayOrder: 30 },
  { code: 'PARASITO', name: 'Parasitologie', displayOrder: 40 },
  { code: 'MICRO', name: 'Microbiologie', displayOrder: 50 },
  { code: 'BIOMOL', name: 'Biologie moléculaire', displayOrder: 60 },
];

const SAMPLE_TYPES = [
  { code: 'ST-EDTA', name: 'Sang total EDTA', container: 'Tube violet (EDTA K2/K3)', instructions: 'Homogénéiser par 8 retournements. Conserver à température ambiante, analyser sous 24 h.' },
  { code: 'SERUM', name: 'Sérum', container: 'Tube sec (bouchon rouge ou jaune)', instructions: 'Laisser coaguler 30 min puis centrifuger.' },
  { code: 'PL-FLUO', name: 'Plasma fluoré', container: 'Tube gris (fluorure / oxalate)', instructions: 'Pour la glycémie : centrifuger dans l’heure.' },
  { code: 'PL-EDTA', name: 'Plasma EDTA', container: 'Tube violet (EDTA) ou PPT', instructions: 'Centrifuger et séparer le plasma dans les 6 h ; congeler à −20 °C si l’analyse est différée.' },
  { code: 'SG-CAP', name: 'Sang capillaire', container: 'Lame / dispositif TDR', instructions: 'Prélèvement au bout du doigt après désinfection.' },
  { code: 'DBS', name: 'Sang séché sur papier buvard (DBS)', container: 'Carte DBS (papier Whatman 903)', instructions: 'Remplir les 5 cercles sans les superposer, sécher 4 h à l’air à l’abri du soleil, emballer avec dessiccant.' },
  { code: 'URINE', name: 'Urines', container: 'Flacon stérile', instructions: 'Urines du matin, deuxième jet, après toilette.' },
];

interface RangeSeed {
  sex?: RangeSex;
  ageMinDays?: number;
  ageMaxDays?: number | null;
  low?: number | null;
  high?: number | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
  normalText?: string | null;
  comment?: string | null;
}

interface ParamSeed {
  code: string;
  name: string;
  resultType: ResultType;
  unit?: string;
  decimals?: number;
  choices?: string[];
  ranges: RangeSeed[];
}

interface ExamSeed {
  code: string;
  name: string;
  shortName?: string;
  section: string;
  sampleType: string;
  price: string;
  turnaroundHours: number;
  patientInstructions?: string;
  parameters: ParamSeed[];
}

const EXAMS: ExamSeed[] = [
  {
    code: 'NFS',
    name: 'Numération formule sanguine',
    shortName: 'NFS',
    section: 'HEMATO',
    sampleType: 'ST-EDTA',
    price: '8000.00',
    turnaroundHours: 4,
    parameters: [
      {
        code: 'HB', name: 'Hémoglobine', resultType: 'NUMERIC', unit: 'g/dL', decimals: 1,
        ranges: [
          { sex: 'MALE', ageMinDays: ADULT, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
          { sex: 'FEMALE', ageMinDays: ADULT, low: 12, high: 16, criticalLow: 7, criticalHigh: 20 },
          { sex: 'ANY', ageMinDays: SIX_MONTHS, ageMaxDays: ADULT, low: 11, high: 14.5, criticalLow: 7, criticalHigh: 20 },
        ],
      },
      { code: 'HT', name: 'Hématocrite', resultType: 'NUMERIC', unit: '%', decimals: 1, ranges: [
        { sex: 'MALE', ageMinDays: ADULT, low: 40, high: 52 },
        { sex: 'FEMALE', ageMinDays: ADULT, low: 36, high: 47 },
      ] },
      { code: 'GB', name: 'Leucocytes', resultType: 'NUMERIC', unit: '10^3/µL', decimals: 1, ranges: [
        { sex: 'ANY', ageMinDays: ADULT, low: 4, high: 10, criticalLow: 2, criticalHigh: 30 },
      ] },
      { code: 'PLT', name: 'Plaquettes', resultType: 'NUMERIC', unit: '10^3/µL', decimals: 0, ranges: [
        { sex: 'ANY', ageMinDays: 0, low: 150, high: 400, criticalLow: 50, criticalHigh: 1000 },
      ] },
    ],
  },
  {
    code: 'GLY',
    name: 'Glycémie à jeun',
    section: 'BIOCH',
    sampleType: 'PL-FLUO',
    price: '3000.00',
    turnaroundHours: 2,
    patientInstructions: 'À jeun depuis 8 à 12 heures (eau autorisée).',
    parameters: [
      { code: 'GLY', name: 'Glucose', resultType: 'NUMERIC', unit: 'g/L', decimals: 2, ranges: [
        { sex: 'ANY', ageMinDays: ADULT, low: 0.7, high: 1.1, criticalLow: 0.4, criticalHigh: 5 },
      ] },
    ],
  },
  {
    code: 'CREA',
    name: 'Créatininémie',
    section: 'BIOCH',
    sampleType: 'SERUM',
    price: '5000.00',
    turnaroundHours: 4,
    parameters: [
      { code: 'CREA', name: 'Créatinine', resultType: 'NUMERIC', unit: 'mg/L', decimals: 1, ranges: [
        { sex: 'MALE', ageMinDays: ADULT, low: 7, high: 13 },
        { sex: 'FEMALE', ageMinDays: ADULT, low: 5, high: 11 },
      ] },
    ],
  },
  {
    code: 'CD4',
    name: 'Numération des lymphocytes T CD4',
    shortName: 'CD4',
    section: 'IMMUNO',
    sampleType: 'ST-EDTA',
    price: '15000.00',
    turnaroundHours: 24,
    parameters: [
      { code: 'CD4', name: 'Lymphocytes T CD4', resultType: 'NUMERIC', unit: 'cellules/µL', decimals: 0, ranges: [
        { sex: 'ANY', ageMinDays: ageToDays(5, 'YEARS'), low: 500, high: 1500, comment: '< 200 cellules/µL : maladie VIH avancée (OMS).' },
      ] },
    ],
  },
  {
    code: 'CV-VIH',
    name: 'Charge virale VIH-1',
    shortName: 'CV VIH',
    section: 'BIOMOL',
    sampleType: 'PL-EDTA',
    price: '30000.00',
    turnaroundHours: 168,
    parameters: [
      { code: 'CV', name: 'ARN VIH-1', resultType: 'NUMERIC', unit: 'copies/mL', decimals: 0, ranges: [
        { sex: 'ANY', ageMinDays: 0, high: 999, comment: 'Suppression virale : < 1 000 copies/mL (seuil OMS).' },
      ] },
    ],
  },
  {
    code: 'EID-PCR',
    name: 'PCR ADN VIH-1 (diagnostic précoce du nourrisson, EID)',
    shortName: 'EID',
    section: 'BIOMOL',
    sampleType: 'DBS',
    price: '0.00',
    turnaroundHours: 336,
    parameters: [
      { code: 'EID', name: 'ADN VIH-1 (PCR qualitative)', resultType: 'CHOICE', choices: ['Négatif', 'Positif', 'Indéterminé'], ranges: [
        { sex: 'ANY', normalText: 'Négatif', comment: 'Tout résultat positif impose un second prélèvement de confirmation.' },
      ] },
    ],
  },
  {
    code: 'TDR-VIH',
    name: 'Dépistage VIH (test rapide)',
    section: 'IMMUNO',
    sampleType: 'SG-CAP',
    price: '0.00',
    turnaroundHours: 1,
    parameters: [
      { code: 'TDR-VIH', name: 'Résultat', resultType: 'CHOICE', choices: ['Négatif', 'Positif', 'Indéterminé'], ranges: [
        { sex: 'ANY', normalText: 'Négatif', comment: 'Tout résultat positif doit suivre l’algorithme national de confirmation.' },
      ] },
    ],
  },
  {
    code: 'GE',
    name: 'Goutte épaisse',
    section: 'PARASITO',
    sampleType: 'SG-CAP',
    price: '2000.00',
    turnaroundHours: 1,
    parameters: [
      { code: 'GE', name: 'Recherche de Plasmodium', resultType: 'CHOICE', choices: ['Négative', 'Positive'], ranges: [
        { sex: 'ANY', normalText: 'Négative' },
      ] },
    ],
  },
];

export const STARTER_CATALOG_REASON = 'Catalogue de démarrage — valeurs indicatives à valider par le biologiste';

/** Crée les éléments manquants du catalogue de démarrage dans la transaction ; renvoie le nombre d'éléments créés. */
export async function applyStarterCatalog(tx: Prisma.TransactionClient, reason: string = STARTER_CATALOG_REASON): Promise<number> {
  const log = (entity: string, entityId: string, after: object) => ({ actorUsername: 'system', action: 'CREATE' as const, entity, entityId, after, reason });
  let created = 0;
    const sectionIds = new Map<string, string>();
    for (const s of SECTIONS) {
      let row = await tx.labSection.findUnique({ where: { code: s.code } });
      if (!row) {
        row = await tx.labSection.create({ data: s });
        await tx.auditLog.create({ data: log('LabSection', row.id, s) });
        created++;
      }
      sectionIds.set(s.code, row.id);
    }

    const sampleIds = new Map<string, string>();
    for (const t of SAMPLE_TYPES) {
      let row = await tx.sampleType.findUnique({ where: { code: t.code } });
      if (!row) {
        row = await tx.sampleType.create({ data: t });
        await tx.auditLog.create({ data: log('SampleType', row.id, t) });
        created++;
      }
      sampleIds.set(t.code, row.id);
    }

    for (const e of EXAMS) {
      if (await tx.exam.findUnique({ where: { code: e.code } })) continue;
      const exam = await tx.exam.create({
        data: {
          code: e.code,
          name: e.name,
          shortName: e.shortName ?? null,
          sectionId: sectionIds.get(e.section)!,
          sampleTypeId: sampleIds.get(e.sampleType)!,
          price: e.price,
          turnaroundHours: e.turnaroundHours,
          patientInstructions: e.patientInstructions ?? null,
          isActive: true,
        },
      });
      await tx.auditLog.create({ data: log('Exam', exam.id, { code: e.code, name: e.name, price: e.price }) });
      created++;

      for (const [index, p] of e.parameters.entries()) {
        const param = await tx.examParameter.create({
          data: {
            examId: exam.id,
            code: p.code,
            name: p.name,
            resultType: p.resultType,
            unit: p.unit ?? null,
            decimals: p.resultType === 'NUMERIC' ? (p.decimals ?? null) : null,
            choices: p.choices ?? [],
            displayOrder: (index + 1) * 10,
          },
        });
        await tx.auditLog.create({ data: log('ExamParameter', param.id, { exam: e.code, code: p.code, name: p.name }) });
        for (const r of p.ranges) {
          const range = await tx.referenceRange.create({
            data: {
              parameterId: param.id,
              sex: r.sex ?? 'ANY',
              ageMinDays: r.ageMinDays ?? 0,
              ageMaxDays: r.ageMaxDays ?? null,
              low: r.low ?? null,
              high: r.high ?? null,
              criticalLow: r.criticalLow ?? null,
              criticalHigh: r.criticalHigh ?? null,
              normalText: r.normalText ?? null,
              comment: r.comment ?? null,
            },
          });
          await tx.auditLog.create({ data: log('ReferenceRange', range.id, { exam: e.code, parameter: p.code, ...r }) });
        }
      }
    }
  return created;
}
