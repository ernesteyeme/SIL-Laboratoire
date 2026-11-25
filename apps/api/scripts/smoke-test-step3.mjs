// Test de fumée de l'étape 3 (demandes, échantillons, facturation, caisse).
// À lancer APRÈS smoke-test.mjs sur une base de TEST avec le catalogue de démarrage (pnpm db:seed:catalog).
// Usage : node --env-file=.env scripts/smoke-test-step3.mjs [http://localhost:3000/api]
// Attention : crée des données et modifie un paramètre du laboratoire (rétabli à la fin). Jamais en production.
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

async function call(method, path, { token, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    // Limite de 10 connexions/minute : on patiente puis on réessaie (scénario avec beaucoup de comptes).
    if (res.status === 429 && attempt < 2) {
      console.log('  … limite de débit atteinte, pause de 61 s');
      await sleep(61_000);
      continue;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
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
const reception = await createStaff(admin, `rec3.${RUN}`, ['RECEPTION']);
const caisse = await createStaff(admin, `cai3.${RUN}`, ['CAISSE']);
const tech = await createStaff(admin, `tec3.${RUN}`, ['TECHNICIEN']);
const bio = await createStaff(admin, `bio3.${RUN}`, ['BIOLOGISTE']);
const compta = await createStaff(admin, `cpt3.${RUN}`, ['COMPTABLE']);

const settings0 = (await call('GET', '/settings/lab', { token: admin })).body;
// Étape 3 : caisse mono-devise (la bi-devise est couverte par smoke-test-step4.mjs). secondaryCurrency est en lecture seule.
const settingsBody = (patch) => { const { updatedAt, secondaryCurrency, ...rest } = settings0; return { ...rest, secondaryCurrencyEnabled: false, ...patch }; };
const restoreSettings = () => { const { updatedAt, secondaryCurrency, ...rest } = settings0; return call('PUT', '/settings/lab', { token: admin, body: rest }); };
await call('PUT', '/settings/lab', { token: admin, body: settingsBody({ requirePaymentBeforeCollection: false }) });

const patient = (await call('POST', '/patients', { token: reception, body: { lastName: word(), middleName: word(), firstName: word(), sex: 'FEMALE', birthDate: '1985-07-01' } })).body;
const prescriber = (await call('POST', '/prescribers', { token: reception, body: { title: 'Dr', lastName: word(), facility: 'CS Test' } })).body;
const exams = Object.fromEntries((await call('GET', '/catalog/exams?pageSize=100', { token: reception })).body.items.map((e) => [e.code, e]));

// ---------------------------------------------------------------- Demande
console.log('\n— Demande');
const noExam = await call('POST', '/orders', { token: reception, body: { patientId: patient.id, examIds: [] } });
check('Demande sans examen → 400', noExam.status === 400, noExam.body);
const noPayer = await call('POST', '/orders', { token: reception, body: { patientId: patient.id, examIds: [exams.NFS.id], coveragePercent: 50 } });
check('Prise en charge sans organisme payeur → 400', noPayer.status === 400 && noPayer.body.details.some((d) => d.path === 'payerName'), noPayer.body);

const lastOrders = await call('GET', '/orders?pageSize=1', { token: reception });
const lastNumber = lastOrders.body.items[0]?.number;
const unknownExam = await call('POST', '/orders', { token: reception, body: { patientId: patient.id, examIds: [exams.NFS.id, '11111111-1111-4111-8111-111111111111'] } });
check('Examen inexistant → 422 EXAM_UNAVAILABLE', unknownExam.status === 422 && unknownExam.body.details.rule === 'EXAM_UNAVAILABLE', unknownExam.body);

const orderBody = {
  patientId: patient.id,
  prescriberId: prescriber.id,
  priority: 'ROUTINE',
  clinicalInfo: 'Fièvre depuis 3 jours, sous ARV',
  examIds: [exams.NFS.id, exams.CD4.id, exams.GLY.id, exams.CREA.id],
  payerName: 'Mutuelle Test',
  coveragePercent: 50,
};
const created = await call('POST', '/orders', { token: reception, body: orderBody });
const order = created.body;
check('Création de la demande → 201, n° DEM-AAAA-NNNNNN', created.status === 201 && /^DEM-\d{4}-\d{6}$/.test(order.number), created.body);
if (lastNumber) {
  const prev = Number(lastNumber.slice(-6));
  check('Numérotation sans trou : l’échec précédent n’a pas consommé de numéro', Number(order.number.slice(-6)) === prev + 1, { lastNumber, now: order.number });
}
check('Un échantillon par type : 3 échantillons pour 4 examens (NFS + CD4 sur le même tube EDTA)', order.samples.length === 3 && order.samples.find((s) => s.examCodes.includes('NFS'))?.examCodes.join() === 'CD4,NFS', order.samples.map((s) => s.examCodes));
check('N° d’échantillon AAMMJJ + rang', order.samples.every((s) => /^\d{10}$/.test(s.number)), order.samples.map((s) => s.number));
const expectedTotal = ['NFS', 'CD4', 'GLY', 'CREA'].reduce((a, c) => a + num(exams[c].price), 0);
check('Tarifs figés dans la demande', order.items.every((i) => i.unitPrice === exams[i.examCode].price), order.items);
check('Facture créée : part patient = 50 % du total', order.invoice && num(order.invoice.patientAmount) === expectedTotal / 2 && order.invoice.status === 'UNPAID', order.invoice);
const search = await call('GET', `/orders?q=${order.samples[0].number}`, { token: tech });
check('Recherche d’une demande par n° d’échantillon', search.body.items.some((o) => o.id === order.id), search.body.total);

const sNFS = order.samples.find((s) => s.examCodes.includes('NFS'));
const sGLY = order.samples.find((s) => s.examCodes.includes('GLY'));
const sCREA = order.samples.find((s) => s.examCodes.includes('CREA'));

// ---------------------------------------------------------------- Prélèvement
console.log('\n— Prélèvement');
const comptaCollect = await call('POST', `/samples/${sNFS.id}/collect`, { token: compta, body: {} });
check('Comptable ne prélève pas → 403', comptaCollect.status === 403, comptaCollect.body);
const future = await call('POST', `/samples/${sNFS.id}/collect`, { token: reception, body: { collectedAt: new Date(Date.now() + 3600_000).toISOString() } });
check('Heure de prélèvement future → 400', future.status === 400, future.body);
const c1 = await call('POST', `/samples/${sNFS.id}/collect`, { token: reception, body: { collectedAt: new Date(Date.now() - 600_000).toISOString() } });
check('Prélèvement NFS → COLLECTED, préleveur tracé', c1.status === 200 && c1.body.status === 'COLLECTED' && c1.body.collectedBy === `Test rec3.${RUN}`, c1.body);
check('Statut de la demande → prélèvement partiel', c1.body.order.status === 'PARTIALLY_COLLECTED', c1.body.order);
const c1bis = await call('POST', `/samples/${sNFS.id}/collect`, { token: reception, body: {} });
check('Double prélèvement → 422', c1bis.status === 422, c1bis.body);

await call('PUT', '/settings/lab', { token: admin, body: settingsBody({ requirePaymentBeforeCollection: true }) });
const unpaid = await call('POST', `/samples/${sGLY.id}/collect`, { token: reception, body: {} });
check('Paiement préalable exigé (paramètre) → 422 PAYMENT_REQUIRED', unpaid.status === 422 && unpaid.body.details.rule === 'PAYMENT_REQUIRED', unpaid.body);

// ---------------------------------------------------------------- Caisse
console.log('\n— Caisse');
const invoiceId = order.invoice.id;
const noSession = await call('POST', `/invoices/${invoiceId}/payments`, { token: caisse, body: { amount: '1000', method: 'CASH' } });
check('Encaissement sans session ouverte → 422 NO_OPEN_CASH_SESSION', noSession.status === 422 && noSession.body.details.rule === 'NO_OPEN_CASH_SESSION', noSession.body);
const opened = await call('POST', '/cash-sessions/open', { token: caisse, body: { openingFloat: '50000' } });
check('Ouverture de caisse → 201, n° CS-AAAA-NNNN', opened.status === 201 && /^CS-\d{4}-\d{4}$/.test(opened.body.number) && opened.body.expectedCash === '50000.00', opened.body);
const openedTwice = await call('POST', '/cash-sessions/open', { token: caisse, body: { openingFloat: '0' } });
check('Seconde session ouverte → 422', openedTwice.status === 422, openedTwice.body);

const bigDiscount = await call('POST', `/invoices/${invoiceId}/discount`, { token: caisse, body: { discountAmount: String(expectedTotal * 0.3), reason: 'Patient indigent' } });
check('Remise > 20 % par un caissier → 403', bigDiscount.status === 403 && bigDiscount.body.details.rule === 'DISCOUNT_ADMIN_ONLY', bigDiscount.body);
const discountAmount = expectedTotal * 0.1;
const disc = await call('POST', `/invoices/${invoiceId}/discount`, { token: caisse, body: { discountAmount: String(discountAmount), reason: 'Personnel de santé' } });
const patientDue = (expectedTotal - discountAmount) / 2;
check('Remise de 10 % → part patient recalculée', disc.status === 200 && num(disc.body.patientAmount) === patientDue && num(disc.body.thirdPartyAmount) === patientDue, disc.body);

const over = await call('POST', `/invoices/${invoiceId}/payments`, { token: caisse, body: { amount: String(patientDue + 1), method: 'MOBILE_MONEY', reference: `OVER${RUN}` } });
check('Trop-perçu hors espèces refusé → 422 AMOUNT_EXCEEDS_BALANCE', over.status === 422 && over.body.details.rule === 'AMOUNT_EXCEEDS_BALANCE', over.body);
const cashPart = 10000;
const pay1 = await call('POST', `/invoices/${invoiceId}/payments`, { token: caisse, body: { amount: String(cashPart), method: 'CASH' } });
check('Paiement partiel espèces → PARTIALLY_PAID', pay1.status === 201 && pay1.body.invoice.status === 'PARTIALLY_PAID' && num(pay1.body.invoice.balance) === patientDue - cashPart, pay1.body);
check('Reçu numéroté REC-AAAA-NNNNNN', /^REC-\d{4}-\d{6}$/.test(pay1.body.invoice.payments[0]?.number), pay1.body.invoice.payments);
const noRef = await call('POST', `/invoices/${invoiceId}/payments`, { token: caisse, body: { amount: '100', method: 'MOBILE_MONEY' } });
check('Mobile money sans référence → 400', noRef.status === 400, noRef.body);
const pay2 = await call('POST', `/invoices/${invoiceId}/payments`, { token: caisse, body: { amount: String(patientDue - cashPart), method: 'MOBILE_MONEY', reference: `MP${RUN}` } });
check('Solde réglé par mobile money → PAID', pay2.status === 201 && pay2.body.invoice.status === 'PAID' && pay2.body.invoice.balance === '0.00', pay2.body.invoice);
const receipt = await call('GET', `/payments/${pay2.body.paymentId}/receipt`, { token: compta });
check('Reçu imprimable (comptable) → 200 avec en-tête du laboratoire', receipt.status === 200 && receipt.body.lab.name === settings0.name && receipt.body.payment.reference === `MP${RUN}`, receipt.body?.payment);
const comptaPay = await call('POST', `/invoices/${invoiceId}/payments`, { token: compta, body: { amount: '1', method: 'CASH' } });
check('Comptable n’encaisse pas → 403', comptaPay.status === 403, comptaPay.body);

const c2 = await call('POST', `/samples/${sGLY.id}/collect`, { token: reception, body: {} });
const c3 = await call('POST', `/samples/${sCREA.id}/collect`, { token: tech, body: {} });
check('Après paiement : prélèvements autorisés → demande « Prélevée »', c2.status === 200 && c3.status === 200 && c3.body.order.status === 'COLLECTED', [c2.body, c3.body.order]);
await call('PUT', '/settings/lab', { token: admin, body: settingsBody({ requirePaymentBeforeCollection: false }) });

// ---------------------------------------------------------------- Réception au laboratoire
console.log('\n— Réception et non-conformités');
const scan = await call('GET', `/samples/by-number/${sNFS.number}`, { token: tech });
check('Lecture du code-barres → contexte patient + demande', scan.status === 200 && scan.body.patient.id === patient.id && scan.body.order.number === order.number, scan.body);
const recRecep = await call('POST', `/samples/${sNFS.id}/receive`, { token: reception });
check('Réception au labo par l’accueil → 403', recRecep.status === 403, recRecep.body);
const rec1 = await call('POST', `/samples/${sNFS.id}/receive`, { token: tech });
check('Réception conforme → RECEIVED, réceptionnaire tracé', rec1.status === 200 && rec1.body.status === 'RECEIVED' && rec1.body.receivedBy === `Test tec3.${RUN}`, rec1.body);
const derogTech = await call('POST', `/samples/${sGLY.id}/non-conformities`, { token: tech, body: { type: 'HEMOLYZED', decision: 'ACCEPTED_WITH_RESERVATION', comment: 'Hémolyse légère' } });
check('Dérogation par un technicien → 403', derogTech.status === 403 && derogTech.body.details.rule === 'DEROGATION_BIOLOGIST_ONLY', derogTech.body);
const reject = await call('POST', `/samples/${sGLY.id}/non-conformities`, { token: tech, body: { type: 'HEMOLYZED', decision: 'REJECTED' } });
check('Refus pour hémolyse → REJECTED, non-conformité enregistrée', reject.status === 201 && reject.body.status === 'REJECTED' && reject.body.nonConformities[0]?.type === 'HEMOLYZED', reject.body);
check('Demande repasse en « prélèvement partiel »', reject.body.order.status === 'PARTIALLY_COLLECTED', reject.body.order);
const derogNoComment = await call('POST', `/samples/${sCREA.id}/non-conformities`, { token: bio, body: { type: 'TRANSPORT_DELAY', decision: 'ACCEPTED_WITH_RESERVATION' } });
check('Dérogation sans justification → 400', derogNoComment.status === 400, derogNoComment.body);
const derog = await call('POST', `/samples/${sCREA.id}/non-conformities`, { token: bio, body: { type: 'TRANSPORT_DELAY', decision: 'ACCEPTED_WITH_RESERVATION', comment: 'Acheminé en 5 h au lieu de 4 h ; résultat à interpréter avec prudence' } });
check('Dérogation par le biologiste → RECEIVED avec réserve', derog.status === 201 && derog.body.status === 'RECEIVED' && derog.body.hasReservation === true, derog.body);

const recollectRecv = await call('POST', `/samples/${sNFS.id}/recollect`, { token: reception, body: { reason: 'Test' } });
check('Nouveau prélèvement d’un échantillon non refusé → 400/422', recollectRecv.status === 400 || recollectRecv.status === 422, recollectRecv.body);
const recollect = await call('POST', `/samples/${sGLY.id}/recollect`, { token: reception, body: { reason: 'Hémolyse, patient rappelé' } });
check('Nouveau prélèvement → nouvel échantillon, examens transférés', recollect.status === 201 && recollect.body.number !== sGLY.number && recollect.body.replacesNumber === sGLY.number && recollect.body.examCodes.join() === 'GLY', recollect.body);
const recollectTwice = await call('POST', `/samples/${sGLY.id}/recollect`, { token: reception, body: { reason: 'Encore une fois' } });
check('Double demande de nouveau prélèvement → 422', recollectTwice.status === 422, recollectTwice.body);
await call('POST', `/samples/${recollect.body.id}/collect`, { token: reception, body: {} });
const finalRec = await call('POST', `/samples/${recollect.body.id}/receive`, { token: tech });
check('Nouvel échantillon reçu → demande « Reçue au laboratoire »', finalRec.body.order.status === 'RECEIVED', finalRec.body.order);
const detail = await call('GET', `/orders/${order.id}`, { token: reception });
check('Historique : l’échantillon refusé est conservé et lié à son remplaçant', detail.body.samples.length === 4 && detail.body.samples.find((s) => s.id === sGLY.id)?.replacedByNumber === recollect.body.number, detail.body.samples);
const cancelReceived = await call('POST', `/orders/${order.id}/cancel`, { token: reception, body: { reason: 'Erreur de patient' } });
check('Annulation d’une demande déjà reçue → 422', cancelReceived.status === 422 && cancelReceived.body.details.rule === 'ORDER_ALREADY_RECEIVED', cancelReceived.body);

const worklist = await call('GET', '/samples?status=REJECTED', { token: tech });
check('Liste « refusés à traiter » : n’inclut pas un refusé déjà remplacé', !worklist.body.items.some((s) => s.id === sGLY.id), worklist.body.items.map((s) => s.number));

// ---------------------------------------------------------------- Annulation avec paiement
console.log('\n— Annulation');
const order2 = (await call('POST', '/orders', { token: reception, body: { patientId: patient.id, examIds: [exams.GE.id] } })).body;
const pay3 = await call('POST', `/invoices/${order2.invoice.id}/payments`, { token: caisse, body: { amount: exams.GE.price, method: 'CASH' } });
const cancelPaid = await call('POST', `/orders/${order2.id}/cancel`, { token: reception, body: { reason: 'Patient reparti' } });
check('Annulation d’une demande payée → 422 ORDER_HAS_PAYMENTS', cancelPaid.status === 422 && cancelPaid.body.details.rule === 'ORDER_HAS_PAYMENTS', cancelPaid.body);
const caisseCancelPay = await call('POST', `/payments/${pay3.body.paymentId}/cancel`, { token: caisse, body: { reason: 'Erreur' } });
check('Annulation de paiement par le caissier → 403', caisseCancelPay.status === 403, caisseCancelPay.body);
const adminCancelPay = await call('POST', `/payments/${pay3.body.paymentId}/cancel`, { token: admin, body: { reason: 'Patient reparti avant prélèvement, remboursé' } });
check('Annulation de paiement par l’admin (session ouverte) → facture non payée', adminCancelPay.status === 200 && adminCancelPay.body.status === 'UNPAID', adminCancelPay.body);
const cancel2 = await call('POST', `/orders/${order2.id}/cancel`, { token: reception, body: { reason: 'Patient reparti' } });
check('Annulation de la demande → CANCELLED, facture annulée', cancel2.status === 200 && cancel2.body.status === 'CANCELLED' && cancel2.body.invoice.status === 'CANCELLED', cancel2.body);
const payCancelled = await call('POST', `/invoices/${order2.invoice.id}/payments`, { token: caisse, body: { amount: '1', method: 'CASH' } });
check('Paiement d’une facture annulée → 422', payCancelled.status === 422, payCancelled.body);
const collectCancelled = await call('POST', `/samples/${order2.samples[0].id}/collect`, { token: reception, body: {} });
check('Prélèvement sur demande annulée → 422', collectCancelled.status === 422, collectCancelled.body);

// ---------------------------------------------------------------- Clôture
console.log('\n— Clôture de caisse');
const current = await call('GET', '/cash-sessions/current', { token: caisse });
const expectedCash = 50000 + cashPart;
check('Espèces attendues = fond + espèces (paiement annulé exclu)', num(current.body.expectedCash) === expectedCash && current.body.cancelledCount === 1, current.body);
check('Totaux par moyen de paiement', current.body.totals.find((t) => t.method === 'MOBILE_MONEY')?.applied === (patientDue - cashPart).toFixed(2), current.body.totals);
const badClose = await call('POST', '/cash-sessions/current/close', { token: caisse, body: { countedCash: String(expectedCash - 500) } });
check('Écart de caisse sans justification → 422', badClose.status === 422 && badClose.body.details.rule === 'CLOSING_NOTE_REQUIRED', badClose.body);
const closed = await call('POST', '/cash-sessions/current/close', { token: caisse, body: { countedCash: String(expectedCash - 500), note: 'Billet de 500 manquant, signalé au responsable' } });
check('Clôture avec écart justifié → CLOSED, écart −500', closed.status === 200 && closed.body.status === 'CLOSED' && closed.body.difference === '-500.00', closed.body);
const afterClose = await call('POST', `/invoices/${invoiceId}/payments`, { token: caisse, body: { amount: '1', method: 'CASH' } });
check('Encaissement après clôture → 422', afterClose.status === 422, afterClose.body);
const cancelClosed = await call('POST', `/payments/${pay1.body.paymentId}/cancel`, { token: admin, body: { reason: 'Test après clôture' } });
check('Annulation d’un paiement d’une session clôturée → 422', cancelClosed.status === 422 && cancelClosed.body.details.rule === 'CASH_SESSION_CLOSED', cancelClosed.body);

const report = await call('GET', `/cash-sessions/${closed.body.id}`, { token: compta });
check('Rapport de session (comptable) avec le détail des paiements', report.status === 200 && report.body.payments.length === 3, report.body?.payments?.length);
const caisseList = await call('GET', '/cash-sessions', { token: caisse });
check('Un caissier ne voit que ses sessions', caisseList.body.items.every((s) => s.cashier.fullName === `Test cai3.${RUN}`), caisseList.body.items.map((s) => s.cashier.fullName));
const otherReport = await call('GET', `/cash-sessions/${closed.body.id}`, { token: await (async () => { const t = await createStaff(admin, `cai4.${RUN}`, ['CAISSE']); return t; })() });
check('Rapport de la session d’un autre caissier → 403', otherReport.status === 403, otherReport.body);

const audit = await call('GET', `/audit?entity=Payment&pageSize=10`, { token: admin });
check('Paiements tracés dans l’audit', audit.body.items.some((a) => a.action === 'DELETE' && a.reason.includes('remboursé')), audit.body.items.map((a) => a.action));
const verify = await call('GET', '/audit/verify', { token: admin });
check('Chaîne d’audit intègre', verify.body.valid === true, verify.body);

await restoreSettings();
console.log(failures === 0 ? '\nTOUS LES CONTRÔLES SONT PASSÉS' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
