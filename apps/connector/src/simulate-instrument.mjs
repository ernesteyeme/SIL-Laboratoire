#!/usr/bin/env node
// Simulateur d'automate pour tester un connecteur sans appareil : se comporte comme un analyseur ASTM E1381
// (ENQ, trames numérotées avec somme de contrôle, attente de l'ACK après chaque trame, EOT) ou HL7 MLLP.
// Usage : node src/simulate-instrument.mjs --port 5000 --specimen 2611220001 [--hl7] [--corrupt] [--query]
import net from 'node:net';
import { ACK, buildFrames, ENQ, EOT, NAK } from './astm-link.mjs';
import { wrapMllp } from './mllp-link.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean),
);
const port = Number(args.port ?? 5000);
const host = args.host ?? '127.0.0.1';
const specimen = args.specimen ?? '2611220001';
const qcId = args.qc;
const p2 = (n) => String(n).padStart(2, '0');
const d = new Date();
const ts = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

function astmMessage() {
  if (args.query) return [`H|\\^&|||XN-SIM|||||||P|LIS2-A2|${ts}`, `Q|1|^${specimen}||^^^ALL||||||||O`, 'L|1|N'].join('\r') + '\r';
  const recs = [`H|\\^&|||XN-SIM^1.0|||||||P|LIS2-A2|${ts}`, 'P|1'];
  recs.push(`O|1|${qcId ?? specimen}^01||^^^NFS|R||${ts}||||${qcId ? 'Q' : 'N'}||||||||||||||F`);
  const values = qcId ? [['HGB', args.hgb ?? '13.5', 'g/dL']] : [['WBC', '6.12', '10*3/uL'], ['HGB', args.hgb ?? '12.8', 'g/dL'], ['HCT', '38.9', '%'], ['PLT', '241', '10*3/uL']];
  values.forEach(([c, v, u], i) => recs.push(`R|${i + 1}|^^^${c}^1|${v}|${u}||N||F||||${ts}`));
  recs.push('L|1|N');
  return recs.join('\r') + '\r';
}

const socket = net.connect({ host, port });
let buffer = '';
const waiters = [];
socket.on('data', (b) => {
  buffer += b.toString('latin1');
  while (buffer.length && waiters.length) {
    const c = buffer[0];
    buffer = buffer.slice(1);
    waiters.shift()(c);
  }
});
// Caractère suivant : d'abord ce qui est déjà arrivé, sinon on attend (les octets peuvent précéder l'attente).
const next = () =>
  new Promise((r, j) => {
    if (buffer.length > 0) {
      const c = buffer[0];
      buffer = buffer.slice(1);
      r(c);
      return;
    }
    const t = setTimeout(() => j(new Error('Pas de réponse du connecteur')), 10_000);
    waiters.push((c) => { clearTimeout(t); r(c); });
  });
const label = (c) => ({ [ACK]: 'ACK', [NAK]: 'NAK', [EOT]: 'EOT', [ENQ]: 'ENQ' })[c] ?? JSON.stringify(c);

socket.on('connect', async () => {
  try {
    if (args.hl7) {
      const msg = ['MSH|^~\\&|SIM|LAB|SIL||' + ts + '||ORU^R01|SIM' + Date.now() + '|P|2.5', `OBR|1|${specimen}||GLU`, `OBX|1|NM|GLU^Glucose||${args.glu ?? '5.1'}|mmol/L||N|||F`].join('\r');
      socket.write(Buffer.from(wrapMllp(msg), 'latin1'));
      const ack = await new Promise((r) => { const t = setInterval(() => { const i = buffer.indexOf('\x1c'); if (i !== -1) { clearInterval(t); r(buffer.slice(1, i)); } }, 50); });
      console.log(`ACK reçu : ${ack.split('\r')[1]}`);
      socket.end();
      return;
    }
    socket.write(ENQ);
    console.log(`→ ENQ ; ← ${label(await next())}`);
    const frames = buildFrames(astmMessage());
    for (let i = 0; i < frames.length; i++) {
      let frame = frames[i];
      if (args.corrupt && i === 1) {
        // Première émission de la trame 2 volontairement corrompue : le connecteur doit répondre NAK.
        const bad = frame.slice(0, -4) + (frame.slice(-4, -2) === '00' ? '01' : '00') + '\r\n';
        socket.write(Buffer.from(bad, 'latin1'));
        console.log(`→ trame ${i + 1} corrompue ; ← ${label(await next())}`);
      }
      socket.write(Buffer.from(frame, 'latin1'));
      console.log(`→ trame ${i + 1}/${frames.length} ; ← ${label(await next())}`);
    }
    socket.write(EOT);
    console.log('→ EOT');
    if (args.query) {
      // L'automate attend la réponse de l'hôte : ENQ → ACK, trames → ACK, EOT.
      const enq = await next();
      console.log(`← ${label(enq)} (réponse du SIL)`);
      socket.write(ACK);
      let text = '';
      for (;;) {
        const c = await next();
        if (c === EOT) break;
        let frame = c;
        while (!frame.endsWith('\n')) frame += await next();
        text += frame.replace(/^\x02\d/, '').replace(/[\x03\x17][0-9A-F]{2}\r\n$/, '');
        socket.write(ACK);
      }
      console.log('Commandes reçues :\n' + text.split('\r').filter(Boolean).map((l) => '  ' + l).join('\n'));
    }
    setTimeout(() => socket.end(), 300);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
});
socket.on('error', (e) => { console.error(`Connexion impossible : ${e.message}`); process.exit(1); });
