// Test de fumée de l'étape 7 (interopérabilité DHIS2 / VLSM / OpenHIM) contre les serveurs simulés de mock-interop.mjs.
// Prérequis : base de TEST avec le catalogue de démarrage (pnpm db:seed:catalog), INTEROP_SECRET_KEY configurée,
// et les serveurs simulés lancés : node scripts/mock-interop.mjs 3999
// Usage : node --env-file=.env scripts/smoke-test-step7.mjs [http://localhost:3000/api] [http://localhost:3999]
// Attention : crée des données (connexions désactivées en fin de test). Jamais en production.

import { spawnSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:3000/api';
const MOCK = process.argv[3] ?? 'http://localhost:3999';
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

async function call(method, path, { token, body, raw = false } = {}) {
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
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: raw || !text ? text : JSON.parse(text) };
  }
}
const mock = async (path, method = 'GET') => (await fetch(MOCK + path, { method })).json();
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
const LAB_TZ = process.env.LAB_TIMEZONE ?? 'Africa/Kinshasa';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: LAB_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const PERIOD = today.slice(0, 4) + today.slice(5, 7);

await mock('/__mock/reset', 'POST');
const admin = await login(SEED_USERNAME, ADMIN_PASSWORD);
const bio = await createStaff(admin, `bio7.${RUN.toLowerCase()}`, ['BIOLOGISTE']);
const qual = await createStaff(admin, `qua7.${RUN.toLowerCase()}`, ['QUALITE']);
const tech = await createStaff(admin, `tec7.${RUN.toLowerCase()}`, ['TECHNICIEN']);
const recep = await createStaff(admin, `rec7.${RUN.toLowerCase()}`, ['RECEPTION', 'CAISSE']);

const settings0 = (await call('GET', '/settings/lab', { token: admin })).body;
const { updatedAt: _u, secondaryCurrency: _s, ...settingsRest } = settings0;
await call('PUT', '/settings/lab', { token: admin, body: { ...settingsRest, requirePaymentBeforeCollection: false } });

const exams = Object.fromEntries((await call('GET', '/catalog/exams?pageSize=100', { token: bio })).body.items.map((e) => [e.code, e]));
const cvExam = (await call('GET', `/catalog/exams/${exams['CV-VIH'].id}`, { token: bio })).body;
const eidExam = (await call('GET', `/catalog/exams/${exams['EID-PCR'].id}`, { token: bio })).body;
const tdrExam = (await call('GET', `/catalog/exams/${exams['TDR-VIH'].id}`, { token: bio })).body;
const CV = cvExam.parameters[0];
const EID = eidExam.parameters[0];

