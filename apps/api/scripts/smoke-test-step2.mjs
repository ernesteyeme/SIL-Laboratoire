// Test de fumée de l'étape 2 (référentiels). À lancer APRÈS smoke-test.mjs sur une base de test,
// avec le catalogue de démarrage chargé (pnpm db:seed:catalog).
// Usage : node --env-file=.env scripts/smoke-test-step2.mjs [http://localhost:3000/api]
// Attention : crée des données de test. Ne jamais lancer en production.
const BASE = process.argv[2] ?? 'http://localhost:3000/api';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'NouveauAdmin#2026';
const SEED_USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'admin';
const RUN = Date.now().toString(36).slice(-5);
// Noms aléatoires à chaque passage : sinon la détection de doublons signale (à raison) les patients des passages précédents.
const syllables = ['ka', 'mbu', 'lu', 'tshi', 'ngo', 'mwa', 'ba', 'ki', 'se', 'zo', 'ny', 'ra', 'fu', 'do', 'pe', 'gi'];
const word = () => Array.from({ length: 4 }, () => syllables[Math.floor(Math.random() * syllables.length)]).join('');
const cap = (w) => w[0].toUpperCase() + w.slice(1);
// Date de naissance variable : un homonyme d'une exécution précédente ne doit pas fausser le test.
const HOMONYM_BIRTH = `19${50 + Math.floor(Math.random() * 20)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
const LAST = cap(word());
const MIDDLE = cap(word());
const FIRST = `Élo-${cap(word())}`;
let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✔' : '✘'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
  if (!cond) failures++;
};

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(username, password) {
  const r = await call('POST', '/auth/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`Connexion ${username} impossible : ${JSON.stringify(r.body)}`);
  return r.body.accessToken;
}

async function createStaff(adminToken, username, roles) {
  const temp = 'Temp#Smoke2026';
  const finalPw = 'Final#Smoke2026';
  const c = await call('POST', '/users', { token: adminToken, body: { username, fullName: `Test ${username}`, roles, temporaryPassword: temp } });
  if (c.status !== 201) throw new Error(`Création ${username} : ${JSON.stringify(c.body)}`);
  const t = await login(username, temp);
  const cp = await call('POST', '/auth/change-password', { token: t, body: { currentPassword: temp, newPassword: finalPw, confirmPassword: finalPw } });
  return cp.body.accessToken;
}

const admin = await login(SEED_USERNAME, ADMIN_PASSWORD);
const reception = await createStaff(admin, `recep.${RUN}`, ['RECEPTION']);
const bio = await createStaff(admin, `bio.${RUN}`, ['BIOLOGISTE']);
const compta = await createStaff(admin, `compta.${RUN}`, ['COMPTABLE']);

// ---------------------------------------------------------------- Patients
console.log('\n— Patients');
const p1Body = {
  lastName: LAST, middleName: MIDDLE, firstName: FIRST, sex: 'FEMALE',
  birthDate: '1990-05-20', phone: '+243 8' + String(Math.floor(1e8 + Math.random() * 8.9e8)).replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3'), city: 'Kinshasa',
};
const p1 = await call('POST', '/patients', { token: reception, body: p1Body });
check('Réception crée un patient → 201 avec code PAT-xxxxxx', p1.status === 201 && /^PAT-\d{6}$/.test(p1.body.code), p1.body);
check('Nom formaté NOM POSTNOM Prénom', p1.body.fullName === `${LAST.toUpperCase()} ${MIDDLE.toUpperCase()} ${FIRST}`, p1.body.fullName);

const dupBody = { ...p1Body, lastName: p1Body.firstName, firstName: p1Body.lastName.toUpperCase(), middleName: MIDDLE.toUpperCase(), phone: null };
const dupCheck = await call('POST', '/patients/duplicates', { token: reception, body: { lastName: dupBody.lastName, middleName: dupBody.middleName, firstName: dupBody.firstName, sex: 'FEMALE', birthDate: '1990-05-20' } });
check('Contrôle doublons (ordre des noms inversé, sans accents) → candidat trouvé', dupCheck.status === 200 && dupCheck.body[0]?.patient.id === p1.body.id && dupCheck.body[0].score >= 0.9, dupCheck.body);

const dup = await call('POST', '/patients', { token: reception, body: dupBody });
check('Création d’un doublon probable → 409 DUPLICATE_SUSPECTED avec candidats', dup.status === 409 && dup.body.code === 'DUPLICATE_SUSPECTED' && dup.body.details.candidates.length >= 1, dup.body);

const localPhone = '0' + p1.body.phone.replace(/\D/g, '').slice(-9);
const phoneDup = await call('POST', '/patients/duplicates', { token: reception, body: { lastName: LAST, middleName: MIDDLE, phone: localPhone } });
check('Même téléphone dans un autre format → motif « Même numéro de téléphone »', phoneDup.body.some((c) => c.patient.id === p1.body.id && c.reasons.includes('Même numéro de téléphone')), phoneDup.body);
const familyPhone = await call('POST', '/patients/duplicates', { token: reception, body: { lastName: 'Tshisekedi', firstName: 'Paul', phone: localPhone } });
check('Même téléphone mais nom sans rapport (téléphone familial) → non signalé', !familyPhone.body.some((c) => c.patient.id === p1.body.id), familyPhone.body);

const homonym = await call('POST', '/patients', { token: reception, body: { ...p1Body, phone: null, birthDate: HOMONYM_BIRTH } });
check('Homonyme d’une autre génération → pas bloqué (201)', homonym.status === 201, homonym.body);

const forced = await call('POST', '/patients', { token: reception, body: { ...dupBody, confirmNotDuplicate: true } });
check('Doublon confirmé par l’opérateur → 201', forced.status === 201, forced.body);
const forcedAudit = await call('GET', `/audit?entity=Patient&entityId=${forced.body.id}`, { token: admin });
check('Audit : motif de création malgré doublon consigné', forcedAudit.body.items[0]?.reason?.includes(p1.body.code), forcedAudit.body.items[0]);

const bad = await call('POST', '/patients', { token: reception, body: { lastName: '', sex: 'X', birthDate: '2999-01-01', email: 'pas-un-mail' } });
check('Patient invalide → 400 avec erreurs par champ', bad.status === 400 && ['lastName', 'sex', 'birthDate', 'email'].every((f) => bad.body.details.some((d) => d.path === f)), bad.body);

const search1 = await call('GET', `/patients?q=${encodeURIComponent(FIRST.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() + ' ' + LAST.toLowerCase())}`, { token: reception });
check('Recherche par nom sans accents, ordre libre', search1.body.items.some((p) => p.id === p1.body.id), search1.body.total);
const search2 = await call('GET', `/patients?q=${p1.body.code}`, { token: reception });
check('Recherche par code patient', search2.body.items.length === 1 && search2.body.items[0].id === p1.body.id, search2.body.total);

const upd = await call('PATCH', `/patients/${p1.body.id}`, { token: reception, body: { city: 'Lubumbashi', birthDate: '1990-05-21' } });
check('Modification patient → 200', upd.status === 200 && upd.body.city === 'Lubumbashi' && upd.body.birthDate === '1990-05-21', upd.body);
const updAudit = await call('GET', `/audit?entity=Patient&entityId=${p1.body.id}&action=UPDATE`, { token: admin });
check('Audit UPDATE avec date avant/après', updAudit.body.items[0]?.before.birthDate === '1990-05-20' && updAudit.body.items[0]?.after.birthDate === '1990-05-21', updAudit.body.items[0]);

const comptaRead = await call('GET', '/patients', { token: compta });
check('Comptable sans accès aux dossiers patients → 403', comptaRead.status === 403, comptaRead.body);
const bioWrite = await call('PATCH', `/patients/${p1.body.id}`, { token: bio, body: { city: 'X' } });
check('Biologiste ne modifie pas l’identité patient → 403', bioWrite.status === 403, bioWrite.body);
const recepDeact = await call('POST', `/patients/${forced.body.id}/deactivate`, { token: reception, body: { reason: 'Doublon fusionné' } });
check('Réception ne désactive pas un dossier → 403', recepDeact.status === 403, recepDeact.body);
const deact = await call('POST', `/patients/${forced.body.id}/deactivate`, { token: admin, body: { reason: `Doublon de ${p1.body.code}` } });
check('Admin désactive le doublon → 200', deact.status === 200 && deact.body.isActive === false, deact.body);
const updInactive = await call('PATCH', `/patients/${forced.body.id}`, { token: reception, body: { city: 'X' } });
check('Modification d’un dossier désactivé → 422', updInactive.status === 422, updInactive.body);

// ---------------------------------------------------------------- Prescripteurs
console.log('\n— Prescripteurs');
const lic = `CNOM-${RUN}`;
const pr = await call('POST', '/prescribers', { token: reception, body: { title: 'Dr', lastName: 'Kabongo', firstName: 'Jean', facility: 'HGR Kinshasa', licenseNumber: lic } });
check('Création prescripteur → 201', pr.status === 201 && pr.body.displayName === 'Dr KABONGO Jean', pr.body);
const prDup = await call('POST', '/prescribers', { token: reception, body: { lastName: 'Autre', licenseNumber: lic } });
check('N° d’Ordre en double → 409', prDup.status === 409, prDup.body);
const prNoReason = await call('PATCH', `/prescribers/${pr.body.id}`, { token: reception, body: { isActive: false } });
check('Désactivation sans motif → 400', prNoReason.status === 400, prNoReason.body);
const prDeact = await call('PATCH', `/prescribers/${pr.body.id}`, { token: reception, body: { isActive: false, reason: 'A quitté la structure' } });
check('Désactivation avec motif → 200', prDeact.status === 200 && !prDeact.body.isActive, prDeact.body);
const prSearch = await call('GET', `/prescribers?q=kabongo&status=all`, { token: reception });
check('Recherche prescripteur', prSearch.body.items.some((p) => p.id === pr.body.id), prSearch.body.total);

// ---------------------------------------------------------------- Catalogue
console.log('\n— Catalogue');
const sections = await call('GET', '/catalog/sections', { token: compta });
check('Sections lisibles par tout rôle', sections.status === 200 && sections.body.length >= 6, sections.body.length);
const sampleTypes = await call('GET', '/catalog/sample-types', { token: reception });
const nfsList = await call('GET', '/catalog/exams?q=NFS', { token: reception });
const nfs = await call('GET', `/catalog/exams/${nfsList.body.items[0].id}`, { token: reception });
check('Détail NFS : 4 paramètres et valeurs de référence', nfs.body.parameters.length === 4 && nfs.body.parameters[0].referenceRanges.length === 3, nfs.body.parameters?.length);
check('Tarif renvoyé en chaîne décimale', nfs.body.price === '8000.00', nfs.body.price);

const hema = sections.body.find((s) => s.code === 'HEMATO');
const edta = sampleTypes.body.find((s) => s.code === 'ST-EDTA');
const sectDeact = await call('PATCH', `/catalog/sections/${hema.id}`, { token: admin, body: { isActive: false, reason: 'Réorganisation' } });
check('Désactiver une section avec examens actifs → 422', sectDeact.status === 422 && sectDeact.body.details.rule === 'SECTION_HAS_ACTIVE_EXAMS', sectDeact.body);
const bioSection = await call('POST', '/catalog/sections', { token: bio, body: { code: 'X', name: 'Xx' } });
check('Biologiste ne crée pas de section → 403', bioSection.status === 403, bioSection.body);

const code = `VS${RUN}`.toUpperCase().slice(0, 20);
const vs = await call('POST', '/catalog/exams', { token: bio, body: { code, name: 'Vitesse de sédimentation', sectionId: hema.id, sampleTypeId: edta.id, price: '2 500', turnaroundHours: 2 } });
check('Biologiste crée un examen → 201, inactif par défaut, tarif normalisé', vs.status === 201 && vs.body.isActive === false && vs.body.price === '2500.00', vs.body);
const act0 = await call('PATCH', `/catalog/exams/${vs.body.id}`, { token: bio, body: { isActive: true, reason: 'Validation de la méthode' } });
check('Activation sans paramètre → 422 EXAM_WITHOUT_PARAMETERS', act0.status === 422 && act0.body.details.rule === 'EXAM_WITHOUT_PARAMETERS', act0.body);

const param = await call('POST', `/catalog/exams/${vs.body.id}/parameters`, { token: bio, body: { code: 'vs1h', name: 'VS 1re heure', resultType: 'NUMERIC', unit: 'mm', decimals: 0 } });
check('Ajout paramètre (code normalisé en majuscules) → 201', param.status === 201 && param.body.code === 'VS1H', param.body);
const paramDup = await call('POST', `/catalog/exams/${vs.body.id}/parameters`, { token: bio, body: { code: 'VS1H', name: 'x', resultType: 'NUMERIC' } });
check('Code de paramètre en double → 409', paramDup.status === 409, paramDup.body);
const badChoice = await call('POST', `/catalog/exams/${vs.body.id}/parameters`, { token: bio, body: { code: 'ASPECT', name: 'Aspect', resultType: 'CHOICE', choices: ['Clair'] } });
check('Liste de choix à 1 valeur → 400', badChoice.status === 400, badChoice.body);

const adult = Math.round(18 * 365.25);
const rM = await call('POST', `/catalog/parameters/${param.body.id}/reference-ranges`, { token: bio, body: { sex: 'MALE', ageMinDays: adult, ageMaxDays: null, high: '15' } });
check('Valeur de référence hommes ≥ 18 ans → 201', rM.status === 201 && rM.body.high === 15, rM.body);
const rOverlap = await call('POST', `/catalog/parameters/${param.body.id}/reference-ranges`, { token: bio, body: { sex: 'MALE', ageMinDays: adult * 2, ageMaxDays: null, high: 20 } });
check('Chevauchement → 422 RANGE_OVERLAP', rOverlap.status === 422 && rOverlap.body.details.rule === 'RANGE_OVERLAP', rOverlap.body);
const rF = await call('POST', `/catalog/parameters/${param.body.id}/reference-ranges`, { token: bio, body: { sex: 'FEMALE', ageMinDays: adult, ageMaxDays: null, high: 20 } });
check('Plage femmes sur la même tranche → 201', rF.status === 201, rF.body);
const rBad = await call('POST', `/catalog/parameters/${param.body.id}/reference-ranges`, { token: bio, body: { ageMaxDays: null, low: 30, high: 10 } });
check('Bornes inversées → 400', rBad.status === 400, rBad.body);
const rText = await call('POST', `/catalog/parameters/${param.body.id}/reference-ranges`, { token: bio, body: { ageMinDays: 0, ageMaxDays: adult, normalText: 'Normal' } });
check('Valeur texte sur paramètre numérique → 422', rText.status === 422, rText.body);
const rUpdNoReason = await call('PUT', `/catalog/reference-ranges/${rM.body.id}`, { token: bio, body: { sex: 'MALE', ageMinDays: adult, ageMaxDays: null, high: 12 } });
check('Modification d’une valeur de référence sans motif → 422', rUpdNoReason.status === 422, rUpdNoReason.body);
const rUpd = await call('PUT', `/catalog/reference-ranges/${rM.body.id}`, { token: bio, body: { sex: 'MALE', ageMinDays: adult, ageMaxDays: null, high: 12, reason: 'Alignement sur la notice fournisseur v3' } });
check('Modification avec motif → 200', rUpd.status === 200 && rUpd.body.high === 12, rUpd.body);

const act1 = await call('PATCH', `/catalog/exams/${vs.body.id}`, { token: bio, body: { isActive: true, reason: 'Validation de la méthode' } });
check('Activation avec paramètre → 200', act1.status === 200 && act1.body.isActive, act1.body);
const lastParam = await call('PATCH', `/catalog/parameters/${param.body.id}`, { token: bio, body: { isActive: false, reason: 'Paramètre obsolète' } });
check('Désactiver le dernier paramètre d’un examen actif → 422', lastParam.status === 422 && lastParam.body.details.rule === 'LAST_ACTIVE_PARAMETER', lastParam.body);
const typeChange = await call('PATCH', `/catalog/parameters/${param.body.id}`, { token: bio, body: { resultType: 'TEXT' } });
check('Changer le type d’un paramètre ayant des valeurs de référence → 422', typeChange.status === 422 && typeChange.body.details.rule === 'TYPE_CHANGE_WITH_RANGES', typeChange.body);

const bioPrice = await call('PATCH', `/catalog/exams/${vs.body.id}`, { token: bio, body: { price: '3000' } });
check('Biologiste modifie le tarif → 403', bioPrice.status === 403, bioPrice.body);
const adminPrice = await call('PATCH', `/catalog/exams/${vs.body.id}`, { token: admin, body: { price: '3000' } });
check('Admin modifie le tarif → 200', adminPrice.status === 200 && adminPrice.body.price === '3000.00', adminPrice.body);
const priceAudit = await call('GET', `/audit?entity=Exam&entityId=${vs.body.id}&action=UPDATE`, { token: admin });
check('Audit du changement de tarif (avant/après)', priceAudit.body.items[0]?.before.price === '2500.00' && priceAudit.body.items[0]?.after.price === '3000.00', priceAudit.body.items[0]);

const delNoReason = await call('DELETE', `/catalog/reference-ranges/${rF.body.id}`, { token: bio });
check('Suppression d’une valeur de référence sans motif → 400', delNoReason.status === 400, delNoReason.body);
const del = await call('DELETE', `/catalog/reference-ranges/${rF.body.id}`, { token: bio, body: { reason: 'Saisie erronée' } });
check('Suppression avec motif → 204', del.status === 204, del.body);
const delAudit = await call('GET', `/audit?entity=ReferenceRange&entityId=${rF.body.id}&action=DELETE`, { token: admin });
check('Audit de suppression avec l’état antérieur', delAudit.body.items[0]?.before?.high === '20', delAudit.body.items[0]);

const verify = await call('GET', '/audit/verify', { token: admin });
check('Chaîne d’audit toujours intègre', verify.body.valid === true, verify.body);

console.log(failures === 0 ? '\nTOUS LES CONTRÔLES SONT PASSÉS' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
