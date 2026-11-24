import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import {
  formatNumericRange,
  REPORT_KIND_LABELS,
  RESULT_FLAG_MARKS,
  SEX_LABELS,
  type ReportKind,
  type ResultFlag,
  type Sex,
} from '@lims/shared';

/** Contenu figé d'un compte rendu (tout est déjà formaté : le PDF n'interroge pas la base). */
export interface ReportContent {
  lab: {
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    accreditation: string | null;
    directorName: string | null;
    footer: string | null;
  };
  number: string;
  version: number;
  kind: ReportKind;
  supersedes: { number: string; issuedAt: string } | null;
  amendmentReasons: string[];
  pendingExams: string[];
  patient: { fullName: string; code: string; sex: Sex; age: string | null; birthDate: string | null; externalId: string | null };
  order: { number: string; prescriber: string | null; collectedAt: string | null; receivedAt: string | null; clinicalInfo: string | null };
  issuedAt: string;
  sections: {
    name: string;
    exams: {
      name: string;
      code: string;
      sampleType: string;
      results: {
        name: string;
        value: string;
        unit: string | null;
        flag: ResultFlag | null;
        reference: string;
        previous: string | null;
        comment: string | null;
      }[];
      reservation: string | null;
      biologistComment: string | null;
      validation: string;
    }[];
  }[];
  validators: string[];
}

/** Polices embarquées (DejaVu Sans) : couvrent les accents, µ, ≤, ≥, ↑, ↓. */
function fontsDir(): string {
  const candidates = [join(__dirname, '..', '..', '..', 'assets', 'fonts'), join(process.cwd(), 'assets', 'fonts')];
  const found = candidates.find((d) => existsSync(join(d, 'DejaVuSans.ttf')));
  if (!found) throw new Error('Polices du compte rendu introuvables (assets/fonts/DejaVuSans.ttf).');
  return found;
}

const COLORS = { text: '#111827', muted: '#4b5563', line: '#d1d5db', band: '#e6f2f1', brand: '#115e59', alert: '#b91c1c' };
const M = 40; // marge