// ============================================================================ Connexions
console.log('\n— Connexions DHIS2, VLSM et OpenHIM');
const overview = await call('GET', '/interop/overview', { token: qual });
check('Clé de chiffrement des secrets configurée', overview.status === 200 && overview.body.encryptionReady === true, overview.body);
const dhisBody = { code: `dhis2-${RUN}`, name: `DHIS2 national (${RUN})`, system: 'DHIS2', transport: 'DIRECT', baseUrl: `${MOCK}/dhis2/`, authMode: 'BASIC', username: 'admin', secret: 'district', timeoutSeconds: 10, settings: { orgUnit: 'OrgKinsh001', dataSet: 'DsLaboCV001' } };
check('Le biologiste ne déclare pas de connexion → 403', (await call('POST', '/interop/endpoints', { token: bio, body: dhisBody })).status === 403);
const badUid = await call('POST', '/interop/endpoints', { token: admin, body: { ...dhisBody, settings: { orgUnit: 'kinshasa' } } });
check('UID d’unité d’organisation invalide → 400', badUid.status === 400, badUid.body);
const himToken = await call('POST', '/interop/endpoints', { token: admin, body: { ...dhisBody, transport: 'OPENHIM', authMode: 'TOKEN' } });
check('Via OpenHIM, jeton d’API refusé (client OpenHIM obligatoire) → 400', himToken.status === 400, himToken.body);
const credsInUrl = await call('POST', '/interop/endpoints', { token: admin, body: { ...dhisBody, baseUrl: MOCK.replace('http://', 'http://admin:district@') + '/dhis2' } });
check('Identifiants dans l’URL → 422', credsInUrl.status === 422 && rule(credsInUrl) === 'INTEROP_URL_CREDENTIALS', credsInUrl.body);
const noSecret = await call('POST', '/interop/endpoints', { token: admin, body: { ...dhisBody, secret: undefined } });
check('Création sans mot de passe → 422', noSecret.status === 422 && rule(noSecret) === 'INTEROP_SECRET_REQUIRED', noSecret.body);
const d = await call('POST', '/interop/endpoints', { token: admin, body: dhisBody });
check('Connexion DHIS2 créée : code en majuscules, URL normalisée, secret jamais renvoyé', d.status === 201 && d.body.code === `DHIS2-${RUN}` && d.body.baseUrl === `${MOCK}/dhis2` && d.body.hasSecret === true && !d.text.includes('district') && !d.text.includes('v1:'), d.body);
const DH = d.body.id;
check('Code de connexion en double → 409', (await call('POST', '/interop/endpoints', { token: admin, body: dhisBody })).status === 409);
const audit = await call('GET', `/audit?entity=InteropEndpoint&pageSize=20`, { token: admin });
check('Piste d’audit de la connexion sans le secret (ni en clair ni chiffré)', audit.status === 200 && audit.text.includes(`DHIS2-${RUN}`) && !audit.text.includes('district') && !audit.text.includes('secretCipher'), audit.text.slice(0, 300));
let t = await call('POST', `/interop/endpoints/${DH}/test`, { token: admin });
check('Test de connexion DHIS2 : version lue dans /api/system/info', t.status === 200 && t.body.lastTestOk === true && t.body.lastTestMessage.includes('2.40.4'), t.body);
const { secret: _sec, ...dhisNoSecret } = dhisBody;
await call('PUT', `/interop/endpoints/${DH}`, { token: admin, body: { ...dhisBody, secret: 'mauvais' } });
t = await call('POST', `/interop/endpoints/${DH}/test`, { token: admin });
check('Mauvais mot de passe : test en échec, message HTTP 401 explicite', t.body.lastTestOk === false && t.body.lastTestMessage.includes('401'), t.body);
const kept = await call('PUT', `/interop/endpoints/${DH}`, { token: admin, body: { ...dhisNoSecret, secret: 'district', name: `DHIS2 national RDC (${RUN})` } });
check('Modification : la connexion doit être testée à nouveau', kept.status === 200 && kept.body.lastTestOk === null && kept.body.hasSecret, kept.body);
const keptSecret = await call('PUT', `/interop/endpoints/${DH}`, { token: admin, body: { ...dhisNoSecret, timeoutSeconds: 12 } });
t = await call('POST', `/interop/endpoints/${DH}/test`, { token: admin });
check('Modification sans secret : le secret enregistré est conservé', keptSecret.status === 200 && t.body.lastTestOk === true, t.body);
const recode = await call('PUT', `/interop/endpoints/${DH}`, { token: admin, body: { ...dhisNoSecret, code: 'AUTRE' } });
check('Le code d’une connexion ne se modifie pas → 422', recode.status === 422 && rule(recode) === 'INTEROP_CODE_IMMUTABLE', recode.body);

const him = await call('POST', '/interop/endpoints', { token: admin, body: { ...dhisBody, code: `HIM-DHIS2-${RUN}`, name: `DHIS2 via OpenHIM (${RUN})`, transport: 'OPENHIM', baseUrl: `${MOCK}/openhim/dhis2`, username: 'lims-client', secret: 'him-pass' } });
const HIM = him.body.id;
t = await call('POST', `/interop/endpoints/${HIM}/test`, { token: admin });
check('DHIS2 via le canal OpenHIM (client OpenHIM, identifiants DHIS2 portés par le canal)', t.body.lastTestOk === true, t.body);
let runs = await call('GET', `/interop/runs?endpointId=${HIM}`, { token: qual });
check('Identifiant de transaction OpenHIM conservé au journal', runs.body.items[0]?.kind === 'CONNECTION_TEST' && /^[0-9a-f]{24}$/.test(runs.body.items[0]?.openhimTransactionId ?? ''), runs.body.items[0]);
const badHim = await call('POST', '/interop/endpoints', { token: admin, body: { ...dhisBody, code: `HIM-BAD-${RUN}`, transport: 'OPENHIM', baseUrl: `${MOCK}/openhim/dhis2`, username: 'lims-client', secret: 'faux' } });
t = await call('POST', `/interop/endpoints/${badHim.body.id}/test`, { token: admin });
check('Client OpenHIM refusé → test en échec', t.body.lastTestOk === false && t.body.lastTestMessage.includes('401'), t.body);
const slow = await call('POST', '/interop/endpoints', { token: admin, body: { ...dhisBody, code: `SLOW-${RUN}`, baseUrl: `${MOCK}/slow`, timeoutSeconds: 5 } });
t = await call('POST', `/interop/endpoints/${slow.body.id}/test`, { token: admin });
check('Serveur muet : délai de 5 s dépassé, échec journalisé', t.body.lastTestOk === false && t.body.lastTestMessage.includes('Délai'), t.body);
const down = await call('POST', '/interop/endpoints', { token: admin, body: { ...dhisBody, code: `DOWN-${RUN}`, baseUrl: 'http://127.0.0.1:59999' } });
t = await call('POST', `/interop/endpoints/${down.body.id}/test`, { token: admin });
check('Serveur arrêté : « Connexion refusée »', t.body.lastTestOk === false && t.body.lastTestMessage.includes('refusée'), t.body);

