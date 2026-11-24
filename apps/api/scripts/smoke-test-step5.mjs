// Test de fumée de l'étape 5 (qualité) : contrôle qualité interne et règles de Westgard, blocage de la validation,
// actions correctives, fiches de non-conformité, indicateurs.
// À lancer APRÈS smoke-test.mjs sur une base de TEST avec le catalogue de démarrage (pnpm db:seed:catalog).
// Usage : node --env-file=.env scripts/smoke-test-step5.mjs [http://localhost:3000/api]
// Attention : crée des données (lots de contrôle désactivés en fin de test). Jamais en production.

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
const rule = (r) => r.body?.details?.rule;

async function call(method, path, { token, body } = {}) {
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
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
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
const syl = ['ka', 'mbu', 'lu', 'tshi', 'ngo', 'mwa', 'ba', 'ki', 'se', 'zo', 'ny', 'ra', 'fu', 'do'];
const word = () => { const w = Array.from({ length: 4 }, () => syl[Math.floor(Math.random() * syl.length)]).join(''); return w[0].toUpperCase() + w.slice(1); };
const iso = (d) => d.toISOString().slice(0, 10);

const admin = await login(SEED_USERNAME, ADMIN_PASSWORD);
const tech = await createStaff(admin, `tec5.${RUN}`, ['TECHNICIEN']);
const bio = await createStaff(admin, `bio5.${RUN}`, ['BIOLOGISTE']);
const qualite = await createStaff(admin, `qua5.${RUN}`, ['QUALITE']);
const caisse = await createStaff(admin, `cai5.${RUN}`, ['CAISSE', 'RECEPTION']);
const compta = await createStaff(admin, `cpt5.${RUN}`, ['COMPTABLE']);

const settings0 = (await call('GET', '/settings/lab', { token: admin })).body;
const { updatedAt: _u, secondaryCurrency: _s, ...settingsRest } = settings0;
await call('PUT', '/settings/lab', { token: admin, body: { ...settingsRest, requirePaymentBeforeCollection: false } });

const examsList = (await call('GET', '/catalog/exams?pageSize=100', { token: tech })).body.items;
const examByCode = Object.fromEntries(examsList.map((e) => [e.code, e]));
const glyExam = (await call('GET', `/catalog/exams/${examByCode.GLY.id}`, { token: tech })).body;
const geExam = (await call('GET', `/catalog/exams/${examByCode.GE.id}`, { token: tech })).body;
const gly = glyExam.parameters.find((p) => p.code === 'GLY');
const geParam = geExam.parameters[0];

// ============================================================================ Configuration
console.log('\n— Lots et cibles de contrôle');
const matBody = (level) => ({ name: `Contrôle Chimie ${RUN}`, manufacturer: 'BioRef', lotNumber: `L${RUN}`, level, expiresOn: '2027-12-31', sectionId: glyExam.section?.id ?? null });
const techMat = await call('POST', '/qc/materials', { token: tech, body: matBody('Niveau 1') });
check('Le technicien ne configure pas les lots → 403', techMat.status === 403, techMat.body);
const n1 = await call('POST', '/qc/materials', { token: qualite, body: matBody('Niveau 1 (normal)') });
const n2 = await call('POST', '/qc/materials', { token: bio, body: matBody('Niveau 2 (pathologique)') });
check('Création de deux niveaux de contrôle (qualité, biologiste)', n1.status === 201 && n2.status === 201, [n1.body, n2.body]);
const dup = await call('POST', '/qc/materials', { token: qualite, body: matBody('Niveau 1 (normal)') });
check('Lot en double → 409', dup.status === 409, dup.body);
const badExp = await call('POST', '/qc/materials', { token: qualite, body: { ...matBody('Niveau 3'), expiresOn: '2027-02-30' } });
check('Date de péremption invalide → 400', badExp.status === 400, badExp.body);
const qualTarget = await call('PUT', `/qc/materials/${n1.body.id}/targets`, { token: qualite, body: { parameterId: geParam.id, mean: 1, sd: 0.1, source: 'MANUFACTURER' } });
check('Cible sur un paramètre qualitatif → 422 QC_PARAMETER_NOT_NUMERIC', qualTarget.status === 422 && rule(qualTarget) === 'QC_PARAMETER_NOT_NUMERIC', qualTarget.body);
const sd0 = await call('PUT', `/qc/materials/${n1.body.id}/targets`, { token: qualite, body: { parameterId: gly.id, mean: '0,90', sd: '0', source: 'MANUFACTURER' } });
check('Écart-type nul → 400', sd0.status === 400, sd0.body);
const t1 = await call('PUT', `/qc/materials/${n1.body.id}/targets`, { token: qualite, body: { parameterId: gly.id, mean: '0,95', sd: '0,05', source: 'MANUFACTURER' } });
const t2 = await call('PUT', `/qc/materials/${n2.body.id}/targets`, { token: qualite, body: { parameterId: gly.id, mean: 2.5, sd: 0.1, source: 'MANUFACTURER' } });
check('Cibles glucose : N1 0,95 ± 0,05 (CV 5,26 %), N2 2,5 ± 0,1', t1.status === 200 && t2.status === 200 && t1.body.cvPercent === 5.26, [t1.body, t2.body]);
const noReason = await call('PUT', `/qc/materials/${n1.body.id}/targets`, { token: qualite, body: { parameterId: gly.id, mean: 0.9, sd: 0.05, source: 'MANUFACTURER' } });
check('Modification de cible sans motif → 422 TARGET_REASON_REQUIRED', noReason.status === 422 && rule(noReason) === 'TARGET_REASON_REQUIRED', noReason.body);
const fixed = await call('PUT', `/qc/materials/${n1.body.id}/targets`, { token: qualite, body: { parameterId: gly.id, mean: 0.9, sd: 0.05, source: 'MANUFACTURER', reason: 'Erreur de recopie de la notice du lot' } });
check('Modification de cible avec motif', fixed.status === 200 && fixed.body.mean === 0.9 && fixed.body.id === t1.body.id, fixed.body);
const T1 = t1.body.id;
const T2 = t2.body.id;

// ============================================================================ Patient en cours sur le même paramètre
const patient = (await call('POST', '/patients', { token: caisse, body: { lastName: word(), firstName: word(), sex: 'MALE', birthDate: '1980-02-0' + (1 + (Date.now() % 9)) } })).body;
const order = (await call('POST', '/orders', { token: caisse, body: { patientId: patient.id, examIds: [examByCode.GLY.id] } })).body;
const sample = order.samples[0];
await call('POST', `/samples/${sample.id}/collect`, { token: caisse, body: {} });
await call('POST', `/samples/${sample.id}/receive`, { token: tech });

// ============================================================================ Séries
console.log('\n— Séries de contrôle et règles de Westgard');
const caisseRun = await call('POST', '/qc/runs', { token: caisse, body: { parameterId: gly.id, results: [{ targetId: T1, value: 0.9 }] } });
check('La caisse ne saisit pas de CIQ → 403', caisseRun.status === 403, caisseRun.body);
const dupLevel = await call('POST', '/qc/runs', { token: tech, body: { parameterId: gly.id, results: [{ targetId: T1, value: 0.9 }, { targetId: T1, value: 0.91 }] } });
check('Même niveau deux fois dans une série → 400', dupLevel.status === 400, dupLevel.body);
const future = await call('POST', '/qc/runs', { token: tech, body: { parameterId: gly.id, performedAt: new Date(Date.now() + 86_400_000).toISOString(), results: [{ targetId: T1, value: 0.9 }] } });
check('Heure de passage future → 400', future.status === 400, future.body);
const ok1 = await call('POST', '/qc/runs', { token: tech, body: { parameterId: gly.id, results: [{ targetId: T1, value: '0,91' }, { targetId: T2, value: '2,46' }] } });
check('Série 1 : z +0,2 / −0,4 → acceptée', ok1.status === 201 && ok1.body.status === 'ACCEPTED' && ok1.body.results.map((r) => r.z).join() === '0.2,-0.4', ok1.body);
const warn = await call('POST', '/qc/runs', { token: tech, body: { parameterId: gly.id, results: [{ targetId: T1, value: 0.89 }, { targetId: T2, value: 2.72 }] } });
check('Série 2 : N2 à +2,2 ET → avertissement 1-2s (utilisable)', warn.body.status === 'WARNING' && warn.body.rules.join() === '1-2s', warn.body);

// Résultat patient saisi après le dernier CIQ acceptable
const res0 = (await call('GET', `/results/orders/${order.id}`, { token: tech })).body;
const item = res0.items[0];
await call('PUT', `/results/items/${item.id}`, { token: tech, body: { results: [{ resultId: item.results[0].id, value: '1,02' }] } });

const rej = await call('POST', '/qc/runs', { token: tech, body: { parameterId: gly.id, results: [{ targetId: T1, value: 0.88 }, { targetId: T2, value: 2.75 }], comment: 'Après changement de flacon de réactif' } });
check('Série 3 : N2 à +2,5 ET après +2,2 ET → rejet 2-2s', rej.body.status === 'REJECTED' && rej.body.rules.join() === '2-2s', rej.body);
check('Fiche de non-conformité ouverte automatiquement (NC-AAAA-NNNN)', /^NC-\d{4}-\d{4}$/.test(rej.body.qualityIssue?.number ?? '') && rej.body.qualityIssue.status === 'OPEN', rej.body.qualityIssue);
check('Résultats patients à réévaluer listés (depuis le dernier CIQ acceptable)', rej.body.impactedResults.some((r) => r.orderNumber === order.number && r.value === '1,02'), rej.body.impactedResults);

const status1 = (await call('GET', '/qc/status', { token: tech })).body.find((s) => s.parameter.id === gly.id);
check('Tableau de bord CIQ : glucose bloquant, passé aujourd’hui', status1?.blocking === true && status1.ranToday === true && status1.lastRun.status === 'REJECTED', status1);
const blocked = await call('POST', `/results/items/${item.id}/technical-validation`, { token: tech });
check('Validation technique d’un glucose patient bloquée → 422 QC_REJECTED', blocked.status === 422 && rule(blocked) === 'QC_REJECTED', blocked.body);
const again = await call('POST', '/qc/runs', { token: tech, body: { parameterId: gly.id, results: [{ targetId: T1, value: 0.9 }, { targetId: T2, value: 2.5 }] } });
check('Nouvelle série avant action corrective → 422 QC_ACTION_REQUIRED', again.status === 422 && rule(again) === 'QC_ACTION_REQUIRED', again.body);
const shortAction = await call('POST', `/qc/runs/${rej.body.id}/corrective-action`, { token: tech, body: { correctiveAction: 'ok' } });
check('Action corrective trop courte → 400', shortAction.status === 400, shortAction.body);
const action = await call('POST', `/qc/runs/${rej.body.id}/corrective-action`, { token: tech, body: { correctiveAction: 'Nouveau flacon de réactif, recalibration 2 points, contrôles repassés.' } });
check('Action corrective documentée (qui, quand)', action.status === 200 && action.body.resolvedBy === `Test tec5.${RUN}` && !!action.body.resolvedAt, action.body);
const stillBlocked = await call('POST', `/results/items/${item.id}/technical-validation`, { token: tech });
check('Toujours bloqué tant qu’aucune série n’est acceptée après le rejet', stillBlocked.status === 422 && rule(stillBlocked) === 'QC_REJECTED', stillBlocked.body);
const ok2 = await call('POST', '/qc/runs', { token: tech, body: { parameterId: gly.id, results: [{ targetId: T1, value: 0.92 }, { targetId: T2, value: 2.53 }] } });
check('Série 4 après action corrective : acceptée', ok2.status === 201 && ok2.body.status === 'ACCEPTED', ok2.body);
const unblocked = await call('POST', `/results/items/${item.id}/technical-validation`, { token: tech });
check('Validation technique du patient débloquée', unblocked.status === 200 && unblocked.body.status === 'TECHNICAL_VALIDATED', unblocked.body);

const lj = await call('GET', `/qc/targets/${T2}/levey-jennings`, { token: bio });
check('Levey-Jennings N2 : 4 points, statistiques sans la série rejetée (n = 3)', lj.status === 200 && lj.body.points.length === 4 && lj.body.observed.n === 3 && lj.body.target.mean === 2.5, { n: lj.body.points?.length, observed: lj.body.observed });
const techEx = await call('POST', `/qc/runs/${warn.body.id}/exclude`, { token: tech, body: { reason: 'Erreur de saisie' } });
check('Le technicien n’exclut pas une série → 403', techEx.status === 403, techEx.body);
const ex = await call('POST', `/qc/runs/${warn.body.id}/exclude`, { token: qualite, body: { reason: 'Niveau 2 inversé avec le lot précédent (erreur de flacon)' } });
const lj2 = (await call('GET', `/qc/targets/${T2}/levey-jennings`, { token: bio })).body;
check('Exclusion motivée : point marqué exclu, retiré des statistiques (n = 2)', ex.status === 200 && !!ex.body.excludedAt && lj2.points.some((p) => p.runId === warn.body.id && p.excluded) && lj2.observed.n === 2, lj2.observed);
const runs = await call('GET', `/qc/runs?parameterId=${gly.id}&status=REJECTED&pageSize=50`, { token: qualite });
check('Historique des séries filtrable (rejetées)', runs.status === 200 && runs.body.items.some((r) => r.id === rej.body.id) && runs.body.items.every((r) => r.status === 'REJECTED'), runs.body.total);

// ============================================================================ Non-conformités
console.log('\n— Fiches de non-conformité');
const ncId = rej.body.qualityIssue.id;
const closeEarly = await call('POST', `/quality-issues/${ncId}/close`, { token: qualite, body: { effectivenessCheck: 'Contrôles conformes depuis 10 jours' } });
check('Clôture sans plan d’action → 422 ISSUE_NOT_IN_PROGRESS', closeEarly.status === 422 && rule(closeEarly) === 'ISSUE_NOT_IN_PROGRESS', closeEarly.body);
const techPlan = await call('POST', `/quality-issues/${ncId}/plan`, { token: tech, body: { rootCause: 'x', correctiveAction: 'y', actionOwner: 'z', actionDueDate: iso(new Date()) } });
check('Le technicien ne planifie pas les actions → 403', techPlan.status === 403, techPlan.body);
const due = iso(new Date(Date.now() + 14 * 86_400_000));
const plan = await call('POST', `/quality-issues/${ncId}/plan`, {
  token: bio,
  body: { rootCause: 'Flacon de réactif ouvert depuis 35 jours (stabilité 28 jours).', correctiveAction: 'Étiquetage des dates d’ouverture et contrôle hebdomadaire des réactifs en cours.', actionOwner: 'Chef de paillasse biochimie', actionDueDate: due },
});
check('Analyse des causes et plan d’action → « Action en cours »', plan.status === 200 && plan.body.status === 'IN_PROGRESS' && plan.body.actionDueDate === due && plan.body.analyzedBy === `Test bio5.${RUN}`, plan.body);
const bioClose = await call('POST', `/quality-issues/${ncId}/close`, { token: bio, body: { effectivenessCheck: 'Contrôles conformes depuis 10 jours' } });
check('Seul le responsable qualité clôture → 403', bioClose.status === 403, bioClose.body);
const closed = await call('POST', `/quality-issues/${ncId}/close`, { token: qualite, body: { effectivenessCheck: 'Aucun rejet de CIQ glucose sur 20 séries ; dates d’ouverture présentes sur tous les flacons.' } });
check('Clôture après vérification d’efficacité', closed.status === 200 && closed.body.status === 'CLOSED' && closed.body.closedBy === `Test qua5.${RUN}`, closed.body);
const replan = await call('POST', `/quality-issues/${ncId}/plan`, { token: bio, body: { rootCause: 'abcde', correctiveAction: 'abcde', actionOwner: 'ab', actionDueDate: due } });
check('Fiche clôturée non modifiable → 422', replan.status === 422 && rule(replan) === 'ISSUE_FINALIZED', replan.body);

const decl = await call('POST', '/quality-issues', {
  token: caisse,
  body: { title: 'Patient mécontent du délai de rendu', category: 'COMPLAINT', severity: 'MINOR', description: 'Le patient signale avoir attendu son résultat plus de 48 h.', detectedAt: new Date().toISOString(), sampleNumber: sample.number },
});
check('Déclaration par l’accueil/caisse, rattachée à l’échantillon et à sa demande', decl.status === 201 && decl.body.sample?.number === sample.number && decl.body.order?.number === order.number, decl.body);
const badRef = await call('POST', '/quality-issues', {
  token: caisse,
  body: { title: 'Référence erronée', category: 'OTHER', severity: 'MINOR', description: 'Test de référence inexistante.', detectedAt: new Date().toISOString(), orderNumber: 'DEM-1999-000001' },
});
check('N° de demande inconnu → 400 ciblé', badRef.status === 400 && badRef.body.details?.[0]?.path === 'orderNumber', badRef.body);
const futureNc = await call('POST', '/quality-issues', {
  token: caisse,
  body: { title: 'Date future', category: 'OTHER', severity: 'MINOR', description: 'Constat daté dans le futur.', detectedAt: new Date(Date.now() + 86_400_000).toISOString() },
});
check('Constat daté dans le futur → 400', futureNc.status === 400, futureNc.body);
const mine = await call('GET', '/quality-issues?pageSize=100', { token: caisse });
check('Le personnel sans rôle qualité ne voit que ses déclarations', mine.status === 200 && mine.body.items.length >= 1 && mine.body.items.every((i) => i.declaredBy === `Test cai5.${RUN}`), mine.body.items?.map((i) => i.declaredBy));
const other = await call('GET', `/quality-issues/${ncId}`, { token: caisse });
check('Fiche d’un autre déclarant → 404 (pas de fuite)', other.status === 404, other.body);
const all = await call('GET', `/quality-issues?q=${encodeURIComponent(order.number)}`, { token: qualite });
check('Le responsable qualité voit tout et recherche par n° de demande', all.body.items.some((i) => i.id === decl.body.id), all.body.items?.map((i) => i.number));
const cancel = await call('POST', `/quality-issues/${decl.body.id}/cancel`, { token: qualite, body: { reason: 'Délai respecté : résultat disponible en 6 h (vérifié).' } });
check('Annulation motivée d’une déclaration non fondée', cancel.status === 200 && cancel.body.status === 'CANCELLED', cancel.body);

// ============================================================================ Indicateurs
console.log('\n— Indicateurs');
const today = iso(new Date());
const from = iso(new Date(Date.now() - 30 * 86_400_000));
const comptaInd = await call('GET', `/quality/indicators?from=${from}&to=${today}`, { token: compta });
check('Le comptable n’accède pas aux indicateurs → 403', comptaInd.status === 403, comptaInd.body);
const tooLong = await call('GET', `/quality/indicators?from=2024-01-01&to=${today}`, { token: qualite });
check('Période > 366 jours → 400', tooLong.status === 400, tooLong.body);
const inverted = await call('GET', `/quality/indicators?from=${today}&to=${from}`, { token: qualite });
check('Début après fin → 400', inverted.status === 400, inverted.body);
const ind = await call('GET', `/quality/indicators?from=${from}&to=${today}`, { token: qualite });
const b = ind.body;
check('Indicateurs calculés sur 30 jours', ind.status === 200 && b.period.to === today, ind.body);
check('CIQ : séries (hors série exclue), rejets, taux de rejet', b.qc.runs >= 3 && b.qc.rejected >= 1 && b.qc.warning >= 0 && b.qc.byParameter.some((p) => p.parameterCode === 'GLY' && p.rejected >= 1), b.qc);
check('Non-conformités : déclarées, par catégorie et gravité', b.issues.declared >= 2 && b.issues.byCategory.some((c) => c.category === 'ANALYTICAL') && b.issues.bySeverity.length >= 1, b.issues);
check('Délais de rendu : structure médiane / P90 / % dans le délai', typeof b.tat.overall.count === 'number' && Array.isArray(b.tat.byExam) && typeof b.tat.overdueNow === 'number', b.tat.overall);
check('Échantillons, critiques, rectificatifs présents', 'rejectionRatePercent' in b.samples && b.critical.targetMinutes === 30 && 'amendedRatePercent' in b.reports, { s: b.samples, c: b.critical, r: b.reports });
const bySection = await call('GET', `/quality/indicators?from=${from}&to=${today}&sectionId=${glyExam.section.id}`, { token: bio });
check('Filtre par section', bySection.status === 200 && bySection.body.tat.byExam.every((e) => e.sectionName === glyExam.section.name), bySection.body.tat.byExam.map((e) => e.sectionName));

// ============================================================================ Traçabilité
const auditQc = await call('GET', '/audit?entity=QcRun&pageSize=20', { token: admin });
check('Séries, actions correctives et exclusions tracées', auditQc.body.items.some((a) => a.entityId === rej.body.id && a.action === 'CREATE') && auditQc.body.items.some((a) => a.entityId === warn.body.id && a.action === 'UPDATE'), auditQc.body.items.map((a) => a.reason));
const auditTarget = await call('GET', '/audit?entity=QcTarget&pageSize=10', { token: admin });
check('Modification de cible tracée avec son motif', auditTarget.body.items.some((a) => a.entityId === T1 && a.reason?.includes('notice')), auditTarget.body.items.map((a) => a.reason));
const verify = await call('GET', '/audit/verify', { token: admin });
check('Chaîne d’audit intègre', verify.body.valid === true, verify.body);

// Nettoyage : les lots de test sont désactivés pour ne pas encombrer le tableau de bord
for (const m of [n1.body, n2.body]) {
  await call('PUT', `/qc/materials/${m.id}`, { token: qualite, body: { name: m.name, manufacturer: m.manufacturer, lotNumber: m.lotNumber, level: m.level, expiresOn: m.expiresOn, sectionId: m.section?.id ?? null, isActive: false } });
}
await call('PUT', '/settings/lab', { token: admin, body: settingsRest });

console.log(failures === 0 ? '\nTOUS LES CONTRÔLES SONT PASSÉS' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