export function buildReportPdf(c: ReportContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const dir = fontsDir();
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: M, bottom: 60, left: M, right: M },
      bufferPages: true,
      info: { Title: `Compte rendu ${c.number}`, Author: c.lab.name, Subject: `Demande ${c.order.number}`, Creator: 'SIL Laboratoire' },
    });
    doc.registerFont('R', join(dir, 'DejaVuSans.ttf'));
    doc.registerFont('B', join(dir, 'DejaVuSans-Bold.ttf'));
    const chunks: Buffer[] = [];
    doc.on('data', (d: Buffer) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - 2 * M;
    const bottomLimit = () => doc.page.height - 80;

    // ---------------------------------------------------------------- En-tête
    doc.font('B').fontSize(14).fillColor(COLORS.brand).text(c.lab.name, M, M, { width: width * 0.6 });
    doc.font('R').fontSize(8.5).fillColor(COLORS.muted);
    const labLines = [
      c.lab.address,
      [c.lab.city, c.lab.country].filter(Boolean).join(', '),
      [c.lab.phone, c.lab.email].filter(Boolean).join(' · '),
      c.lab.accreditation,
    ].filter((l): l is string => !!l);
    for (const line of labLines) doc.text(line, { width: width * 0.6 });
    const headerBottom = doc.y;

    doc.font('B').fontSize(12).fillColor(COLORS.text).text("COMPTE RENDU D'ANALYSES", M + width * 0.55, M, { width: width * 0.45, align: 'right' });
    doc.font('R').fontSize(9).fillColor(c.kind === 'FINAL' ? COLORS.muted : COLORS.alert).text(REPORT_KIND_LABELS[c.kind], { width: width * 0.45, align: 'right' });
    doc.fillColor(COLORS.muted).text(`N° ${c.number} · version ${c.version}`, { width: width * 0.45, align: 'right' });
    doc.text(`Édité le ${c.issuedAt}`, { width: width * 0.45, align: 'right' });
    doc.y = Math.max(headerBottom, doc.y) + 8;
    doc.moveTo(M, doc.y).lineTo(M + width, doc.y).strokeColor(COLORS.brand).lineWidth(1).stroke();
    doc.moveDown(0.6);

    // ---------------------------------------------------------------- Patient / demande
    const boxTop = doc.y;
    const col = width / 2;
    const kv = (label: string, value: string | null, x: number, w: number) => {
      doc.font('R').fontSize(8).fillColor(COLORS.muted).text(label, x, doc.y, { continued: true, width: w });
      doc.font('B').fillColor(COLORS.text).text(` ${value ?? '—'}`, { width: w });
    };
    doc.y = boxTop;
    doc.font('B').fontSize(11).fillColor(COLORS.text).text(c.patient.fullName, M, doc.y, { width: col - 10 });
    kv('Code patient :', c.patient.code, M, col - 10);
    kv('Sexe :', SEX_LABELS[c.patient.sex], M, col - 10);
    kv('Âge au prélèvement :', c.patient.age, M, col - 10);
    if (c.patient.birthDate) kv('Né(e) le :', c.patient.birthDate, M, col - 10);
    if (c.patient.externalId) kv('Réf. externe :', c.patient.externalId, M, col - 10);
    const leftBottom = doc.y;
    doc.y = boxTop;
    kv('Demande :', c.order.number, M + col, col);
    kv('Prescripteur :', c.order.prescriber, M + col, col);
    kv('Prélevé le :', c.order.collectedAt, M + col, col);
    kv('Reçu le :', c.order.receivedAt, M + col, col);
    if (c.order.clinicalInfo) kv('Renseignements :', c.order.clinicalInfo, M + col, col);
    doc.y = Math.max(leftBottom, doc.y) + 6;
    doc.rect(M - 6, boxTop - 6, width + 12, doc.y - boxTop + 4).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    doc.moveDown(0.8);

    // ---------------------------------------------------------------- Bandeaux
    const banner = (text: string) => {
      const top = doc.y;
      doc.font('B').fontSize(8.5).fillColor(COLORS.alert).text(text, M + 6, top + 4, { width: width - 12 });
      const h = doc.y - top + 4;
      doc.rect(M, top, width, h).strokeColor(COLORS.alert).lineWidth(0.8).stroke();
      doc.y = top + h + 8;
    };
    if (c.kind === 'AMENDED' && c.supersedes) {
      banner(
        `Ce compte rendu annule et remplace le compte rendu ${c.supersedes.number} du ${c.supersedes.issuedAt}.` +
          (c.amendmentReasons.length > 0 ? ` Motif : ${c.amendmentReasons.join(' ; ')}` : ''),
      );
    }
    if (c.kind === 'PARTIAL' && c.pendingExams.length > 0) {
      banner(`Compte rendu partiel — examens en cours : ${c.pendingExams.join(', ')}. Un compte rendu définitif suivra.`);
    }

    // ---------------------------------------------------------------- Résultats
    const cols = { name: M, value: M + 170, unit: M + 255, ref: M + 315, prev: M + 410 };
    const tableHeader = () => {
      doc.font('B').fontSize(7.5).fillColor(COLORS.muted);
      const y = doc.y;
      doc.text('Paramètre', cols.name, y, { width: 165 });
      doc.text('Résultat', cols.value, y, { width: 80 });
      doc.text('Unité', cols.unit, y, { width: 58 });
      doc.text('Valeurs de référence', cols.ref, y, { width: 92 });
      doc.text('Antériorité', cols.prev, y, { width: width - (cols.prev - M) });
      doc.y = y + 11;
      doc.moveTo(M, doc.y).lineTo(M + width, doc.y).strokeColor(COLORS.line).lineWidth(0.5).stroke();
      doc.y += 3;
    };
    const ensureSpace = (needed: number) => {
      if (doc.y + needed > bottomLimit()) {
        doc.addPage();
        doc.font('R').fontSize(8).fillColor(COLORS.muted).text(`${c.patient.fullName} · ${c.patient.code} · demande ${c.order.number} · ${c.number}`, M, M);
        doc.moveDown(0.8);
      }
    };

    for (const section of c.sections) {
      ensureSpace(60);
      const top = doc.y;
      doc.rect(M, top, width, 16).fill(COLORS.band);
      doc.font('B').fontSize(9.5).fillColor(COLORS.brand).text(section.name.toUpperCase(), M + 6, top + 4, { width: width - 12 });
      doc.y = top + 22;

      for (const exam of section.exams) {
        ensureSpace(50);
        doc.font('B').fontSize(10).fillColor(COLORS.text).text(exam.name, M, doc.y, { continued: true });
        doc.font('R').fontSize(8).fillColor(COLORS.muted).text(`   ${exam.code} · ${exam.sampleType}`);
        doc.moveDown(0.2);
        tableHeader();

        for (const r of exam.results) {
          ensureSpace(r.comment ? 28 : 16);
          const y = doc.y;
          const abnormal = r.flag !== null && r.flag !== 'NORMAL';
          const critical = r.flag === 'CRITICAL_LOW' || r.flag === 'CRITICAL_HIGH';
          doc.font('R').fontSize(8.5).fillColor(COLORS.text).text(r.name, cols.name, y, { width: 165 });
          const nameBottom = doc.y;
          doc
            .font(abnormal ? 'B' : 'R')
            .fillColor(critical ? COLORS.alert : COLORS.text)
            .text(`${r.value}${r.flag ? ` ${RESULT_FLAG_MARKS[r.flag]}` : ''}`.trim(), cols.value, y, { width: 80 });
          doc.font('R').fillColor(COLORS.muted).text(r.unit ?? '', cols.unit, y, { width: 58 });
          doc.text(r.reference, cols.ref, y, { width: 92 });
          const refBottom = doc.y;
          doc.text(r.previous ?? '', cols.prev, y, { width: width - (cols.prev - M) });
          doc.y = Math.max(nameBottom, refBottom, doc.y) + 2;
          if (r.comment) {
            doc.font('R').fontSize(7.5).fillColor(COLORS.muted).text(`↳ ${r.comment}`, cols.name + 8, doc.y, { width: width - 8 });
            doc.y += 2;
          }
        }
        if (exam.reservation) {
          ensureSpace(20);
          doc.font('B').fontSize(7.5).fillColor(COLORS.alert).text(`Réserve : ${exam.reservation}`, M, doc.y + 2, { width });
        }
        if (exam.biologistComment) {
          ensureSpace(20);
          doc.font('R').fontSize(8).fillColor(COLORS.text).text(`Commentaire : ${exam.biologistComment}`, M, doc.y + 2, { width });
        }
        doc.font('R').fontSize(7).fillColor(COLORS.muted).text(exam.validation, M, doc.y + 2, { width });
        doc.moveDown(0.8);
      }
    }

    // ---------------------------------------------------------------- Légende et signature
    ensureSpace(80);
    doc.moveTo(M, doc.y).lineTo(M + width, doc.y).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    doc.moveDown(0.4);
    doc.font('R').fontSize(7.5).fillColor(COLORS.muted).text('↑ / ↓ : valeur hors intervalle de référence · ↑↑ / ↓↓ : valeur critique (communiquée au prescripteur) · * : résultat qualitatif anormal.', M, doc.y, { width });
    doc.moveDown(0.8);
    doc.font('B').fontSize(9).fillColor(COLORS.text).text(`Validé biologiquement par : ${c.validators.join(', ')}`, M, doc.y, { width });
    if (c.lab.directorName) doc.font('R').fontSize(8).fillColor(COLORS.muted).text(`Biologiste responsable du laboratoire : ${c.lab.directorName}`, { width });
    doc.font('R').fontSize(7.5).fillColor(COLORS.muted).text('Document validé et signé électroniquement. Toute modification ultérieure donne lieu à un compte rendu rectificatif.', { width });

    // ---------------------------------------------------------------- Pied de page
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Le pied de page est écrit dans la marge basse : on la neutralise pour éviter un saut de page automatique.
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 45;
      doc.moveTo(M, y - 4).lineTo(M + width, y - 4).strokeColor(COLORS.line).lineWidth(0.5).stroke();
      doc.font('R').fontSize(7).fillColor(COLORS.muted);
      if (c.lab.footer) doc.text(c.lab.footer, M, y, { width: width - 130, height: 18, ellipsis: true, lineBreak: true });
      doc.text(`${c.number} · page ${i + 1}/${range.count}`, M + width - 120, y, { width: 120, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

/** Libellé de la valeur de référence pour l'impression. */
export function referenceText(r: { hasReference: boolean; resultType: string; low: number | null; high: number | null; normalText: string | null; label: string | null }): string {
  if (!r.hasReference) return '—';
  const value = r.resultType === 'NUMERIC' ? formatNumericRange(r.low, r.high) : (r.normalText ?? '—');
  return value;
}