const vlsmSettings = { labId: 16, facilityId: 3, reasonForVLTesting: '1', defaultSpecimenType: 2, specimenTypes: [{ sampleTypeId: eidExam.sampleType.id, vlsmSpecimenType: 5 }] };
const vlsmBody = { code: `VLSM-${RUN}`, name: `VLSM / InteLIS STS (${RUN})`, system: 'VLSM', transport: 'DIRECT', baseUrl: `${MOCK}/vlsm/api/v1.1`, authMode: 'BASIC', username: 'lims', secret: 'vlsm-pass', timeoutSeconds: 10, settings: vlsmSettings };
const badSt = await call('POST', '/interop/endpoints', { token: admin, body: { ...vlsmBody, code: `VLSM-X-${RUN}`, settings: { ...vlsmSettings, specimenTypes: [{ sampleTypeId: '6f1c2f8e-4b7a-4c1e-9a55-2b1f3c4d5e6f', vlsmSpecimenType: 5 }] } } });
check('Type d’échantillon inconnu dans les correspondances VLSM → 422', badSt.status === 422 && rule(badSt) === 'INTEROP_SAMPLE_TYPE_UNKNOWN', badSt.body);
const v = await call('POST', '/interop/endpoints', { token: admin, body: vlsmBody });
const VL = v.body.id;
t = await call('POST', `/interop/endpoints/${VL}/test`, { token: admin });
check('VLSM : connexion /user/login.php puis /version.php', v.status === 201 && t.body.lastTestOk === true && t.body.lastTestMessage.includes('5.7.51') && t.body.lastTestMessage.includes('connexion API'), t.body);
const vBad = await call('POST', '/interop/endpoints', { token: admin, body: { ...vlsmBody, code: `VLSM-BAD-${RUN}`, secret: 'faux' } });
t = await call('POST', `/interop/endpoints/${vBad.body.id}/test`, { token: admin });
check('VLSM : identifiants refusés (status 2) → échec explicite', t.body.lastTestOk === false && t.body.lastTestMessage.includes('refusé'), t.body);
const vh = await call('POST', '/interop/endpoints', { token: admin, body: { ...vlsmBody, code: `HIM-VLSM-${RUN}`, name: `VLSM via OpenHIM (${RUN})`, transport: 'OPENHIM', baseUrl: `${MOCK}/openhim/vlsm`, username: 'lims-client', secret: 'him-pass' } });
const VH = vh.body.id;
t = await call('POST', `/interop/endpoints/${VH}/test`, { token: admin });
check('VLSM via OpenHIM', t.body.lastTestOk === true && t.body.lastTestMessage.includes('OpenHIM'), t.body);

