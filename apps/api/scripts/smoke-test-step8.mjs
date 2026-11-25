// Test de fumée de l'étape 8 / version 1.8.0 : habilitations par service (ISO 15189 §6.2).
// Un technicien habilité à la seule Biochimie saisit la glycémie mais pas la NFS (Hématologie) ; paillasse filtrée ;
// validation biologique limitée ; règles de gestion des comptes ; changements tracés dans l'audit.
// À lancer APRÈS smoke-test.mjs sur une base de TEST avec le catalogue de démarrage (pnpm db:seed:catalog).
// Usage : node --env-file=.env scripts/smoke-test-step8.mjs [http://localhost:3000/api]
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
async function createStaff(adminToken, username, roles, sectionIds) {
  const temp = 'Temp#Smoke2026';
  const finalPw = 'Final#Smoke2026';
  const c = await call('POST', '/users', { token: adminToken, body: { username, fullName: `Test ${username}`, roles, sectionIds: sectionIds ?? (await allSectionIds(adminToken, roles)), temporaryPassword: temp } });
  if (c.status !== 201) throw new Error(`Création ${username} : ${JSON.stringify(c.body)}`);
  const t = await login(username, temp);
  const cp = await call('POST', '/auth/change-password', { token: t, body: { currentPassword: temp, newPassword: finalPw, confirmPassword: finalPw } });
  return cp.body.accessToken;
}
const syl = ['ka', 'mbu', 'lu', 'tshi', 'ngo', 'mwa', 'ba', 'ki', 'se', 'zo', 'ny', 'ra', 'fu', 'do'];
const word = () => { const w = Array.from({ length: 4 }, () => syl[Math.floor(Math.random() * syl.length)]).join(''); return w[0].toUpperCase() + w.slice(1); };

const admin = await login(SEED_USERNAME, ADMIN_PASSWORD);
const sections = Object.fromEntries((await call('GET', '/catalog/sections', { token: admin })).body.map((x) => [x.code, x]));
const BIOCH = sections.BIOCH.id;
const HEMATO = sections.HEMATO.id;

// --- Règles de gestion des comptes
const temp = 'Temp#Smoke2026';
const noSection = await call('POST', '/users', { token: admin, body: { username: `tns.${RUN}`, fullName: 'Sans service', roles: ['TECHNICIEN'], sectionIds: [], temporaryPassword: temp } });
check('Technicien sans service → refusé (400)', noSection.status === 400, noSection.body);
const adminSections = await call('POST', '/users', { token: admin, body: { username: `adm.${RUN}`, fullName: 'Admin service', roles: ['ADMIN'], sectionIds: [BIOCH], temporaryPassword: temp } });
check('Service attribué à un rôle non limité → SECTIONS_NOT_APPLICABLE (422)', adminSections.status === 422 && adminSections.body.details?.rule === 'SECTIONS_NOT_APPLICABLE', adminSections.body);

const techB = await createStaff(admin, `tb8.${RUN}`, ['TECHNICIEN'], [BIOCH]);
const bioH = await createStaff(admin, `bh8.${RUN}`, ['BIOLOGISTE'], [HEMATO]);
const bioAll = await createStaff(admin, `ba8.${RUN}`, ['BIOLOGISTE'], [BIOCH, HEMATO]);
const reception = await createStaff(admin, `rc8.${RUN}`, ['RECEPTION', 'CAISSE']);

const me = (await call('GET', '/auth/me', { token: techB })).body;
check('Session : services de l’utilisateur transmis (sectionIds)', Array.isArray(me.sectionIds) && me.sectionIds.length === 1 && me.sectionIds[0] === BIOCH, me);
const listed = await call('GET', `/users?sectionId=${HEMATO}&pageSize=100`, { token: admin });
check('Liste des utilisateurs filtrée par service', listed.status === 200 && listed.body.items.some((u) => u.username === `bh8.${RUN}`) && !listed.body.items.some((u) => u.username === `tb8.${RUN}`), listed.body.items?.map((u) => u.username));

// --- Demande NFS (Hématologie) + GLY (Biochimie)
const settings0 = (await call('GET', '/settings/lab', { token: admin })).body;
const { updatedAt: _u, secondaryCurrency: _s, ...settingsRest } = settings0;
await call('PUT', '/settings/lab', { token: admin, body: { ...settingsRest, requirePaymentBeforeCollection: false } });
const patient = (await call('POST', '/patients', { token: reception, body: { lastName: word(), firstName: word(), sex: 'MALE', birthDate: '1979-03-12' } })).body;
const exams = Object.fromEntries((await call('GET', '/catalog/exams?pageSize=100', { token: reception })).body.items.map((e) => [e.code, e]));
const order = (await call('POST', '/orders', { token: reception, body: { patientId: patient.id, examIds: [exams.NFS.id, exams.GLY.id] } })).body;
check('Demande NFS + GLY créée', !!order?.id, order);
for (const smp of order.samples) {
  await call('POST', `/samples/${smp.id}/collect`, { token: reception, body: { collectedAt: new Date(Date.now() - 600_000).toISOString() } });
}
// La réception au laboratoire n'est pas limitée par service
for (const smp of order.samples) {
  const rcv = await call('POST', `/samples/${smp.id}/receive`, { token: techB });
  check(`Réception de l’échantillon ${smp.number ?? ''} par le technicien`, rcv.status === 201 || rcv.status === 200, rcv.body);
}

