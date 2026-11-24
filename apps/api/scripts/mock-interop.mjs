// Serveurs simulés DHIS2, VLSM/InteLIS et OpenHIM pour les tests de l'étape 7 (aucune dépendance).
// Usage : node scripts/mock-interop.mjs [port]   (défaut 3999)
//   DHIS2   : http://localhost:3999/dhis2      — Basic admin:district ou « ApiToken d2pat_mock »
//   VLSM    : http://localhost:3999/vlsm/api/v1.1 — /user/login.php avec lims / vlsm-pass, ou jeton statique « vlsm-static-token »
//   OpenHIM : http://localhost:3999/openhim/dhis2 et /openhim/vlsm — client Basic lims-client:him-pass ;
//             le canal ajoute lui-même les identifiants du système cible (comme une route OpenHIM).
//   Inspection : GET /__mock/state, GET /__mock/requests, POST /__mock/reset
// Règles simulées : un élément de données DHIS2 commençant par « X » est inconnu (conflit E7610) ;
// une structure VLSM facilityId = 999 est inconnue (enregistrement refusé).

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] ?? 3999);
const DHIS2_BASIC = `Basic ${Buffer.from('admin:district').toString('base64')}`;
const DHIS2_TOKEN = 'ApiToken d2pat_mock';
const HIM_CLIENT = `Basic ${Buffer.from('lims-client:him-pass').toString('base64')}`;
const VLSM_STATIC = 'vlsm-static-token';

let state;
const reset = () => {
  state = { dhis2: {}, vlsm: {}, vlsmSeq: 0, tokens: new Set([VLSM_STATIC]), requests: [] };
};
reset();

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

function dhis2(req, res, path, body, auth) {
  if (auth !== DHIS2_BASIC && auth !== DHIS2_TOKEN) return send(res, 401, { httpStatus: 'Unauthorized', httpStatusCode: 401, status: 'ERROR', message: 'Unauthorized' });
  if (req.method === 'GET' && path === '/api/system/info') return send(res, 200, { version: '2.40.4', revision: 'mock', systemName: 'DHIS2 simulé — PNLS RDC' });
  if (req.method === 'POST' && path === '/api/dataValueSets') {
    const url = new URL(req.url, 'http://x');
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const set = body ?? {};
    const count = { imported: 0, updated: 0, ignored: 0, deleted: 0 };
    const conflicts = [];
    (set.dataValues ?? []).forEach((dv, i) => {
      if (!/^[A-Za-z][A-Za-z0-9]{10}$/.test(dv.dataElement ?? '') || dv.dataElement.startsWith('X')) {
        conflicts.push({ object: dv.dataElement, objects: { dataElement: dv.dataElement }, value: 'Data element not found or not accessible', errorCode: 'E7610', property: 'dataElement', indexes: [i] });
        count.ignored++;
        return;
      }
      const key = `${dv.dataElement}.${dv.categoryOptionCombo ?? 'HllvX50cXC0'}.${set.period}.${set.orgUnit}`;
      const prev = state.dhis2[key];
      if (prev === dv.value) count.ignored++;
      else if (prev === undefined) count.imported++;
      else count.updated++;
      if (!dryRun) state.dhis2[key] = dv.value;
    });
    const allFailed = conflicts.length > 0 && conflicts.length === (set.dataValues ?? []).length;
    const status = allFailed ? 'ERROR' : conflicts.length ? 'WARNING' : 'SUCCESS';
    return send(res, allFailed ? 409 : 200, {
      httpStatus: allFailed ? 'Conflict' : 'OK',
      httpStatusCode: allFailed ? 409 : 200,
      status: allFailed ? 'ERROR' : conflicts.length ? 'WARNING' : 'OK',
      message: allFailed ? 'One more conflicts encountered, please check import summary.' : 'Import was successful.',
      response: { responseType: 'ImportSummary', status, importOptions: { dryRun, importStrategy: 'CREATE_AND_UPDATE' }, description: dryRun ? 'Dry run: nothing saved' : 'Import process completed successfully', importCount: count, conflicts, dataSetComplete: 'false' },
    });
  }
  return send(res, 404, { httpStatus: 'Not Found', httpStatusCode: 404, status: 'ERROR', message: `No endpoint ${path}` });
}

const VL_REQUIRED = ['appSampleCode', 'facilityId', 'sampleCollectionDate', 'patientGender', 'patientArtNo', 'specimenType', 'reasonForVLTesting', 'labId', 'uniqueId'];
const EID_REQUIRED = ['appSampleCode', 'facilityId', 'sampleCollectionDate', 'childId', 'specimenType', 'labId', 'uniqueId', 'result'];