// ============================================================================ Correspondances DHIS2
console.log('\n— Correspondances DHIS2 (canevas CV)');
const map = (body) => call('POST', `/interop/endpoints/${DH}/dhis2-mappings`, { token: qual, body: { parameterId: CV.id, ...body } });
check('Le technicien ne définit pas de correspondance → 403', (await call('POST', `/interop/endpoints/${DH}/dhis2-mappings`, { token: tech, body: { label: 'x', parameterId: CV.id, measure: 'VALIDATED_COUNT', dataElement: 'CvTested001' } })).status === 403);
const noThr = await map({ label: 'CV supprimées', measure: 'NUMERIC_BELOW', dataElement: 'CvSuppr0001' });
check('Seuil manquant → 400', noThr.status === 400, noThr.body);
const textOnNum = await map({ label: 'CV texte', measure: 'TEXT_EQUALS', textMatch: 'Indétectable', dataElement: 'CvText00001' });
check('Comparaison de texte sur un paramètre numérique → 422', textOnNum.status === 422 && rule(textOnNum) === 'DHIS2_MEASURE_NEEDS_TEXT', textOnNum.body);
const m1 = await map({ label: 'CV réalisées (validées)', measure: 'VALIDATED_COUNT', dataElement: 'CvTested001', displayOrder: 1 });
const m2 = await map({ label: 'CV < 1000 — femmes ≥ 15 ans', measure: 'NUMERIC_BELOW', threshold: 1000, sex: 'FEMALE', ageMinYears: 15, dataElement: 'CvSuppr0001', categoryOptionCombo: 'AdultF00001', displayOrder: 2 });
const m3 = await map({ label: 'CV < 1000 — enfants < 15 ans', measure: 'NUMERIC_BELOW', threshold: 1000, ageMaxYears: 15, dataElement: 'CvSuppr0001', categoryOptionCombo: 'Child000001', displayOrder: 3 });
const m4 = await map({ label: 'CV ≥ 1000', measure: 'NUMERIC_AT_OR_ABOVE', threshold: 1000, dataElement: 'CvNonSup001', displayOrder: 4 });
check('4 correspondances créées par la qualité', [m1, m2, m3, m4].every((m) => m.status === 201), [m1, m2, m3, m4].map((m) => m.body));
const dupCell = await map({ label: 'Doublon', measure: 'VALIDATED_COUNT', dataElement: 'CvSuppr0001', categoryOptionCombo: 'Child000001' });
check('Cellule DHIS2 déjà alimentée → 409', dupCell.status === 409, dupCell.body);
const m5 = await map({ label: 'Élément inconnu de DHIS2', measure: 'VALIDATED_COUNT', dataElement: 'Xunknown001', isActive: false, displayOrder: 9 });
const tdrText = await call('POST', `/interop/endpoints/${DH}/dhis2-mappings`, { token: qual, body: { label: 'TDR', parameterId: tdrExam.parameters[0].id, measure: 'TEXT_EQUALS', textMatch: 'Peut-être', dataElement: 'TdrPos00001' } });
check('Texte hors des choix du paramètre → 422', tdrText.status === 422 && rule(tdrText) === 'DHIS2_TEXT_NOT_A_CHOICE', tdrText.body);
const before = (await call('GET', `/interop/endpoints/${DH}/dhis2/preview?period=${PERIOD}`, { token: qual })).body;
const val = (p, id) => p.lines.find((l) => l.mappingId === id)?.value ?? 0;

// ============================================================================ Données : CV et EID validées
console.log('\n— Résultats de charge virale et d’EID validés');
const flow = async ({ sex, birthDate, externalId, examId, value }) => {
  const pat = (await call('POST', '/patients', { token: recep, body: { lastName: word(), firstName: word(), sex, birthDate, externalId } })).body;
  const order = (await call('POST', '/orders', { token: recep, body: { patientId: pat.id, examIds: [examId] } })).body;
  for (const s of order.samples) {
    await call('POST', `/samples/${s.id}/collect`, { token: recep, body: {} });
    await call('POST', `/samples/${s.id}/receive`, { token: tech });
  }
  const item = (await call('GET', `/results/orders/${order.id}`, { token: tech })).body.items[0];
  const saved = await call('PUT', `/results/items/${item.id}`, { token: tech, body: { results: [{ resultId: item.results[0].id, value }] } });
  const tv = await call('POST', `/results/items/${item.id}/technical-validation`, { token: tech });
  const bv = await call('POST', `/results/items/${item.id}/biological-validation`, { token: bio, body: {} });
  if (saved.status !== 200 || tv.status !== 200 || bv.status !== 200) throw new Error(`Validation impossible : ${JSON.stringify([saved.body, tv.body, bv.body]).slice(0, 600)}`);
  return { pat, order, itemId: item.id, sample: order.samples[0].number };
};
const A = await flow({ sex: 'FEMALE', birthDate: '1990-03-12', externalId: `TARV-${RUN}-A`, examId: cvExam.id, value: '<40' });
const B = await flow({ sex: 'MALE', birthDate: '1985-06-01', externalId: `TARV-${RUN}-B`, examId: cvExam.id, value: '150000' });
const C = await flow({ sex: 'FEMALE', birthDate: '2016-02-01', externalId: `TARV-${RUN}-C`, examId: cvExam.id, value: '500' });
const Dn = await flow({ sex: 'FEMALE', birthDate: '1979-09-09', externalId: null, examId: cvExam.id, value: '2000000' });
const E = await flow({ sex: 'MALE', birthDate: '2026-05-02', externalId: `EID-${RUN}-1`, examId: eidExam.id, value: 'Négatif' });
check('5 examens validés (4 CV, 1 EID)', true);

