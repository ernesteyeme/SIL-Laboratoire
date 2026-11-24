// Test de fumée de bout en bout du socle, contre une API démarrée sur une base VIERGE (juste après migrate + seed).
// Usage : node --env-file=.env scripts/smoke-test.mjs [http://localhost:3000/api]
// Attention : modifie les données (crée tech1, change le mot de passe admin). Ne jamais lancer en production.
const BASE = process.argv[2] ?? 'http://localhost:3000/api';
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@Lims2026!';
const SEED_USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'admin';
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✔' : '✘'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  if (!cond) failures++;
};

async function call(method, path, { token, body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = `lims_rt=${cookie}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/lims_rt=([^;]*)/);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: m ? m[1] : null, setCookie, reqId: res.headers.get('x-request-id') };
}

const r1 = await call('POST', '/auth/login', { body: { username: SEED_USERNAME, password: 'mauvais' } });
check('Login mauvais mot de passe → 401 INVALID_CREDENTIALS', r1.status === 401 && r1.body.code === 'INVALID_CREDENTIALS', r1.body);
check('Réponse d’erreur porte un requestId', typeof r1.body.requestId === 'string' && r1.body.requestId === r1.reqId);

const r2 = await call('POST', '/auth/login', { body: { username: SEED_USERNAME.toUpperCase() + ' ', password: SEED_PASSWORD } });
check('Login admin (identifiant normalisé) → 200', r2.status === 200 && r2.body.user.mustChangePassword === true, r2.body);
check('Cookie refresh httpOnly + SameSite=Strict + path /api/auth', /HttpOnly/i.test(r2.setCookie) && /SameSite=Strict/i.test(r2.setCookie) && /Path=\/api\/auth/.test(r2.setCookie), r2.setCookie);
let adminToken = r2.body.accessToken;

const r3 = await call('GET', '/users', { token: adminToken });
check('Changement de mot de passe exigé → 403 PASSWORD_CHANGE_REQUIRED', r3.status === 403 && r3.body.code === 'PASSWORD_CHANGE_REQUIRED', r3.body);

const r4 = await call('POST', '/auth/change-password', { token: adminToken, body: { currentPassword: SEED_PASSWORD, newPassword: 'faible', confirmPassword: 'faible' } });
check('Mot de passe faible → 400 VALIDATION_ERROR détaillé', r4.status === 400 && Array.isArray(r4.body.details) && r4.body.details.some((d) => d.path === 'newPassword'), r4.body);

const r5 = await call('POST', '/auth/change-password', { token: adminToken, body: { currentPassword: SEED_PASSWORD, newPassword: 'NouveauAdmin#2026', confirmPassword: 'NouveauAdmin#2026' } });
check('Changement de mot de passe → 200', r5.status === 200 && r5.body.user.mustChangePassword === false, r5.body);
const oldToken = adminToken;
adminToken = r5.body.accessToken;
let adminCookie = r5.cookie;

const r6 = await call('GET', '/users', { token: oldToken });
check('Ancien jeton invalidé après changement → 401 AUTH_SESSION_REVOKED', r6.status === 401 && r6.body.code === 'AUTH_SESSION_REVOKED', r6.body);

const r7 = await call('GET', '/users', { token: adminToken });
check('Liste des utilisateurs (ADMIN) → 200', r7.status === 200 && r7.body.total === 1, r7.body);

const r8 = await call('GET', '/users?pageSize=1000', { token: adminToken });
check('Query invalide → 400', r8.status === 400 && r8.body.code === 'VALIDATION_ERROR', r8.body);

const newUser = { username: 'tech1', fullName: 'Technicien Un', email: 'tech1@labo.cd', roles: ['TECHNICIEN'], temporaryPassword: 'Temp#Tech2026' };
const r9 = await call('POST', '/users', { token: adminToken, body: newUser });
check('Création utilisateur → 201', r9.status === 201 && r9.body.mustChangePassword === true && !('passwordHash' in r9.body), r9.body);
const techId = r9.body.id;

const r10 = await call('POST', '/users', { token: adminToken, body: newUser });
check('Doublon d’identifiant → 409 CONFLICT', r10.status === 409 && r10.body.code === 'CONFLICT', r10.body);

const r11 = await call('POST', '/users', { token: adminToken, body: { ...newUser, username: 'x', roles: [], extra: 1 } });
check('Champs inconnus / invalides refusés → 400', r11.status === 400, r11.body);

let t = await call('POST', '/auth/login', { body: { username: 'tech1', password: 'Temp#Tech2026' } });
t = await call('POST', '/auth/change-password', { token: t.body.accessToken, body: { currentPassword: 'Temp#Tech2026', newPassword: 'Tech1#Labo2026', confirmPassword: 'Tech1#Labo2026' } });
const techToken = t.body.accessToken;
check('Technicien connecté après changement', t.status === 200, t.body);

const r12 = await call('GET', '/users', { token: techToken });
check('Technicien sur /users → 403 ACCESS_DENIED', r12.status === 403 && r12.body.code === 'ACCESS_DENIED', r12.body);
const r13 = await call('GET', '/settings/lab', { token: techToken });
check('Technicien lit les paramètres (AnyRole) → 200', r13.status === 200, r13.body);
const settingsBody = { ...r13.body };
delete settingsBody.updatedAt;
const r14 = await call('PUT', '/settings/lab', { token: techToken, body: settingsBody });
check('Technicien modifie les paramètres → 403', r14.status === 403, r14.body);
const r15 = await call('PUT', '/settings/lab', { token: adminToken, body: { ...settingsBody, city: 'Kinshasa', currency: 'usd' } });
check('Admin modifie les paramètres → 200 (devise normalisée)', r15.status === 200 && r15.body.currency === 'USD' && r15.body.city === 'Kinshasa', r15.body);
const r15b = await call('PUT', '/settings/lab', { token: adminToken, body: { ...settingsBody, timezone: 'Mars/Olympus' } });
check('Fuseau horaire inconnu → 422 BUSINESS_RULE', r15b.status === 422, r15b.body);

const r16 = await call('POST', '/auth/refresh', { cookie: adminCookie });
check('Refresh → 200 + nouveau cookie', r16.status === 200 && r16.cookie && r16.cookie !== adminCookie, r16.body);
const r17 = await call('POST', '/auth/refresh', { cookie: adminCookie });
check('Ancien cookie (dans le délai de grâce) → 401 sans révoquer la famille', r17.status === 401, r17.body);
const r18 = await call('POST', '/auth/refresh', { cookie: r16.cookie });
check('Nouveau cookie toujours valide', r18.status === 200, r18.body);
adminCookie = r18.cookie;
adminToken = r18.body.accessToken;

for (let i = 0; i < MAX_ATTEMPTS; i++) await call('POST', '/auth/login', { body: { username: 'tech1', password: 'mauvais' } });
const r19 = await call('POST', '/auth/login', { body: { username: 'tech1', password: 'Tech1#Labo2026' } });
check(`Compte verrouillé après ${MAX_ATTEMPTS} échecs → 401 ACCOUNT_LOCKED`, r19.status === 401 && r19.body.code === 'ACCOUNT_LOCKED', r19.body);
const r20 = await call('POST', `/users/${techId}/unlock`, { token: adminToken, body: { reason: 'Vérification identité OK' } });
check('Déverrouillage par admin → 200', r20.status === 200 && r20.body.isLocked === false, r20.body);
const r21 = await call('POST', '/auth/login', { body: { username: 'tech1', password: 'Tech1#Labo2026' } });
check('Connexion après déverrouillage → 200', r21.status === 200, r21.body);

const adminId = r2.body.user.id;
const r22 = await call('POST', `/users/${adminId}/deactivate`, { token: adminToken, body: { reason: 'Test auto-désactivation' } });
check('Auto-désactivation → 422 SELF_DEACTIVATION', r22.status === 422 && r22.body.details.rule === 'SELF_DEACTIVATION', r22.body);
const r23 = await call('PATCH', `/users/${adminId}`, { token: adminToken, body: { roles: ['BIOLOGISTE'] } });
check('Retrait de son propre rôle ADMIN → 422', r23.status === 422, r23.body);
const r24 = await call('PATCH', `/users/${techId}`, { token: adminToken, body: { roles: ['TECHNICIEN', 'QUALITE'], email: '' } });
check('Modification utilisateur (rôles, email vidé) → 200', r24.status === 200 && r24.body.roles.length === 2 && r24.body.email === null, r24.body);
const r25 = await call('POST', `/users/${techId}/deactivate`, { token: adminToken, body: { reason: 'Fin de contrat' } });
check('Désactivation → 200', r25.status === 200 && r25.body.isActive === false, r25.body);
const r26 = await call('GET', '/auth/me', { token: techToken });
check('Jeton du compte désactivé → 401', r26.status === 401, r26.body);
const r27 = await call('POST', '/auth/refresh', { cookie: r21.cookie });
check('Refresh du compte désactivé → 401', r27.status === 401, r27.body);
const r28 = await call('POST', `/users/${techId}/reactivate`, { token: adminToken, body: { reason: 'Nouveau contrat signé' } });
check('Réactivation → 200 (changement de mot de passe exigé)', r28.status === 200 && r28.body.isActive && r28.body.mustChangePassword, r28.body);

const r29 = await call('GET', '/audit?entity=User&pageSize=50', { token: adminToken });
check('Audit filtré sur User → 200', r29.status === 200 && r29.body.items.length > 0, r29.body);
const actions = new Set(r29.body.items.map((i) => i.action));
for (const a of ['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'PASSWORD_CHANGE']) {
  check(`Audit contient ${a}`, actions.has(a), [...actions]);
}
const all = await call('GET', '/audit?pageSize=100', { token: adminToken });
check('Aucun hash de mot de passe dans l’audit', !JSON.stringify(all.body).includes('$argon2'));
check('Refus d’accès journalisés', all.body.items.some((i) => i.action === 'ACCESS_DENIED' && i.actorUsername === 'tech1'));
check('Audit trié par seq décroissant et contigu', all.body.items.every((it, idx, arr) => idx === 0 || arr[idx - 1].seq === it.seq + 1));

const r30 = await call('GET', '/audit/verify', { token: adminToken });
check('Vérification de la chaîne d’audit → valide', r30.status === 200 && r30.body.valid === true && r30.body.lastHash?.length === 64, r30.body);

const r31 = await call('GET', '/route-inexistante', { token: adminToken });
check('Route inconnue → 404 format uniforme', r31.status === 404 && r31.body.code === 'NOT_FOUND', r31.body);

await call('POST', '/auth/logout', { cookie: adminCookie });
const r32 = await call('POST', '/auth/refresh', { cookie: adminCookie });
check('Après logout, refresh → 401', r32.status === 401, r32.body);

console.log(failures === 0 ? '\nTOUS LES CONTRÔLES SONT PASSÉS' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
