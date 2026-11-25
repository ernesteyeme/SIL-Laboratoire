// Test de fumée de l'étape 6 (interfaçage des automates) : configuration, clé de connecteur, messages ASTM / HL7 / CSV,
// appariement, conflits, examens validés, CIQ transmis par l'automate, liste de travail, retransmissions.
// À lancer APRÈS smoke-test.mjs sur une base de TEST avec le catalogue de démarrage (pnpm db:seed:catalog).
// Usage : node --env-file=.env scripts/smoke-test-step6.mjs [http://localhost:3000/api]
// Attention : crée des données (automates et lots de test désactivés en fin de test). Jamais en production.

const BASE = process.argv[2] ?? 'http://localhost:3000/api';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'NouveauAdmin#2026';
const SEED_USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'admin';
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✔' : '✘'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rule = (r) => r.body?.details?.rule;

async function call(method, path, { token, key, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (key) headers['X-Instrument-Key'] = key;
    const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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

// --- ASTM E1381 : trames comme les émet un automate (n° de trame, ETX, somme de contrôle, CR LF)
const checksum = (s) => (Buffer.from(s, 'latin1').reduce((a, b) => (a + b) % 256, 0)).toString(16).toUpperCase().padStart(2, '0');
const astmFrames = (records) => records.map((r, i) => { const body = `${(i + 1) % 8}${r}\r\x03`; return `\x02${body}${checksum(body)}\r\n`; }).join('');
// Horloge de l'automate réglée à l'heure locale du laboratoire (AAAAMMJJHHMMSS)
const LAB_TZ = process.env.LAB_TIMEZONE ?? 'Africa/Kinshasa';
const ts = (d = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: LAB_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
};
const astmMessage = (blocks) => {
  const recs = [`H|\\^&|||XN-1000^SIM^${RUN}|||||||P|LIS2-A2|${ts()}`];
  blocks.forEach((b, i) => {
    recs.push(`P|${i + 1}`);
    recs.push(`O|1|${b.specimen}^01||^^^NFS|R||${ts()}||||N||||||||||||||F`);
    b.results.forEach((r, j) => recs.push(`R|${j + 1}|^^^${r.code}^1|${r.value}|${r.unit ?? ''}||${r.flag ?? 'N'}||${r.status ?? 'F'}||||${ts()}`));
  });
  recs.push('L|1|N');
  return astmFrames(recs);
};

const admin = await login(SEED_USERNAME, ADMIN_PASSWORD);
const bio = await createStaff(admin, `bio6.${RUN.toLowerCase()}`, ['BIOLOGISTE']);
const tech = await createStaff(admin, `tec6.${RUN.toLowerCase()}`, ['TECHNICIEN']);
const recep = await createStaff(admin, `rec6.${RUN.toLowerCase()}`, ['RECEPTION', 'CAISSE']);

const settings0 = (await call('GET', '/settings/lab', { token: admin })).body;
const { updatedAt: _u, secondaryCurrency: _s, ...settingsRest } = settings0;
await call('PUT', '/settings/lab', { token: admin, body: { ...settingsRest, requirePaymentBeforeCollection: false } });

const exams = Object.fromEntries((await call('GET', '/catalog/exams?pageSize=100', { token: bio })).body.items.map((e) => [e.code, e]));
const nfsExam = (await call('GET', `/catalog/exams/${exams.NFS.id}`, { token: bio })).body;
const glyExam = (await call('GET', `/catalog/exams/${exams.GLY.id}`, { token: bio })).body;
const geExam = (await call('GET', `/catalog/exams/${exams.GE.id}`, { token: bio })).body;
const P = Object.fromEntries(nfsExam.parameters.map((p) => [p.code, p]));
const glyParam = glyExam.parameters[0];
const geParam = geExam.parameters[0];

// ============================================================================ Configuration
console.log('\n— Déclaration d’un automate');
const code = `XN${RUN}`;
const body = { code: code.toLowerCase(), name: `Sysmex XN-1000 (${RUN})`, manufacturer: 'Sysmex', model: 'XN-1000', sectionId: nfsExam.section.id, protocol: 'ASTM' };
const techCreate = await call('POST', '/instruments', { token: tech, body });
check('Le technicien ne déclare pas d’automate → 403', techCreate.status === 403, techCreate.body);
const csvNoConfig = await call('POST', '/instruments', { token: bio, body: { ...body, code: `CSV${RUN}`, protocol: 'CSV' } });
check('Automate CSV sans description des colonnes → 400', csvNoConfig.status === 400, csvNoConfig.body);
const xn = await call('POST', '/instruments', { token: bio, body });
check('Création par le biologiste, code mis en majuscules', xn.status === 201 && xn.body.code === code && xn.body.apiKeyPrefix === null, xn.body);
const dup = await call('POST', '/instruments', { token: bio, body });
check('Code d’automate en double → 409', dup.status === 409, dup.body);
const XN = xn.body.id;
const usersList = await call('GET', `/users?q=automate&pageSize=100`, { token: admin });
check('Le compte de service de l’automate n’apparaît pas dans la liste des utilisateurs', usersList.status === 200 && !usersList.body.items.some((u) => u.username === `automate.${code.toLowerCase()}`), usersList.body.items?.map((u) => u.username));
const svcLogin = await call('POST', '/auth/login', { body: { username: `automate.${code.toLowerCase()}`, password: 'nimporte-quoi-123' } });
check('Le compte de service ne peut pas se connecter → 401', svcLogin.status === 401, svcLogin.body);
const renamed = await call('PUT', `/instruments/${XN}`, { token: bio, body: { ...body, code: 'AUTRE' } });
check('Le code d’un automate ne se modifie pas → 422', renamed.status === 422 && rule(renamed) === 'INSTRUMENT_CODE_IMMUTABLE', renamed.body);

console.log('\n— Correspondances des codes tests');
for (const [c, p] of [['WBC', 'GB'], ['HGB', 'HB'], ['HCT', 'HT'], ['PLT', 'PLT']]) {
  await call('PUT', `/instruments/${XN}/mappings`, { token: bio, body: { instrumentCode: c, parameterId: P[p].id } });
}
const badFactor = await call('PUT', `/instruments/${XN}/mappings`, { token: bio, body: { instrumentCode: 'MAL', parameterId: geParam.id, factor: 2 } });
check('Facteur sur un paramètre qualitatif → 422', badFactor.status === 422 && rule(badFactor) === 'FACTOR_NUMERIC_ONLY', badFactor.body);
const badMap = await call('PUT', `/instruments/${XN}/mappings`, { token: bio, body: { instrumentCode: 'MAL', parameterId: geParam.id, valueMap: { POS: 'Peut-être' } } });
check('Table de valeurs hors des choix du paramètre → 422', badMap.status === 422 && rule(badMap) === 'VALUE_MAP_INVALID', badMap.body);
const detail = (await call('GET', `/instruments/${XN}`, { token: tech })).body;
check('4 correspondances enregistrées', detail.mappings.length === 4 && detail.mappings.find((m) => m.instrumentCode === 'HGB').parameter.code === 'HB', detail.mappings.map((m) => m.instrumentCode));

console.log('\n— Clé du connecteur');
const bioKey = await call('POST', `/instruments/${XN}/api-key`, { token: bio });
check('Seul l’administrateur émet la clé → 403', bioKey.status === 403, bioKey.body);
const k1 = await call('POST', `/instruments/${XN}/api-key`, { token: admin });
check('Clé émise (affichée une fois), préfixe conservé', k1.status === 201 && k1.body.apiKey.startsWith(`sil_${code.toLowerCase()}_`) && k1.body.prefix.endsWith('…'), k1.body.prefix);
const KEY = k1.body.apiKey;
const ping = await call('GET', '/instrument-gateway/ping', { key: KEY });
check('Le connecteur s’identifie avec sa clé', ping.status === 200 && ping.body.instrument.code === code, ping.body);
check('Sans clé ou clé fausse → 401', (await call('GET', '/instrument-gateway/ping')).status === 401 && (await call('GET', '/instrument-gateway/ping', { key: KEY + 'x' })).status === 401);
check('Un jeton utilisateur ne donne pas accès à la passerelle → 401', (await call('GET', '/instrument-gateway/ping', { token: admin })).status === 401);

// ============================================================================ Demandes
const mkOrder = async (examIds, receive = true) => {
  const pat = (await call('POST', '/patients', { token: recep, body: { lastName: word(), firstName: word(), sex: 'FEMALE', birthDate: `19${70 + Math.floor(Math.random() * 25)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}` } })).body;
  const order = (await call('POST', '/orders', { token: recep, body: { patientId: pat.id, examIds } })).body;
  for (const s of order.samples) {
    await call('POST', `/samples/${s.id}/collect`, { token: recep, body: {} });
    if (receive) await call('POST', `/samples/${s.id}/receive`, { token: tech });
  }
  return order;
};
const o1 = await mkOrder([exams.NFS.id]);
const s1 = o1.samples[0].number;
const o2 = await mkOrder([exams.NFS.id], false);
const s2 = o2.samples[0].number;
const o3 = await mkOrder([exams.NFS.id]);

// ============================================================================ Message ASTM
console.log('\n— Message ASTM (numération)');
const msg1 = astmMessage([
  { specimen: s1, results: [{ code: 'WBC', value: '7.85', unit: '10*3/uL' }, { code: 'HGB', value: '6.4', unit: 'g/dL', flag: 'LL' }, { code: 'HCT', value: '19.0', unit: '%', flag: 'L' }, { code: 'PLT', value: '', status: 'X' }, { code: 'MCV', value: '88', unit: 'fL' }] },
  { specimen: s2, results: [{ code: 'HGB', value: '12.9', unit: 'g/dL' }] },
  { specimen: '2611229999', results: [{ code: 'HGB', value: '11.0', unit: 'g/dL' }] },
]);
const r1 = await call('POST', '/instrument-gateway/messages', { key: KEY, body: { message: msg1 } });
check('Message tramé accepté', r1.status === 200 && r1.body.duplicate === false && r1.body.warnings.length === 0, r1.body);
check('3 intégrés, 1 non réalisé (PLT, statut X), 3 non appariés (code MCV, échantillon non reçu, échantillon inconnu)', r1.body.counts.APPLIED === 3 && r1.body.counts.NOT_PERFORMED === 1 && r1.body.counts.UNMATCHED === 3 && r1.body.status === 'PARTIAL', r1.body.counts);
const again = await call('POST', '/instrument-gateway/messages', { key: KEY, body: { message: msg1 } });
check('Retransmission identique reconnue : rien n’est réappliqué', again.status === 200 && again.body.duplicate === true && again.body.messageId === r1.body.messageId, again.body);

let res = (await call('GET', `/results/orders/${o1.id}`, { token: tech })).body;
let nfs = res.items[0];
const byCode = (it) => Object.fromEntries(it.results.map((r) => [r.parameterCode, r]));
let R = byCode(nfs);
check('Hb 6,4 intégrée, source « automate », saisie au nom de l’automate', R.HB.displayValue === '6,4' && R.HB.source === 'INSTRUMENT' && R.HB.enteredBy === `Automate Sysmex XN-1000 (${RUN})`, R.HB);
check('Interprétation et alerte critique calculées par le SIL (pas par l’automate)', R.HB.flag === 'CRITICAL_LOW' && nfs.alerts.some((a) => !a.acknowledgedAt && a.detectedBy === `Automate Sysmex XN-1000 (${RUN})`), nfs.alerts);
check('Examen incomplet (plaquettes non réalisées) → reste « À saisir », non validé', nfs.status === 'TO_ENTER' && R.PLT.displayValue === '', nfs.status);

console.log('\n— Conflit avec une saisie manuelle');
await call('PUT', `/results/items/${nfs.id}`, { token: tech, body: { results: [{ resultId: R.PLT.id, value: '250' }] } });
const msg2 = astmMessage([{ specimen: s1, results: [{ code: 'PLT', value: '182', unit: '10*3/uL' }, { code: 'HGB', value: '6.4', unit: 'g/dL' }] }]);
const r2 = await call('POST', '/instrument-gateway/messages', { key: KEY, body: { message: msg2 } });
check('Valeur manuelle différente → conflit (jamais d’écrasement) ; valeur identique → rien à faire', r2.body.counts.CONFLICT === 1 && r2.body.counts.APPLIED === 1, r2.body.counts);
res = (await call('GET', `/results/orders/${o1.id}`, { token: tech })).body;
check('La saisie manuelle (250) est conservée', byCode(res.items[0]).PLT.displayValue === '250' && byCode(res.items[0]).PLT.source === 'MANUAL', byCode(res.items[0]).PLT);

const queue = await call('GET', `/instrument-results?instrumentId=${XN}&pageSize=50`, { token: tech });
check('File « à traiter » : conflits et non appariés', queue.status === 200 && queue.body.items.length === 4 && queue.body.items.some((i) => i.status === 'CONFLICT' && i.order?.number === o1.number), queue.body.items?.map((i) => `${i.specimenId}/${i.testCode}:${i.status}`));
const conflict = queue.body.items.find((i) => i.status === 'CONFLICT');
const unreceived = queue.body.items.find((i) => i.specimenId === s2);
const unknown = queue.body.items.find((i) => i.specimenId === '2611229999');
const mcv = queue.body.items.find((i) => i.testCode === 'MCV');
check('Motifs explicites', /pas encore réceptionné/.test(unreceived?.reason ?? '') && /inconnu/.test(unknown?.reason ?? '') && /sans correspondance/.test(mcv?.reason ?? ''), [unreceived?.reason, unknown?.reason, mcv?.reason]);
const recepAccept = await call('POST', `/instrument-results/${conflict.id}/accept`, { token: recep });
check('L’accueil ne tranche pas un conflit → 403', recepAccept.status === 403, recepAccept.body);
const notConflict = await call('POST', `/instrument-results/${unknown.id}/accept`, { token: tech });
check('« Retenir l’automate » réservé aux conflits → 422', notConflict.status === 422 && rule(notConflict) === 'NOT_A_CONFLICT', notConflict.body);
const accepted = await call('POST', `/instrument-results/${conflict.id}/accept`, { token: tech });
check('Le technicien retient la valeur de l’automate : intégrée, décision tracée', accepted.status === 200 && accepted.body.status === 'APPLIED' && accepted.body.resolvedBy === `Test tec6.${RUN.toLowerCase()}`, accepted.body);
res = (await call('GET', `/results/orders/${o1.id}`, { token: tech })).body;
nfs = res.items[0];
R = byCode(nfs);
check('Plaquettes = 182 (automate), examen complet → « Saisi »', R.PLT.displayValue === '182' && R.PLT.source === 'INSTRUMENT' && nfs.status === 'ENTERED', [R.PLT, nfs.status]);

console.log('\n— Relance et rejet motivé');
await call('POST', `/samples/${o2.samples[0].id}/receive`, { token: tech });
const retried = await call('POST', `/instrument-results/${unreceived.id}/retry`, { token: tech });
check('Échantillon reçu entre-temps : la relance intègre la valeur', retried.status === 200 && retried.body.status === 'APPLIED', retried.body);
const dismissShort = await call('POST', `/instrument-results/${unknown.id}/dismiss`, { token: tech, body: { reason: 'non' } });
check('Écarter sans motif suffisant → 400', dismissShort.status === 400, dismissShort.body);
const dismissed = await call('POST', `/instrument-results/${unknown.id}/dismiss`, { token: tech, body: { reason: 'Tube de calibration passé en mode patient' } });
check('Résultat écarté avec motif', dismissed.status === 200 && dismissed.body.status === 'DISMISSED' && dismissed.body.reason.startsWith('Tube'), dismissed.body);
const twice = await call('POST', `/instrument-results/${unknown.id}/dismiss`, { token: tech, body: { reason: 'Encore une fois' } });
check('Un résultat traité ne se retraite pas → 422', twice.status === 422 && rule(twice) === 'ALREADY_RESOLVED', twice.body);

console.log('\n— Examen déjà validé');
await call('POST', `/results/alerts/${nfs.alerts.find((a) => !a.acknowledgedAt).id}/acknowledge`, { token: tech, body: { notifiedTo: 'Dr Test, par téléphone' } });
const tv = await call('POST', `/results/items/${nfs.id}/technical-validation`, { token: tech });
check('Validation technique toujours humaine', tv.status === 200 && tv.body.status === 'TECHNICAL_VALIDATED', tv.body);
const r3 = await call('POST', '/instrument-gateway/messages', { key: KEY, body: { message: astmMessage([{ specimen: s1, results: [{ code: 'HGB', value: '7.1', unit: 'g/dL' }] }]) } });
check('Nouvelle valeur sur un examen validé → « Examen déjà validé », rien n’est modifié', r3.body.counts.LOCKED === 1 && byCode((await call('GET', `/results/orders/${o1.id}`, { token: tech })).body.items[0]).HB.displayValue === '6,4', r3.body.counts);

// ============================================================================ CIQ transmis par l'automate
console.log('\n— Contrôle qualité transmis par l’automate');
const mat = (await call('POST', '/qc/materials', { token: bio, body: { name: `XN Check ${RUN}`, lotNumber: `X${RUN}`, level: 'Niveau 2', expiresOn: '2027-12-31', sectionId: nfsExam.section.id } })).body;
await call('PUT', `/qc/materials/${mat.id}/targets`, { token: bio, body: { parameterId: P.HB.id, mean: 13.5, sd: 0.3, source: 'MANUFACTURER' } });
const QCID = `QC-N2-${RUN}`;
const link = await call('PUT', `/instruments/${XN}/qc-materials`, { token: bio, body: { specimenId: QCID, materialId: mat.id } });
check('Identifiant de contrôle de l’automate relié au lot', link.status === 200 && link.body.qcMaterials.some((q) => q.specimenId === QCID), link.body.qcMaterials);
const qc1 = await call('POST', '/instrument-gateway/messages', { key: KEY, body: { message: astmMessage([{ specimen: QCID, results: [{ code: 'HGB', value: '13.6', unit: 'g/dL' }, { code: 'WBC', value: '7.0' }] }]) } });
const qcRows = (await call('GET', `/instrument-messages/${qc1.body.messageId}`, { token: tech })).body.results;
const hgbQc = qcRows.find((r) => r.testCode === 'HGB');
check('Contrôle Hb intégré au CIQ (série créée) ; WBC sans cible → non apparié', hgbQc.kind === 'QC' && hgbQc.status === 'QC_APPLIED' && !!hgbQc.qcRunId && qcRows.find((r) => r.testCode === 'WBC').status === 'UNMATCHED', qcRows.map((r) => `${r.testCode}:${r.status}:${r.reason}`));
const run1 = (await call('GET', `/qc/runs/${hgbQc.qcRunId}`, { token: tech })).body;
check('Série évaluée par Westgard, opérateur = l’automate', run1.status === 'ACCEPTED' && run1.performedBy === `Automate Sysmex XN-1000 (${RUN})` && run1.results[0].z === 0.333, run1);
const qc2 = await call('POST', '/instrument-gateway/messages', { key: KEY, body: { message: astmMessage([{ specimen: QCID, results: [{ code: 'HGB', value: '14.6', unit: 'g/dL' }] }]) } });
const rejRow = (await call('GET', `/instrument-messages/${qc2.body.messageId}`, { token: tech })).body.results[0];
const rejRun = (await call('GET', `/qc/runs/${rejRow.qcRunId}`, { token: tech })).body;
check('Contrôle à +3,67 ET → série rejetée 1-3s, non-conformité ouverte au nom de l’automate', rejRow.status === 'QC_APPLIED' && /rejetée/.test(rejRow.reason) && rejRun.status === 'REJECTED' && !!rejRun.qualityIssue, [rejRow.reason, rejRun.qualityIssue]);
const o4 = await mkOrder([exams.NFS.id]);
const r4 = await call('POST', '/instrument-gateway/messages', { key: KEY, body: { message: astmMessage([{ specimen: o4.samples[0].number, results: [{ code: 'WBC', value: '5.2' }, { code: 'HGB', value: '13.1' }, { code: 'HCT', value: '40' }, { code: 'PLT', value: '250' }] }]) } });
const it4 = (await call('GET', `/results/orders/${o4.id}`, { token: tech })).body.items[0];
const blocked = await call('POST', `/results/items/${it4.id}/technical-validation`, { token: tech });
check('Résultats patients intégrés mais validation bloquée par le CIQ rejeté', r4.body.counts.APPLIED === 4 && blocked.status === 422 && rule(blocked) === 'QC_REJECTED', [r4.body.counts, blocked.body]);
const qcLocked = await call('POST', '/instrument-gateway/messages', { key: KEY, body: { message: astmMessage([{ specimen: QCID, results: [{ code: 'HGB', value: '13.4' }] }]) } });
const lockedRow = (await call('GET', `/instrument-messages/${qcLocked.body.messageId}`, { token: tech })).body.results[0];
check('Nouveau contrôle avant action corrective → non apparié avec le motif du CIQ', lockedRow.status === 'UNMATCHED' && /action corrective/.test(lockedRow.reason), lockedRow.reason);
await call('POST', `/qc/runs/${rejRun.id}/corrective-action`, { token: tech, body: { correctiveAction: 'Nettoyage de la cellule de mesure Hb, contrôle repassé.' } });
const retryQc = await call('POST', `/instrument-results/${lockedRow.id}/retry`, { token: tech });
check('Après action corrective, la relance intègre le contrôle (accepté)', retryQc.body.status === 'QC_APPLIED', retryQc.body);
const unblocked = await call('POST', `/results/items/${it4.id}/technical-validation`, { token: tech });
check('Validation des résultats patients débloquée', unblocked.status === 200, unblocked.body);

// ============================================================================ Liste de travail
console.log('\n— Liste de travail (requête hôte)');
const wl = await call('GET', '/instrument-gateway/worklist', { key: KEY });
const wlOrder = wl.body.orders.find((o) => o.sampleNumber === o3.samples[0].number);
check('Échantillons reçus en attente avec les codes de l’automate', wl.status === 200 && wlOrder && wlOrder.tests.sort().join() === 'HCT,HGB,PLT,WBC' && !wl.body.orders.some((o) => o.sampleNumber === s1), wlOrder);
check('Format ASTM prêt à transmettre (H, P, O, L)', wl.body.astm.startsWith('H|\\^&') && wl.body.astm.includes(`|${o3.samples[0].number}||^^^`) && /L\|1\|N\r$/.test(wl.body.astm), wl.body.astm.slice(0, 120));

// ============================================================================ HL7 et CSV
console.log('\n— HL7 v2 (glycémie en mmol/L convertie en g/L)');
const gx = (await call('POST', '/instruments', { token: bio, body: { code: `CHIM${RUN}`, name: `Analyseur chimie ${RUN}`, protocol: 'HL7' } })).body;
await call('PUT', `/instruments/${gx.id}/mappings`, { token: bio, body: { instrumentCode: 'GLU', parameterId: glyParam.id, factor: '0,18016' } });
const gxKey = (await call('POST', `/instruments/${gx.id}/api-key`, { token: admin })).body.apiKey;
const o5 = await mkOrder([exams.GLY.id]);
const hl7 = ['MSH|^~\\&|CHIM|LAB|SIL||20261122093000||ORU^R01|CTRL' + RUN + '|P|2.5', 'PID|1||X', `OBR|1|${o5.samples[0].number}||GLU`, 'OBX|1|NM|GLU^Glucose||5.1|mmol/L|3.9-6.1|N|||F'].join('\r');
const h1 = await call('POST', '/instrument-gateway/messages', { key: gxKey, body: { message: `\x0b${hl7}\x1c\r` } });
check('ORU^R01 intégré, ACK HL7 « AA » avec l’identifiant de contrôle', h1.body.counts.APPLIED === 1 && h1.body.ack.split('\r')[1].startsWith(`MSA|AA|CTRL${RUN}|`), h1.body);
const gly = (await call('GET', `/results/orders/${o5.id}`, { token: tech })).body.items[0].results[0];
check('5,1 mmol/L × 0,18016 = 0,92 g/L', gly.numericValue === 0.9188 && gly.displayValue === '0,92', gly);
const h2 = await call('POST', '/instrument-gateway/messages', { key: gxKey, body: { message: 'PID|pas un message' } });
check('Message illisible conservé « Illisible » et ACK « AR »', h2.status === 200 && h2.body.status === 'FAILED' && h2.body.ack.includes('MSA|AR|'), h2.body);
const keyMix = await call('POST', '/instrument-gateway/messages', { key: gxKey, body: { message: msg1 } });
check('Chaque clé n’alimente que son automate (le message ASTM est illisible pour l’analyseur HL7)', keyMix.body.status === 'FAILED', keyMix.body.status);

console.log('\n— Import de fichier CSV');
const csvInst = (await call('POST', '/instruments', {
  token: bio,
  body: { code: `CSV${RUN}`, name: `Export CSV ${RUN}`, protocol: 'CSV', csvConfig: { delimiter: ';', hasHeader: true, specimenColumn: 'Echantillon', testColumn: 'Test', valueColumn: 'Resultat', unitColumn: 'Unite', measuredAtColumn: 'Date' } },
})).body;
await call('PUT', `/instruments/${csvInst.id}/mappings`, { token: bio, body: { instrumentCode: 'GLY', parameterId: glyParam.id } });
const o6 = await mkOrder([exams.GLY.id]);
const csv = `Echantillon;Test;Resultat;Unite;Date\n${o6.samples[0].number};GLY;1,05;g/L;22/11/2026 09:10\n${o6.samples[0].number};CRP;12;mg/L;22/11/2026 09:10\n`;
const recepUpload = await call('POST', `/instruments/${csvInst.id}/upload`, { token: recep, body: { content: csv } });
check('L’accueil n’importe pas de fichier d’automate → 403', recepUpload.status === 403, recepUpload.body);
const up = await call('POST', `/instruments/${csvInst.id}/upload`, { token: tech, body: { content: csv, filename: 'export.csv' } });
check('Import par le technicien : 1 intégré, 1 code inconnu', up.status === 201 && up.body.counts.APPLIED === 1 && up.body.counts.UNMATCHED === 1, up.body);
const badCsv = await call('POST', `/instruments/${csvInst.id}/upload`, { token: tech, body: { content: 'a;b;c\n1;2;3\n', filename: 'mauvais.csv' } });
check('Fichier sans les colonnes attendues → message « Illisible » avec l’explication', badCsv.body.status === 'FAILED' && /Echantillon/.test(badCsv.body.warnings[0]), badCsv.body);

// ============================================================================ Journal, désactivation, audit
console.log('\n— Journal et traçabilité');
const msgs = await call('GET', `/instrument-messages?instrumentId=${XN}&pageSize=50`, { token: tech });
check('Journal des messages de l’automate', msgs.status === 200 && msgs.body.total >= 7 && msgs.body.items.every((m) => m.instrument.code === code), msgs.body.total);
const m1 = await call('GET', `/instrument-messages/${r1.body.messageId}`, { token: tech });
check('Message brut conservé à l’identique, avec ses résultats', m1.body.raw === msg1 && m1.body.results.length === 7, m1.body.results?.length);
const auditMsg = await call('GET', '/audit?entity=InstrumentMessage&pageSize=5', { token: admin });
check('Réception tracée au nom de l’automate', auditMsg.body.items.some((a) => a.actorUsername?.startsWith('automate.')), auditMsg.body.items.map((a) => a.actorUsername));
for (const inst of [xn.body, gx, csvInst]) {
  const d = (await call('GET', `/instruments/${inst.id}`, { token: bio })).body;
  await call('PUT', `/instruments/${inst.id}`, { token: bio, body: { code: d.code, name: d.name, manufacturer: d.manufacturer, model: d.model, sectionId: d.section?.id ?? null, protocol: d.protocol, csvConfig: d.csvConfig, isActive: false } });
}
check('Automate désactivé : sa clé est refusée', (await call('GET', '/instrument-gateway/ping', { key: KEY })).status === 401);
await call('PUT', `/qc/materials/${mat.id}`, { token: bio, body: { name: mat.name, lotNumber: mat.lotNumber, level: mat.level, expiresOn: mat.expiresOn, sectionId: mat.section?.id ?? null, isActive: false } });
const verify = await call('GET', '/audit/verify', { token: admin });
check('Chaîne d’audit intègre', verify.body.valid === true, verify.body);

await call('PUT', '/settings/lab', { token: admin, body: settingsRest });
console.log(failures === 0 ? '\nTOUS LES CONTRÔLES SONT PASSÉS' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