// ============================================================================ Rapport DHIS2
console.log('\n— Rapport mensuel DHIS2');
check('Le technicien n’accède pas à l’aperçu → 403', (await call('GET', `/interop/endpoints/${DH}/dhis2/preview?period=${PERIOD}`, { token: tech })).status === 403);
check('Période mal formée → 400', (await call('GET', `/interop/endpoints/${DH}/dhis2/preview?period=2026-11`, { token: qual })).status === 400);
const prev = (await call('GET', `/interop/endpoints/${DH}/dhis2/preview?period=${PERIOD}`, { token: qual })).body;
check('CV réalisées : +4', val(prev, m1.body.id) - val(before, m1.body.id) === 4, prev.lines);
check('CV < 1000 femmes ≥ 15 ans : +1 (« < 40 » compté sous le seuil)', val(prev, m2.body.id) - val(before, m2.body.id) === 1, prev.lines);
check('CV < 1000 enfants < 15 ans : +1', val(prev, m3.body.id) - val(before, m3.body.id) === 1, prev.lines);
check('CV ≥ 1000 : +2', val(prev, m4.body.id) - val(before, m4.body.id) === 2, prev.lines);
check('Règle inactive absente de l’aperçu, période en cours signalée', !prev.lines.some((l) => l.mappingId === m5.body.id) && prev.warnings.some((w) => w.includes('Période en cours')), prev);
const csv = await call('GET', `/interop/endpoints/${DH}/dhis2/csv?period=${PERIOD}`, { token: qual, raw: true });
check('Export CSV au format d’import DHIS2', csv.status === 200 && csv.headers.get('content-disposition')?.includes(`${PERIOD}.csv`) && csv.text.startsWith('dataelement,period,orgunit') && csv.text.includes(`CvTested001,${PERIOD},OrgKinsh001,,,${val(prev, m1.body.id)}`), csv.text.slice(0, 300));
check('L’administrateur ne transmet pas les données → 403', (await call('POST', `/interop/endpoints/${DH}/dhis2/send`, { token: admin, body: { period: PERIOD, dryRun: true } })).status === 403);
const dry = await call('POST', `/interop/endpoints/${DH}/dhis2/send`, { token: qual, body: { period: PERIOD, dryRun: true } });
check('Simulation (dryRun) : résumé d’importation lu, rien d’enregistré dans DHIS2', dry.status === 200 && dry.body.kind === 'DHIS2_DRY_RUN' && dry.body.status === 'SUCCESS' && dry.body.imported === 4 && Object.keys((await mock('/__mock/state')).dhis2).length === 0, dry.body);
const lastReq = (await mock('/__mock/requests')).filter((r) => r.path === '/dhis2/api/dataValueSets').pop();
check('Requête dataValueSets conforme (dryRun, CREATE_AND_UPDATE, période, unité, dataSet)', lastReq?.query.includes('dryRun=true') && lastReq.query.includes('importStrategy=CREATE_AND_UPDATE') && lastReq.body.period === PERIOD && lastReq.body.orgUnit === 'OrgKinsh001' && lastReq.body.dataSet === 'DsLaboCV001' && lastReq.body.dataValues.length === 4, lastReq);
const sent = await call('POST', `/interop/endpoints/${DH}/dhis2/send`, { token: bio, body: { period: PERIOD, dryRun: false } });
const st = (await mock('/__mock/state')).dhis2;
check('Envoi réel : 4 valeurs importées dans DHIS2', sent.body.kind === 'DHIS2_SEND' && sent.body.status === 'SUCCESS' && sent.body.imported === 4 && st[`CvSuppr0001.AdultF00001.${PERIOD}.OrgKinsh001`] === String(val(prev, m2.body.id)), { run: sent.body, st });
check('Charge utile et empreinte SHA-256 conservées au journal', sent.body.payloadSha256 === prev.payloadSha256 && sent.body.payload.dataValues.length === 4, sent.body.payloadSha256);
const again = await call('POST', `/interop/endpoints/${DH}/dhis2/send`, { token: bio, body: { period: PERIOD, dryRun: false } });
check('Renvoi à l’identique : valeurs inchangées « ignorées », sans avertissement', again.body.status === 'SUCCESS' && again.body.ignored === 4 && again.body.imported === 0, again.body);
const prev2 = (await call('GET', `/interop/endpoints/${DH}/dhis2/preview?period=${PERIOD}`, { token: qual })).body;
check('Aperçu : dernier envoi et empreinte identique (rien de nouveau à transmettre)', prev2.lastSentAt !== null && prev2.lastSentSha256 === prev2.payloadSha256, prev2);
await call('PUT', `/interop/dhis2-mappings/${m5.body.id}`, { token: qual, body: { label: 'Élément inconnu de DHIS2', parameterId: CV.id, measure: 'VALIDATED_COUNT', dataElement: 'Xunknown001', isActive: true, displayOrder: 9 } });
const conflict = await call('POST', `/interop/endpoints/${DH}/dhis2/send`, { token: bio, body: { period: PERIOD, dryRun: false } });
check('Élément inconnu : envoi partiel (WARNING), conflit E7610 conservé', conflict.body.status === 'WARNING' && conflict.body.conflicts.some((c) => c.errorCode === 'E7610' && c.object === 'Xunknown001'), conflict.body);
check('Suppression de la correspondance (auditée) → 204', (await call('DELETE', `/interop/dhis2-mappings/${m5.body.id}`, { token: qual })).status === 204);
const future = await call('POST', `/interop/endpoints/${DH}/dhis2/send`, { token: bio, body: { period: '209912', dryRun: false } });
check('Période future → 422', future.status === 422 && rule(future) === 'DHIS2_FUTURE_PERIOD', future.body);
await call('POST', `/interop/endpoints/${HIM}/dhis2-mappings`, { token: qual, body: { label: 'CV réalisées', parameterId: CV.id, measure: 'VALIDATED_COUNT', dataElement: 'CvTested001' } });
const himDry = await call('POST', `/interop/endpoints/${HIM}/dhis2/send`, { token: qual, body: { period: PERIOD, dryRun: true } });
check('Simulation via OpenHIM : résumé DHIS2 et transaction OpenHIM', himDry.body.status === 'SUCCESS' && /^[0-9a-f]{24}$/.test(himDry.body.openhimTransactionId ?? ''), himDry.body);