const res = (await call('GET', `/results/orders/${order.id}`, { token: techB })).body;
check('Lecture du dossier complet autorisée (tous services)', res.items?.length === 2, res);
const nfs = res.items.find((i) => i.examCode === 'NFS');
const gly = res.items.find((i) => i.examCode === 'GLY');

// --- Paillasse
const wl = await call('GET', `/results/worklist?q=${order.number}&pageSize=50`, { token: techB });
check('Paillasse par défaut limitée aux services du technicien (GLY seulement)', wl.status === 200 && wl.body.items.length === 1 && wl.body.items[0].examCode === 'GLY', wl.body.items?.map((i) => i.examCode));
const wlOther = await call('GET', `/results/worklist?sectionId=${HEMATO}`, { token: techB });
check('Paillasse d’un service non attribué → 403 SECTION_NOT_AUTHORIZED', wlOther.status === 403 && wlOther.body.details?.rule === 'SECTION_NOT_AUTHORIZED', wlOther.body);
const wlAdmin = await call('GET', `/results/worklist?q=${order.number}&pageSize=50`, { token: bioAll });
check('Biologiste habilité aux deux services : paillasse avec NFS et GLY', wlAdmin.status === 200 && wlAdmin.body.items.length === 2, { status: wlAdmin.status, body: wlAdmin.body });

// --- Saisie
const glyR = gly.results[0];
const saveGly = await call('PUT', `/results/items/${gly.id}`, { token: techB, body: { results: [{ resultId: glyR.id, value: '0,95' }] } });
check('Saisie GLY (Biochimie) par le technicien de Biochimie acceptée', saveGly.status === 200, saveGly.body);
const saveNfs = await call('PUT', `/results/items/${nfs.id}`, { token: techB, body: { results: [{ resultId: nfs.results[0].id, value: '13' }] } });
check('Saisie NFS (Hématologie) refusée → 403 SECTION_NOT_AUTHORIZED', saveNfs.status === 403 && saveNfs.body.details?.rule === 'SECTION_NOT_AUTHORIZED', saveNfs.body);
check('Message explicite nommant le service', typeof saveNfs.body.message === 'string' && saveNfs.body.message.includes('Hématologie'), saveNfs.body.message);
const tvGly = await call('POST', `/results/items/${gly.id}/technical-validation`, { token: techB });
check('Validation technique GLY acceptée', tvGly.status === 200 || tvGly.status === 201, tvGly.body);

// --- Validation biologique
const bvWrong = await call('POST', `/results/items/${gly.id}/biological-validation`, { token: bioH, body: {} });
check('Biologiste d’Hématologie : validation biologique GLY refusée (403)', bvWrong.status === 403 && bvWrong.body.details?.rule === 'SECTION_NOT_AUTHORIZED', bvWrong.body);
const retWrong = await call('POST', `/results/items/${gly.id}/return`, { token: bioH, body: { reason: 'Contrôle demandé hors service' } });
check('Biologiste d’Hématologie : renvoi en saisie GLY refusé (403)', retWrong.status === 403, retWrong.body);
const bvOk = await call('POST', `/results/items/${gly.id}/biological-validation`, { token: bioAll, body: {} });
check('Biologiste habilité à plusieurs services : validation GLY acceptée', bvOk.status === 200 || bvOk.status === 201, bvOk.body);

// --- Retrait immédiat d'une habilitation
const techUser = (await call('GET', `/users?search=tb8.${RUN}`, { token: admin })).body.items[0];
const upd = await call('PATCH', `/users/${techUser.id}`, { token: admin, body: { sectionIds: [HEMATO] } });
check('Administrateur : services du technicien modifiés (Biochimie → Hématologie)', upd.status === 200 && upd.body.sections.map((x) => x.code).join() === 'HEMATO', upd.body);
const saveNfs2 = await call('PUT', `/results/items/${nfs.id}`, { token: techB, body: { results: [{ resultId: nfs.results[0].id, value: '13' }] } });
check('Effet immédiat (même session) : saisie NFS désormais acceptée', saveNfs2.status === 200, saveNfs2.body);
const amendGly = await call('POST', `/results/items/${gly.id}/amend`, { token: techB, body: { reason: 'Erreur de transcription' } });
check('Effet immédiat : action sur GLY désormais refusée', amendGly.status === 403, amendGly.body);
const emptyUpd = await call('PATCH', `/users/${techUser.id}`, { token: admin, body: { sectionIds: [] } });
check('Retirer tous les services d’un technicien → 422 SECTION_REQUIRED', emptyUpd.status === 422 && emptyUpd.body.details?.rule === 'SECTION_REQUIRED', emptyUpd.body);

// --- Audit
const audit = await call('GET', `/audit?entity=User&entityId=${techUser.id}&pageSize=20`, { token: admin });
const updAudit = audit.body.items?.find((a) => a.action === 'UPDATE');
check('Changement d’habilitation tracé (avant/après)', !!updAudit && JSON.stringify(updAudit.before).includes('BIOCH') && JSON.stringify(updAudit.after).includes('HEMATO'), audit.body.items);
const verify = await call('GET', '/audit/verify', { token: admin });
check('Chaîne d’audit intègre', verify.body.valid === true, verify.body);

await call('PUT', '/settings/lab', { token: admin, body: settingsRest });
console.log(failures === 0 ? '\nÉtape 8 : tous les contrôles sont passés.' : `\nÉtape 8 : ${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
