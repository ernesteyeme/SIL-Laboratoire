// Test de fumée de l'étape 4 (caisse bi-devise CDF/USD + cœur analytique : saisie, interprétation, valeurs critiques,
// validations technique et biologique, comptes rendus PDF, corrections versionnées).
// À lancer APRÈS smoke-test.mjs sur une base de TEST avec le catalogue de démarrage (pnpm db:seed:catalog).
// Usage : node --env-file=.env scripts/smoke-test-step4.mjs [http://localhost:3000/api]
// Attention : crée des données et modifie des paramètres du laboratoire (rétablis à la fin). Jamais en production.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000/api';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'NouveauAdmin#2026';
const SEED_USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'admin';
const RUN = Date.now().toString(36).slice(-5);
let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✔' : '✘'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function raw(method, path, { token, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (res.status === 429 && attempt < 2) {
      console.log('  … limite de débit atteinte, pause de 61 s');
      await sleep(61_000);
      continue;
    }
    return res;
  }
}
async function call(method, path, opts) {
  const res = await raw(method, path, opts);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function login(username, password) {
  const r = await call('POST', '/auth/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`Connexion ${username} impossible : ${JSON.stringify(r.body)}`);
  return r.body.accessToken;
}
// Habilitations par service (1.8.0) : les techniciens/biologistes de test reçoivent tous les services actifs.
async function allSectionIds(adminToken, roles) {
  if (!roles.some((r) => r === 'TECHNICIEN' || r === 'BIOLOGISTE')) return [];
  const s = await call('GET', '/catalog/sections', { token: adminToken });
  return s.body.filter((x) => x.isActive).map((x) => x.id);
}
async function createStaff(adminToken, username, roles) {
  const temp = 'Temp#Smoke2026';
  const finalPw = 'Final#Smoke2026';
  const c = await call('POST', '/users', { token: adminToken, body: { username, fullName: `Test ${username}`, roles, sectionIds: await allSectionIds(adminToken, roles), temporaryPassword: temp } });
  if (c.status !== 201) throw new Error(`Création ${username} : ${JSON.stringify(c.body)}`);
  const t = await login(username, temp);
  const cp = await call('POST', '/auth/change-password', { token: t, body: { currentPassword: temp, newPassword: finalPw, confirmPassword: finalPw } });
  return cp.body.accessToken;
}
const syl = ['ka', 'mbu', 'lu', 'tshi', 'ngo', 'mwa', 'ba', 'ki', 'se', 'zo', 'ny', 'ra', 'fu', 'do'];
const word = () => { const w = Array.from({ length: 4 }, () => syl[Math.floor(Math.random() * syl.length)]).join(''); return w[0].toUpperCase() + w.slice(1); };
const num = (s) => Number(s);

const admin = await login(SEED_USERNAME, ADMIN_PASSWORD);
const reception = await createStaff(admin, `rec4.${RUN}`, ['RECEPTION']);
const caisse = await createStaff(admin, `cai4.${RUN}`, ['CAISSE']);
const tech = await createStaff(admin, `tec4.${RUN}`, ['TECHNICIEN']);
const bio = await createStaff(admin, `bio4.${RUN}`, ['BIOLOGISTE']);
const compta = await createStaff(admin, `cpt4.${RUN}`, ['COMPTABLE']);

const settings0 = (await call('GET', '/settings/lab', { token: admin })).body;
const settingsBody = (patch) => { const { updatedAt, secondaryCurrency, ...rest } = settings0; return { ...rest, ...patch }; };
const base = settings0.currency;
const second = base === 'CDF' ? 'USD' : 'CDF';

// ============================================================================ Bi-devise
console.log('\n— Caisse bi-devise');
const badCurrency = await call('PUT', '/settings/lab', { token: admin, body: { ...settingsBody({ secondaryCurrencyEnabled: true }), currency: 'EUR' } });
check('Bi-devise refusée si la devise de base n’est ni CDF ni USD → 400', badCurrency.status === 400, badCurrency.body);
const enabled = await call('PUT', '/settings/lab', { token: admin, body: settingsBody({ secondaryCurrencyEnabled: true, requirePaymentBeforeCollection: false }) });
check(`Activation de la caisse bi-devise (${base} + ${second})`, enabled.status === 200 && enabled.body.secondaryCurrency === second, enabled.body);

const rateBefore = await call('GET', '/exchange-rates/today', { token: caisse });
check('Le caissier consulte le taux du jour', rateBefore.status === 200, rateBefore.body);
const caisseRate = await call('PUT', '/exchange-rates/today', { token: caisse, body: { cdfPerUsd: '2850' } });
check('Le caissier ne fixe pas le taux → 403', caisseRate.status === 403, caisseRate.body);
const zeroRate = await call('PUT', '/exchange-rates/today', { token: compta, body: { cdfPerUsd: '0' } });
check('Taux nul → 400', zeroRate.status === 400, zeroRate.body);

const patient = (await call('POST', '/patients', { token: reception, body: { lastName: word(), middleName: word(), firstName: word(), sex: 'FEMALE', birthDate: '1985-07-01' } })).body;
const prescriber = (await call('POST', '/prescribers', { token: reception, body: { title: 'Dr', lastName: word(), facility: 'HGR Test' } })).body;
const exams = Object.fromEntries((await call('GET', '/catalog/exams?pageSize=100', { token: reception })).body.items.map((e) => [e.code, e]));
const order = (await call('POST', '/orders', {
  token: reception,
  body: { patientId: patient.id, prescriberId: prescriber.id, clinicalInfo: 'Asthénie, pâleur', examIds: [exams.NFS.id, exams.GLY.id, exams.GE.id, exams.CREA.id] },
})).body;
const due = num(order.invoice.patientAmount);

const opened = await call('POST', '/cash-sessions/open', { token: caisse, body: { openingFloat: '50000', openingFloatSecondary: '20' } });
check(`Ouverture de caisse avec fond en ${base} et en ${second}`, opened.status === 201 && opened.body.secondaryCurrency === second && opened.body.openingFloatSecondary === '20.00', opened.body);

if (!rateBefore.body) {
  const noRate = await call('POST', `/invoices/${order.invoice.id}/payments`, { token: caisse, body: { amount: '5', currency: second, method: 'CASH' } });
  check(`Paiement en ${second} sans taux du jour → 422 RATE_NOT_SET`, noRate.status === 422 && noRate.body.details.rule === 'RATE_NOT_SET', noRate.body);
}
const rate = 2850;
const setRate = await call('PUT', '/exchange-rates/today', { token: compta, body: { cdfPerUsd: String(rate), note: 'Cours BCC du jour' } });
check('Le comptable fixe le taux du jour (1 USD = 2 850 CDF)', setRate.status === 200 && num(setRate.body.cdfPerUsd) === rate, setRate.body);
const eur = await call('POST', `/invoices/${order.invoice.id}/payments`, { token: caisse, body: { amount: '5', currency: 'EUR', method: 'CASH' } });
check('Devise non acceptée → 422 CURRENCY_NOT_ACCEPTED', eur.status === 422 && eur.body.details.rule === 'CURRENCY_NOT_ACCEPTED', eur.body);

// 1er paiement en devise de base, solde en devise secondaire espèces avec rendu de monnaie
const basePart = base === 'CDF' ? 5000 : 2;
const p1 = await call('POST', `/invoices/${order.invoice.id}/payments`, { token: caisse, body: { amount: String(basePart), method: 'CASH' } });
check(`Paiement partiel en ${base}`, p1.status === 201 && p1.body.invoice.status === 'PARTIALLY_PAID', p1.body);
const rest = due - basePart;
const toSecond = (v) => (base === 'CDF' ? v / rate : v * rate);
const toBase = (v) => (base === 'CDF' ? v * rate : v / rate);
const tendered = base === 'CDF' ? Math.ceil(toSecond(rest)) + 1 : Math.ceil(toSecond(rest) / 1000) * 1000 + 1000;
const expectedChange = Math.round((toBase(tendered) - rest) * 100) / 100;
const p2 = await call('POST', `/invoices/${order.invoice.id}/payments`, { token: caisse, body: { amount: String(tendered), currency: second, method: 'CASH' } });
const pay2 = p2.body?.invoice?.payments?.find((p) => p.id === p2.body.paymentId);
check(`Solde réglé en ${second} espèces → PAID`, p2.status === 201 && p2.body.invoice.status === 'PAID', p2.body);
check('Paiement : devise, montant remis, taux figé et monnaie rendue', pay2 && pay2.currency === second && num(pay2.tenderedAmount) === tendered && num(pay2.exchangeRate) === rate && Math.abs(num(pay2.changeAmount) - expectedChange) < 0.01, pay2);
const receipt = await call('GET', `/payments/${p2.body.paymentId}/receipt`, { token: caisse });
check('Reçu : devise remise et taux appliqué', receipt.status === 200 && receipt.body.payment.currency === second && receipt.body.lab.secondaryCurrency === second, receipt.body?.payment);

const current = (await call('GET', '/cash-sessions/current', { token: caisse })).body;
const expBase = 50000 + basePart - expectedChange;
check(`Espèces attendues : ${base} = fond + encaissé − monnaie rendue ; ${second} = fond + encaissé`, Math.abs(num(current.expectedCash) - expBase) < 0.01 && num(current.expectedCashSecondary) === 20 + tendered, current);
check('Totaux par moyen et par devise', current.totals.some((t) => t.method === 'CASH' && t.currency === second && num(t.tendered) === tendered), current.totals);
const noSecond = await call('POST', '/cash-sessions/current/close', { token: caisse, body: { countedCash: String(expBase) } });
check(`Clôture sans comptage ${second} → 422 SECONDARY_COUNT_REQUIRED`, noSecond.status === 422 && noSecond.body.details.rule === 'SECONDARY_COUNT_REQUIRED', noSecond.body);
const gapSecond = await call('POST', '/cash-sessions/current/close', { token: caisse, body: { countedCash: String(expBase), countedCashSecondary: String(20 + tendered - 1) } });
check(`Écart en ${second} sans justification → 422`, gapSecond.status === 422 && gapSecond.body.details.rule === 'CLOSING_NOTE_REQUIRED', gapSecond.body);
const closed = await call('POST', '/cash-sessions/current/close', { token: caisse, body: { countedCash: String(expBase), countedCashSecondary: String(20 + tendered) } });
check('Clôture équilibrée dans les deux devises', closed.status === 200 && num(closed.body.difference) === 0 && num(closed.body.differenceSecondary) === 0, closed.body);

// ============================================================================ Pré-analytique
console.log('\n— Réception → initialisation des résultats');
const s = (code) => order.samples.find((x) => x.examCodes.includes(code));
for (const smp of order.samples) await call('POST', `/samples/${smp.id}/collect`, { token: reception, body: { collectedAt: new Date(Date.now() - 900_000).toISOString() } });
let res0 = (await call('GET', `/results/orders/${order.id}`, { token: tech })).body;
check('Avant réception : examens « En attente d’échantillon », aucun résultat', res0.items.every((i) => i.status === 'AWAITING_SAMPLE' && i.results.length === 0), res0.items.map((i) => i.status));
await call('POST', `/samples/${s('NFS').id}/receive`, { token: tech });
await call('POST', `/samples/${s('GLY').id}/receive`, { token: tech });
await call('POST', `/samples/${s('GE').id}/receive`, { token: tech });
await call('POST', `/samples/${s('CREA').id}/non-conformities`, { token: bio, body: { type: 'TRANSPORT_DELAY', decision: 'ACCEPTED_WITH_RESERVATION', comment: 'Acheminé en 5 h ; interpréter avec prudence' } });

const caisseRead = await call('GET', '/results/worklist', { token: caisse });
check('Le caissier n’accède pas aux paillasses → 403', caisseRead.status === 403, caisseRead.body);
const wl = await call('GET', `/results/worklist?status=TO_ENTER&q=${order.number}&pageSize=50`, { token: tech });
check('Paillasse « À saisir » : les 4 examens de la demande', wl.status === 200 && wl.body.items.filter((i) => i.orderId === order.id).length === 4, wl.body.items?.map((i) => i.examCode));
check('Échéance de rendu calculée, réserve signalée', wl.body.items.every((i) => i.dueAt) && wl.body.items.find((i) => i.examCode === 'CREA')?.hasReservation === true, wl.body.items);
const hemato = wl.body.items.find((i) => i.examCode === 'NFS');
const wlSection = await call('GET', `/results/worklist?q=${order.number}&sectionId=${(await call('GET', `/results/orders/${order.id}`, { token: tech })).body.items.find((i) => i.examCode === 'NFS').section.id}`, { token: tech });
check('Filtre par section (paillasse hématologie)', wlSection.body.items.length === 1 && wlSection.body.items[0].examCode === 'NFS', wlSection.body.items?.map((i) => i.examCode));

let res = (await call('GET', `/results/orders/${order.id}`, { token: tech })).body;
const nfs = res.items.find((i) => i.examCode === 'NFS');
const byCode = (item) => Object.fromEntries(item.results.map((r) => [r.parameterCode, r]));
const nfsR = byCode(nfs);
check('Réception : 4 paramètres NFS instanciés, valeurs de référence figées (femme adulte)', nfs.status === 'TO_ENTER' && nfs.results.length === 4 && nfsR.HB.reference.low === 12 && /Femme/.test(nfsR.HB.reference.label), nfs.results.map((r) => [r.parameterCode, r.reference]));
check('Réserve de dérogation rattachée à la créatinine', res.items.find((i) => i.examCode === 'CREA').reservations.length === 1, res.items.find((i) => i.examCode === 'CREA'));
check('Lecture des résultats par l’accueil (dossier patient) autorisée', (await call('GET', `/results/orders/${order.id}`, { token: reception })).status === 200);

// ============================================================================ Saisie et interprétation
console.log('\n— Saisie, interprétation, valeurs critiques');
const recepSave = await call('PUT', `/results/items/${nfs.id}`, { token: reception, body: { results: [{ resultId: nfsR.HB.id, value: '13' }] } });
check('L’accueil ne saisit pas de résultats → 403', recepSave.status === 403, recepSave.body);
const bad = await call('PUT', `/results/items/${nfs.id}`, { token: tech, body: { results: [{ resultId: nfsR.HB.id, value: '6,2' }, { resultId: nfsR.HT.id, value: 'abc' }] } });
check('Valeur non numérique → 400, rien n’est enregistré, erreur ciblée sur le paramètre', bad.status === 400 && bad.body.details.some((d) => d.path === nfsR.HT.id), bad.body);
const partial = await call('PUT', `/results/items/${nfs.id}`, { token: tech, body: { results: [{ resultId: nfsR.HB.id, value: '6,2' }, { resultId: nfsR.HT.id, value: '21' }] } });
const pr = byCode(partial.body);
check('Hb 6,2 g/dL → critique basse (↓↓) ; Ht 21 % → bas', partial.status === 200 && pr.HB.flag === 'CRITICAL_LOW' && pr.HT.flag === 'LOW' && pr.HB.displayValue === '6,2', partial.body.results);
check('Alerte critique ouverte automatiquement', partial.body.alerts.length === 1 && partial.body.alerts[0].acknowledgedAt === null && partial.body.alerts[0].valueText === '6,2 g/dL', partial.body.alerts);
check('Saisie incomplète → reste « À saisir »', partial.body.status === 'TO_ENTER', partial.body.status);
const incomplete = await call('POST', `/results/items/${nfs.id}/technical-validation`, { token: tech });
check('Validation technique incomplète → 422 RESULTS_INCOMPLETE', incomplete.status === 422 && incomplete.body.details.rule === 'RESULTS_INCOMPLETE', incomplete.body);
const full = await call('PUT', `/results/items/${nfs.id}`, { token: tech, body: { results: [{ resultId: nfsR.GB.id, value: '7,5' }, { resultId: nfsR.PLT.id, value: '>1000', comment: 'Amas plaquettaires au frottis' }] } });
const fr = byCode(full.body);
check('« >1000 » accepté (limite), interprété sur le seuil haut → critique haute', full.status === 200 && fr.PLT.qualifier === '>' && fr.PLT.flag === 'CRITICAL_HIGH', fr.PLT);
check('Tous les paramètres renseignés → « Saisi », 2 alertes ouvertes', full.body.status === 'ENTERED' && full.body.alerts.filter((a) => !a.acknowledgedAt).length === 2, full.body);
const fix = await call('PUT', `/results/items/${nfs.id}`, { token: tech, body: { results: [{ resultId: nfsR.PLT.id, value: '350' }] } });
check('Correction avant communication : l’alerte plaquettes devenue sans objet est retirée', fix.body.alerts.length === 1 && byCode(fix.body).PLT.flag === 'NORMAL', fix.body.alerts);

const tv = await call('POST', `/results/items/${nfs.id}/technical-validation`, { token: tech });
check('Validation technique → « Validé techniquement », valideur tracé', tv.status === 200 && tv.body.status === 'TECHNICAL_VALIDATED' && tv.body.technicalValidatedBy === `Test tec4.${RUN}`, tv.body);
const editAfterTv = await call('PUT', `/results/items/${nfs.id}`, { token: tech, body: { results: [{ resultId: nfsR.HB.id, value: '6,3' }] } });
check('Modification après validation technique → 422', editAfterTv.status === 422 && editAfterTv.body.details.rule === 'ITEM_TECHNICALLY_VALIDATED', editAfterTv.body);
const techBio = await call('POST', `/results/items/${nfs.id}/biological-validation`, { token: tech, body: {} });
check('Le technicien ne valide pas biologiquement → 403', techBio.status === 403, techBio.body);
const notCommunicated = await call('POST', `/results/items/${nfs.id}/biological-validation`, { token: bio, body: {} });
check('Validation biologique avec valeur critique non communiquée → 422 CRITICAL_NOT_COMMUNICATED', notCommunicated.status === 422 && notCommunicated.body.details.rule === 'CRITICAL_NOT_COMMUNICATED', notCommunicated.body);
const alertId = fix.body.alerts[0].id;
const ackShort = await call('POST', `/results/alerts/${alertId}/acknowledge`, { token: tech, body: { notifiedTo: 'Dr' } });
check('Communication sans destinataire identifiable → 400', ackShort.status === 400, ackShort.body);
const ack = await call('POST', `/results/alerts/${alertId}/acknowledge`, { token: tech, body: { notifiedTo: `Dr ${prescriber.lastName} (téléphone)`, note: 'Transfusion envisagée' } });
check('Communication tracée (qui, quand, à qui)', ack.status === 200 && ack.body.alerts[0].acknowledgedBy === `Test tec4.${RUN}` && ack.body.alerts[0].notifiedTo.includes(prescriber.lastName), ack.body.alerts);
const ack2 = await call('POST', `/results/alerts/${alertId}/acknowledge`, { token: tech, body: { notifiedTo: 'Quelqu’un d’autre' } });
check('Double communication → 422', ack2.status === 422 && ack2.body.details.rule === 'ALERT_ALREADY_ACKNOWLEDGED', ack2.body);

console.log('\n— Validation biologique et comptes rendus');
const returned = await call('POST', `/results/items/${nfs.id}/return`, { token: bio, body: { reason: 'Contrôler la numération plaquettaire au frottis' } });
check('Renvoi en saisie par le biologiste → « Saisi »', returned.status === 200 && returned.body.status === 'ENTERED' && returned.body.technicalValidatedAt === null, returned.body.status);
await call('POST', `/results/items/${nfs.id}/technical-validation`, { token: tech });
const bv = await call('POST', `/results/items/${nfs.id}/biological-validation`, { token: bio, body: { comment: 'Anémie sévère : contrôle recommandé.' } });
check('Validation biologique NFS → « Validé »', bv.status === 200 && bv.body.status === 'VALIDATED' && bv.body.validatedBy === `Test bio4.${RUN}`, bv.body);
res = (await call('GET', `/results/orders/${order.id}`, { token: bio })).body;
check('Demande « Partiellement validée », aucun compte rendu automatique', res.order.status === 'PARTIALLY_VALIDATED' && res.reports.length === 0, [res.order.status, res.reports]);
const techPartial = await call('POST', `/reports/orders/${order.id}/partial`, { token: tech });
check('Le technicien n’émet pas de compte rendu → 403', techPartial.status === 403, techPartial.body);
const partialRep = await call('POST', `/reports/orders/${order.id}/partial`, { token: bio });
check('Compte rendu partiel CR-AAAA-NNNNNN (NFS seulement)', partialRep.status === 201 && /^CR-\d{4}-\d{6}$/.test(partialRep.body.number) && partialRep.body.kind === 'PARTIAL' && partialRep.body.examCodes.join() === 'NFS', partialRep.body);

const fillAndValidate = async (code, values) => {
  const item = res.items.find((i) => i.examCode === code);
  const saved = await call('PUT', `/results/items/${item.id}`, { token: tech, body: { results: item.results.map((r) => ({ resultId: r.id, value: values[r.parameterCode] })) } });
  await call('POST', `/results/items/${item.id}/technical-validation`, { token: tech });
  const v = await call('POST', `/results/items/${item.id}/biological-validation`, { token: bio, body: {} });
  return { saved: saved.body, validated: v };
};
const ge = await fillAndValidate('GE', { GE: 'positive' });
check('Qualitatif : saisie insensible à la casse, « Positive » ≠ « Négative » → anormal (*)', ge.saved.results[0].textValue === 'Positive' && ge.saved.results[0].flag === 'ABNORMAL', ge.saved.results);
const geBad = await call('PUT', `/results/items/${ge.saved.id}`, { token: tech, body: { results: [{ resultId: ge.saved.results[0].id, value: 'Peut-être' }] } });
check('Modification d’un examen validé → 422 ITEM_VALIDATED', geBad.status === 422 && geBad.body.details.rule === 'ITEM_VALIDATED', geBad.body);
await fillAndValidate('GLY', { GLY: '0,95' });
const crea = await fillAndValidate('CREA', { CREA: '8' });
check('Dernier examen validé', crea.validated.status === 200, crea.validated.body);

res = (await call('GET', `/results/orders/${order.id}`, { token: bio })).body;
const finalRep = res.reports.find((r) => r.kind === 'FINAL');
check('Tous validés → demande « Validée », compte rendu définitif émis automatiquement', res.order.status === 'VALIDATED' && !!finalRep && finalRep.examCodes.length === 4 && finalRep.version === 2, [res.order.status, res.reports]);
check('Le définitif remplace le partiel', finalRep?.supersedesNumber === partialRep.body.number, finalRep);
const allValidatedPartial = await call('POST', `/reports/orders/${order.id}/partial`, { token: bio });
check('Partiel alors que tout est validé → 422', allValidatedPartial.status === 422 && allValidatedPartial.body.details.rule === 'ALL_VALIDATED', allValidatedPartial.body);

const pdfRes = await raw('GET', `/reports/${finalRep.id}/pdf`, { token: reception });
const pdf = Buffer.from(await pdfRes.arrayBuffer());
const sha = createHash('sha256').update(pdf).digest('hex');
check('PDF servi (application/pdf, %PDF)', pdfRes.status === 200 && pdfRes.headers.get('content-type') === 'application/pdf' && pdf.subarray(0, 4).toString() === '%PDF', pdfRes.status);
check('Empreinte SHA-256 du PDF = empreinte archivée', sha === finalRep.sha256 && pdfRes.headers.get('x-content-sha256') === sha, { sha, stored: finalRep.sha256 });
writeFileSync(`/tmp/${finalRep.number}.pdf`, pdf);
const comptaPdf = await raw('GET', `/reports/${finalRep.id}/pdf`, { token: compta });
check('Le comptable n’accède pas aux comptes rendus → 403', comptaPdf.status === 403);

// ============================================================================ Correction versionnée
console.log('\n— Correction après validation');
const glyItem = res.items.find((i) => i.examCode === 'GLY');
const techAmend = await call('POST', `/results/items/${glyItem.id}/amend`, { token: tech, body: { reason: 'Erreur de transcription' } });
check('Correction par un technicien → 403', techAmend.status === 403, techAmend.body);
const noReason = await call('POST', `/results/items/${glyItem.id}/amend`, { token: bio, body: { reason: '' } });
check('Correction sans motif → 400', noReason.status === 400, noReason.body);
const amended = await call('POST', `/results/items/${glyItem.id}/amend`, { token: bio, body: { reason: 'Inversion de tubes à la paillasse biochimie' } });
check('Correction → version 2, retour en saisie, historique conservé', amended.status === 200 && amended.body.version === 2 && amended.body.status === 'ENTERED' && amended.body.amendments[0]?.fromVersion === 1, amended.body);
const mid = (await call('GET', `/results/orders/${order.id}`, { token: bio })).body;
check('Demande repasse en « Partiellement validée »', mid.order.status === 'PARTIALLY_VALIDATED', mid.order.status);
await call('PUT', `/results/items/${glyItem.id}`, { token: tech, body: { results: [{ resultId: glyItem.results[0].id, value: '0,35' }] } });
const glyCrit = (await call('GET', `/results/orders/${order.id}`, { token: tech })).body.items.find((i) => i.id === glyItem.id);
check('Nouvelle valeur 0,35 g/L → critique, nouvelle alerte', glyCrit.results[0].flag === 'CRITICAL_LOW' && glyCrit.alerts.some((a) => !a.acknowledgedAt), glyCrit.alerts);
await call('POST', `/results/alerts/${glyCrit.alerts.find((a) => !a.acknowledgedAt).id}/acknowledge`, { token: bio, body: { notifiedTo: `Dr ${prescriber.lastName}, service des urgences` } });
await call('POST', `/results/items/${glyItem.id}/technical-validation`, { token: tech });
await call('POST', `/results/items/${glyItem.id}/biological-validation`, { token: bio, body: {} });
const end = (await call('GET', `/results/orders/${order.id}`, { token: bio })).body;
const amendedRep = end.reports.find((r) => r.kind === 'AMENDED');
check('Compte rendu rectificatif v3, remplace le définitif', !!amendedRep && amendedRep.version === 3 && amendedRep.supersedesNumber === finalRep.number, end.reports);
const pdf3 = Buffer.from(await (await raw('GET', `/reports/${amendedRep.id}/pdf`, { token: bio })).arrayBuffer());
writeFileSync(`/tmp/${amendedRep.number}.pdf`, pdf3);
const pdfAgain = Buffer.from(await (await raw('GET', `/reports/${finalRep.id}/pdf`, { token: bio })).arrayBuffer());
check('Le compte rendu définitif archivé reste identique', createHash('sha256').update(pdfAgain).digest('hex') === finalRep.sha256);

// ============================================================================ Antériorité et refus tardif
console.log('\n— Antériorité, refus après saisie');
const order2 = (await call('POST', '/orders', { token: reception, body: { patientId: patient.id, examIds: [exams.NFS.id] } })).body;
await call('POST', `/samples/${order2.samples[0].id}/collect`, { token: reception, body: {} });
await call('POST', `/samples/${order2.samples[0].id}/receive`, { token: tech });
const r2 = (await call('GET', `/results/orders/${order2.id}`, { token: tech })).body;
const hb2 = r2.items[0].results.find((r) => r.parameterCode === 'HB');
check('Nouvelle demande : antériorité Hb 6,2 (↓↓) affichée', hb2.previous?.displayValue === '6,2' && hb2.previous.flag === 'CRITICAL_LOW', hb2.previous);
await call('PUT', `/results/items/${r2.items[0].id}`, { token: tech, body: { results: [{ resultId: hb2.id, value: '9,1' }] } });
const lateReject = await call('POST', `/samples/${order2.samples[0].id}/non-conformities`, { token: tech, body: { type: 'CLOTTED', decision: 'REJECTED' } });
check('Refus d’un échantillon dont des résultats sont saisis → 422 SAMPLE_HAS_RESULTS', lateReject.status === 422 && lateReject.body.details.rule === 'SAMPLE_HAS_RESULTS', lateReject.body);

const audit = await call('GET', '/audit?entity=CriticalAlert&pageSize=20', { token: admin });
check('Alertes critiques tracées dans l’audit (détection + communication)', audit.body.items.filter((a) => a.action === 'UPDATE').length >= 1 && audit.body.items.some((a) => a.action === 'CREATE'), audit.body.items.map((a) => a.action));
const auditRep = await call('GET', '/audit?entity=Report&pageSize=5', { token: admin });
check('Émission des comptes rendus tracée avec empreinte', auditRep.body.items.some((a) => a.after?.sha256 === amendedRep.sha256), auditRep.body.items.map((a) => a.reason));
const verify = await call('GET', '/audit/verify', { token: admin });
check('Chaîne d’audit intègre', verify.body.valid === true, verify.body);

await call('PUT', '/settings/lab', { token: admin, body: settingsBody({}) });
console.log(`\nPDF écrits : /tmp/${finalRep.number}.pdf, /tmp/${amendedRep.number}.pdf`);
console.log(failures === 0 ? '\nTOUS LES CONTRÔLES SONT PASSÉS' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