// ============================================================================ VLSM
console.log('\n— Envoi des résultats CV et EID à VLSM');
const vm = (body, id = VL) => call('POST', `/interop/endpoints/${id}/vlsm-mappings`, { token: qual, body });
const vlOnChoice = await vm({ parameterId: EID.id, testType: 'VL' });
check('Charge virale depuis un paramètre à choix → 422', vlOnChoice.status === 422 && rule(vlOnChoice) === 'VLSM_VL_NEEDS_VALUE', vlOnChoice.body);
const eidBad = await vm({ parameterId: EID.id, testType: 'EID', eidPositive: 'POS', eidNegative: 'Négatif' });
check('Valeur EID absente des choix du paramètre → 422', eidBad.status === 422 && rule(eidBad) === 'VLSM_EID_NOT_A_CHOICE', eidBad.body);
const vm1 = await vm({ parameterId: CV.id, testType: 'VL' });
const vm2 = await vm({ parameterId: EID.id, testType: 'EID', eidPositive: 'Positif', eidNegative: 'Négatif', eidIndeterminate: 'Indéterminé' });
check('Correspondances VLSM : CV (VL) et PCR ADN (EID)', vm1.status === 201 && vm2.status === 201, [vm1.body, vm2.body]);
check('Paramètre déjà transmis → 409', (await vm({ parameterId: CV.id, testType: 'VL' })).status === 409);
let pending = (await call('GET', `/interop/endpoints/${VL}/vlsm/pending`, { token: qual })).body;
const pi = (x) => pending.find((p) => p.orderItemId === x.itemId);
check('File d’envoi : nos 5 résultats validés', [A, B, C, Dn, E].every((x) => pi(x)), pending.length);
check('Résultat sans N° TARV bloqué avec la raison', pi(Dn)?.blocker?.includes('TARV') && pi(A)?.blocker === null && pi(A)?.value === '<40' && pi(E)?.testType === 'EID', [pi(A), pi(Dn)]);
const incomplete = await call('POST', `/interop/endpoints/${VL}/vlsm/send`, { token: bio, body: { orderItemIds: [A.itemId, Dn.itemId] } });
check('Envoi avec un résultat incomplet → 422 (rien n’est envoyé)', incomplete.status === 422 && rule(incomplete) === 'VLSM_ITEM_INCOMPLETE' && Object.keys((await mock('/__mock/state')).vlsm).length === 0, incomplete.body);
const notMapped = await call('POST', `/interop/endpoints/${VL}/vlsm/send`, { token: bio, body: { orderItemIds: ['6f1c2f8e-4b7a-4c1e-9a55-2b1f3c4d5e6f'] } });
check('Examen inconnu → 422', notMapped.status === 422 && rule(notMapped) === 'VLSM_ITEM_NOT_ELIGIBLE', notMapped.body);
const vs = await call('POST', `/interop/endpoints/${VL}/vlsm/send`, { token: bio, body: { orderItemIds: [A.itemId, B.itemId, C.itemId, E.itemId] } });
check('Envoi VLSM : 4/4 acceptés, codes VLSM conservés', vs.status === 200 && vs.body.status === 'SUCCESS' && vs.body.submissions.length === 4 && vs.body.submissions.every((s) => s.status === 'SENT' && /^(VL|EID)26\d{5}$/.test(s.remoteSampleCode)), vs.body);
const vstate = (await mock('/__mock/state')).vlsm;
const recA = Object.values(vstate).find((r) => r.record.appSampleCode === A.sample)?.record;
const recE = Object.values(vstate).find((r) => r.record.appSampleCode === E.sample);
check('Enregistrement VL : N° TARV, « <40 », statut 7, date au format VLSM', recA?.patientArtNo === `TARV-${RUN}-A` && recA.vlResult === '<40' && recA.resultStatus === '7' && /^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}$/.test(recA.sampleCollectionDate) && recA.labId === '16' && recA.patientGender === 'female', recA);
check('Enregistrement EID sur /eid/save-request.php : résultat « negative », DBS → type 5', recE?.testType === 'eid' && recE.record.result === 'negative' && recE.record.specimenType === '5' && recE.record.childId === `EID-${RUN}-1`, recE);
const vlReq = (await mock('/__mock/requests')).filter((r) => r.path.endsWith('/vl/save-request.php')).pop();
check('Authentification VLSM par jeton Bearer obtenu à la connexion', vlReq?.authorization?.startsWith('Bearer ') && vlReq.authorization !== 'Bearer vlsm-static-token' && vlReq.body.appVersion.startsWith('LIMS'), vlReq?.authorization);
const runDetail = await call('GET', `/interop/runs/${vs.body.id}`, { token: qual });
check('Journal expurgé des données patient (empreinte du contenu envoyé conservée)', runDetail.status === 200 && !runDetail.text.includes(A.pat.lastName) && !runDetail.text.includes(`TARV-${RUN}-A`) && /^[0-9a-f]{64}$/.test(runDetail.body.payloadSha256), runDetail.text.slice(0, 300));
pending = (await call('GET', `/interop/endpoints/${VL}/vlsm/pending`, { token: qual })).body;
check('Résultats acceptés retirés de la file', !pi(A) && !pi(E) && pi(Dn), pending.length);
const resend = await call('POST', `/interop/endpoints/${VL}/vlsm/send`, { token: bio, body: { orderItemIds: [A.itemId] } });
check('Renvoi d’un résultat déjà accepté → 422', resend.status === 422 && rule(resend) === 'VLSM_ALREADY_SENT', resend.body);