function vlsm(req, res, path, body, auth) {
  if (req.method === 'GET' && path === '/version.php') return send(res, 200, { version: '5.7.51' });
  if (req.method === 'POST' && path === '/user/login.php') {
    if (body?.userName === 'lims' && body?.password === 'vlsm-pass') {
      const token = randomBytes(16).toString('hex');
      state.tokens.add(token);
      return send(res, 200, { status: 1, message: 'Login Success', timestamp: Math.floor(Date.now() / 1000), data: { user: { login_id: 'lims' }, api_token: token, new_token: true } });
    }
    return send(res, 200, { status: 2, message: 'Login failed. Please contact system administrator.' });
  }
  const m = /^\/(vl|eid)\/save-request\.php$/.exec(path);
  if (req.method === 'POST' && m) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || !state.tokens.has(token)) return send(res, 401, { status: 'failed', timestamp: Math.floor(Date.now() / 1000), error: 'Bearer token invalid or expired' });
    if (!body?.appVersion || !Array.isArray(body?.data)) return send(res, 200, { status: 'failed', message: 'appVersion and data are required' });
    const required = m[1] === 'vl' ? VL_REQUIRED : EID_REQUIRED;
    const data = body.data.map((r) => {
      const missing = required.filter((k) => r[k] === undefined || r[k] === null || r[k] === '');
      if (missing.length) return { status: 'failed', uniqueId: r.uniqueId, appSampleCode: r.appSampleCode, message: `Missing required fields: ${missing.join(', ')}` };
      if (String(r.facilityId) === '999') return { status: 'failed', uniqueId: r.uniqueId, appSampleCode: r.appSampleCode, message: 'Facility not found' };
      const existing = state.vlsm[r.uniqueId];
      const sampleCode = existing?.sampleCode ?? `${m[1].toUpperCase()}26${String(++state.vlsmSeq).padStart(5, '0')}`;
      state.vlsm[r.uniqueId] = { sampleCode, testType: m[1], record: r, versions: (existing?.versions ?? 0) + 1 };
      return { status: 'success', action: existing ? 'updated' : 'inserted', sampleCode, uniqueId: r.uniqueId, appSampleCode: r.appSampleCode, transactionId: randomBytes(8).toString('hex') };
    });
    return send(res, 200, { status: 'success', timestamp: Math.floor(Date.now() / 1000), transactionId: randomBytes(8).toString('hex'), message: 'Successfully added.', data });
  }
  return send(res, 404, { status: 'failed', error: `Unknown API ${path}` });
}

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return send(res, 400, { status: 'ERROR', message: 'Invalid JSON' });
    }
    const p = url.pathname;
    if (p === '/__mock/reset' && req.method === 'POST') return reset(), send(res, 200, { ok: true });
    if (p === '/__mock/state') return send(res, 200, { dhis2: state.dhis2, vlsm: state.vlsm });
    if (p === '/__mock/requests') return send(res, 200, state.requests);
    state.requests.push({ method: req.method, path: p, query: url.search, authorization: req.headers.authorization ?? null, body });
    if (state.requests.length > 500) state.requests.shift();
    if (p.startsWith('/slow/')) return; // ne répond jamais : test du délai
    if (p.startsWith('/dhis2/')) return dhis2(req, res, p.slice('/dhis2'.length), body, req.headers.authorization);
    if (p.startsWith('/vlsm/api/v1.1/')) return vlsm(req, res, p.slice('/vlsm/api/v1.1'.length), body, req.headers.authorization);
    if (p.startsWith('/openhim/')) {
      if (req.headers.authorization !== HIM_CLIENT) return send(res, 401, { error: 'Unauthorized client' }, { 'WWW-Authenticate': 'Basic realm="OpenHIM"' });
      const txId = randomBytes(12).toString('hex');
      const tx = { 'X-OpenHIM-TransactionID': txId };
      const forward = (handler, rest, auth) => {
        const original = res.writeHead.bind(res);
        res.writeHead = (status, headers) => original(status, { ...headers, ...tx });
        return handler(req, res, rest, body, auth);
      };
      if (p.startsWith('/openhim/dhis2/')) return forward(dhis2, p.slice('/openhim/dhis2'.length), DHIS2_BASIC);
      if (p.startsWith('/openhim/vlsm/')) return forward(vlsm, p.slice('/openhim/vlsm'.length), `Bearer ${VLSM_STATIC}`);
      return send(res, 404, { error: 'No matching channel' }, tx);
    }
    return send(res, 404, { error: 'Not found' });
  });
}).listen(PORT, () => console.log(`Serveurs simulés DHIS2 / VLSM / OpenHIM sur http://localhost:${PORT}`));