console.log('\n— Correction après validation, échecs, OpenHIM');
const amend = await call('POST', `/results/items/${A.itemId}/amend`, { token: bio, body: { reason: 'Erreur de transcription de la charge virale' } });
const itemA = (await call('GET', `/results/orders/${A.order.id}`, { token: tech })).body.items[0];
await call('PUT', `/results/items/${A.itemId}`, { token: tech, body: { results: [{ resultId: itemA.results[0].id, value: '<20' }] } });
await call('POST', `/results/items/${A.itemId}/technical-validation`, { token: tech });
await call('POST', `/results/items/${A.itemId}/biological-validation`, { token: bio, body: {} });
pending = (await call('GET', `/interop/endpoints/${VL}/vlsm/pending`, { token: qual })).body;
check('Résultat corrigé : de nouveau dans la file, version 2', amend.status === 200 && pi(A)?.itemVersion === 2 && pi(A)?.value === '<20' && pi(A)?.lastAttempt?.status === 'SENT', pi(A));
const upd = await call('POST', `/interop/endpoints/${VL}/vlsm/send`, { token: bio, body: { orderItemIds: [A.itemId] } });
const recA2 = Object.values((await mock('/__mock/state')).vlsm).find((r) => r.record.appSampleCode === A.sample);
check('Correction transmise : même enregistrement VLSM mis à jour (uniqueId stable)', upd.body.status === 'SUCCESS' && recA2.versions === 2 && recA2.record.vlResult === '<20' && upd.body.submissions[0].message === 'updated', { run: upd.body, recA2 });

const P = await flow({ sex: 'MALE', birthDate: '1975-01-20', externalId: `TARV-${RUN}-P`, examId: cvExam.id, value: '1200' });
await vm({ parameterId: CV.id, testType: 'VL' }, VH);
const { secret: _vs, ...vlsmNoSecret } = vlsmBody;
const vhNoBody = { ...vlsmNoSecret, code: `HIM-VLSM-${RUN}`, name: `VLSM via OpenHIM (${RUN})`, transport: 'OPENHIM', baseUrl: `${MOCK}/openhim/vlsm`, username: 'lims-client' };
await call('PUT', `/interop/endpoints/${VH}`, { token: admin, body: { ...vhNoBody, settings: { ...vlsmSettings, facilityId: 999 } } });
const fail = await call('POST', `/interop/endpoints/${VH}/vlsm/send`, { token: bio, body: { orderItemIds: [P.itemId] } });
check('Structure inconnue de VLSM : échec journalisé (ERROR, envoi FAILED avec le motif)', fail.body.status === 'ERROR' && fail.body.submissions[0]?.status === 'FAILED' && fail.body.submissions[0].message === 'Facility not found', fail.body);
pending = (await call('GET', `/interop/endpoints/${VH}/vlsm/pending`, { token: qual })).body;
check('Résultat en échec maintenu dans la file avec la dernière tentative', pi(P)?.lastAttempt?.status === 'FAILED', pi(P));
await call('PUT', `/interop/endpoints/${VH}`, { token: admin, body: vhNoBody });
const ok = await call('POST', `/interop/endpoints/${VH}/vlsm/send`, { token: bio, body: { orderItemIds: [P.itemId] } });
check('Nouvel essai via OpenHIM : accepté, transaction OpenHIM conservée', ok.body.status === 'SUCCESS' && /^[0-9a-f]{24}$/.test(ok.body.openhimTransactionId ?? ''), ok.body);
await call('PUT', `/interop/endpoints/${VL}`, { token: admin, body: { ...vlsmBody, secret: 'expiré' } });
const Q = await flow({ sex: 'FEMALE', birthDate: '1992-07-07', externalId: `TARV-${RUN}-Q`, examId: cvExam.id, value: '80' });
const authFail = await call('POST', `/interop/endpoints/${VL}/vlsm/send`, { token: bio, body: { orderItemIds: [Q.itemId] } });
check('Connexion VLSM refusée au moment de l’envoi : ERROR, aucun résultat marqué envoyé', authFail.body.status === 'ERROR' && authFail.body.submissions[0]?.status === 'FAILED' && authFail.body.message.includes('refusé'), authFail.body);

// ============================================================================ Journal, désactivation, audit
console.log('\n— Journal des échanges et traçabilité');
runs = await call('GET', `/interop/runs?endpointId=${DH}&pageSize=50`, { token: qual });
check('Journal DHIS2 : tests, simulation et envois, avec l’auteur', runs.status === 200 && runs.body.items.some((r) => r.kind === 'DHIS2_DRY_RUN') && runs.body.items.filter((r) => r.kind === 'DHIS2_SEND').length >= 3 && runs.body.items.every((r) => r.kind === 'CONNECTION_TEST' || r.triggeredBy), runs.body.items.map((r) => [r.kind, r.triggeredBy]));
check('Filtre par statut', (await call('GET', `/interop/runs?status=ERROR&pageSize=100`, { token: qual })).body.items.every((r) => r.status === 'ERROR'));
check('Le technicien n’accède pas au journal → 403', (await call('GET', '/interop/runs', { token: tech })).status === 403);
const psql = spawnSync('psql', [process.env.DATABASE_URL?.replace(/\?.*$/, '') ?? '', '-tAc', `UPDATE interop_runs SET message = 'x' WHERE id = '${sent.body.id}'`], { encoding: 'utf8' });
if (psql.error) console.log('  (psql absent : contrôle du journal en ajout seul non exécuté)');
else check('Journal en ajout seul : modification refusée par la base', psql.status !== 0 && /ajout seul/.test(psql.stderr), psql.stderr);
for (const id of [DH, HIM, VL, VH, badHim.body.id, slow.body.id, down.body.id, vBad.body.id]) {
  const cur = (await call('GET', `/interop/endpoints/${id}`, { token: admin })).body;
  await call('PUT', `/interop/endpoints/${id}`, { token: admin, body: { code: cur.code, name: cur.name, system: cur.system, transport: cur.transport, baseUrl: cur.baseUrl, authMode: cur.authMode, username: cur.username, timeoutSeconds: cur.timeoutSeconds, settings: cur.settings, isActive: false } });
}
const inactive = await call('POST', `/interop/endpoints/${DH}/dhis2/send`, { token: bio, body: { period: PERIOD, dryRun: true } });
check('Connexion désactivée : envoi refusé → 422', inactive.status === 422 && rule(inactive) === 'INTEROP_ENDPOINT_INACTIVE', inactive.body);
const verify = await call('GET', '/audit/verify', { token: admin });
check('Chaîne d’audit intègre', verify.body.valid === true, verify.body);

console.log(failures === 0 ? '\nÉtape 7 : tous les contrôles sont passés.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
