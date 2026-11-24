#!/usr/bin/env node
// Connecteur de poste du SIL : à installer sur un PC relié à l'automate.
// Usage : node src/index.mjs chemin/vers/config.json
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, extname, join, resolve } from 'node:path';
import { createApi } from './api.mjs';
import { ACK, AstmReceiver, ENQ, EOT, NAK, sendAstm } from './astm-link.mjs';
import { localAck, MllpReceiver, wrapMllp } from './mllp-link.mjs';
import { Spool, startSender } from './spool.mjs';

const configPath = resolve(process.argv[2] ?? process.env.LIMS_CONNECTOR_CONFIG ?? 'config.json');
if (!existsSync(configPath)) {
  console.error(`Configuration introuvable : ${configPath} (copiez config.example.json).`);
  process.exit(2);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const baseDir = dirname(configPath);
const dataDir = resolve(baseDir, config.dataDir ?? 'donnees');
mkdirSync(dataDir, { recursive: true });
const encoding = config.encoding === 'utf8' ? 'utf8' : 'latin1';

function log(level, msg) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}`;
  (level === 'error' ? console.error : console.log)(line);
  try {
    appendFileSync(join(dataDir, `connecteur-${new Date().toISOString().slice(0, 10)}.log`), line + '\n');
  } catch {
    /* journal sur disque facultatif */
  }
}

for (const key of ['apiUrl', 'instrumentKey', 'mode', 'protocol']) {
  if (!config[key]) {
    log('error', `Paramètre « ${key} » manquant dans ${configPath}.`);
    process.exit(2);
  }
}
const api = createApi(config);
const spool = new Spool(join(dataDir, 'file-attente'));
const sender = startSender(spool, api, log);
/** Octets reçus (latin1) → texte dans l'encodage de l'automate. */
const decode = (latin1) => (encoding === 'utf8' ? Buffer.from(latin1, 'latin1').toString('utf8') : latin1);
const encode = (text) => (encoding === 'utf8' ? Buffer.from(text, 'utf8') : Buffer.from(text, 'latin1'));

try {
  const p = await api.ping();
  log('info', `Connecté au SIL : automate ${p.instrument.code} (${p.instrument.name}), ${p.instrument.protocolLabel}.`);
  if (p.instrument.protocol.toLowerCase() !== config.protocol.toLowerCase() && !(config.protocol === 'file' && p.instrument.protocol === 'CSV')) {
    log('warn', `Protocole configuré « ${config.protocol} » différent de celui déclaré au SIL (« ${p.instrument.protocol} »).`);
  }
} catch (e) {
  log('warn', `SIL injoignable au démarrage (${e.message}) : les messages seront conservés et transmis plus tard.`);
}

// ---------------------------------------------------------------------------
// Liaison avec l'automate par TCP (ASTM ou HL7)
// ---------------------------------------------------------------------------

function attach(socket) {
  const peer = `${socket.remoteAddress}:${socket.remotePort}`;
  log('info', `Automate connecté (${peer}).`);
  socket.setNoDelay(true);
  const write = (data) => socket.write(encode(data));

  if (config.protocol === 'hl7') {
    const rx = new MllpReceiver(async (message) => {
      const text = decode(message);
      const name = spool.put(text);
      try {
        const r = await api.send(text);
        spool.done(name);
        log('info', `HL7 transmis : ${r.status}${r.duplicate ? ' (déjà reçu)' : ''}.`);
        write(wrapMllp(r.ack ?? localAck(text)));
      } catch (e) {
        log('warn', `${e.message} — message HL7 conservé, accusé de réception local envoyé.`);
        write(wrapMllp(localAck(text)));
        sender.kick();
      }
    });
    socket.on('data', (buf) => rx.feed(buf.toString('latin1')));
  } else {
    // ASTM : les caractères de contrôle attendus pendant une émission vers l'automate
    const waiters = [];
    let sending = false;
    const nextControl = () =>
      new Promise((resolveCtl, reject) => {
        const t = setTimeout(() => reject(new Error('Pas de réponse de l’automate (15 s).')), 15_000);
        waiters.push((c) => {
          clearTimeout(t);
          resolveCtl(c);
        });
      });

    const rx = new AstmReceiver({
      onLog: log,
      onMessage: async (latin1) => {
        const text = decode(latin1);
        spool.put(text);
        sender.kick();
        // Requête hôte (enregistrement Q) : renvoyer les commandes des tubes demandés.
        const queries = text.split(/\r|\n/).filter((r) => /^\d?Q\|/.test(r));
        if (queries.length > 0 && config.hostQuery !== false) {
          const specimens = queries.flatMap((q) => (q.split('|')[2] ?? '').split('\\').map((x) => x.split('^').filter(Boolean)[0] ?? '')).filter(Boolean);
          try {
            const wl = await api.worklist(specimens);
            sending = true;
            await sendAstm(write, nextControl, wl.astm);
            log('info', `Réponse à la requête hôte : ${wl.orders.length} commande(s) pour ${specimens.join(', ') || 'tous les tubes'}.`);
          } catch (e) {
            log('warn', `Requête hôte non satisfaite : ${e.message}`);
          } finally {
            sending = false;
          }
        }
      },
    });
    socket.on('data', (buf) => {
      const chunk = buf.toString('latin1');
      if (process.env.LIMS_DEBUG) log('debug', `reçu ${JSON.stringify(chunk.slice(0, 20))} sending=${sending} waiters=${waiters.length}`);
      if (sending && waiters.length > 0 && [ACK, NAK, EOT, ENQ].includes(chunk[0])) {
        waiters.shift()(chunk[0]);
        return;
      }
      const reply = rx.feed(chunk);
      if (reply) write(reply);
    });
    const timer = setInterval(() => rx.checkTimeout(), 5_000);
    socket.on('close', () => clearInterval(timer));
  }
  socket.on('error', (e) => log('warn', `Liaison ${peer} : ${e.message}`));
  socket.on('close', () => log('info', `Automate déconnecté (${peer}).`));
}

if (config.mode === 'tcp-server') {
  const server = net.createServer(attach);
  server.listen(config.port ?? 5000, config.host ?? '0.0.0.0', () => log('info', `En écoute sur ${config.host ?? '0.0.0.0'}:${config.port ?? 5000} (${config.protocol.toUpperCase()}).`));
} else if (config.mode === 'tcp-client') {
  // L'automate (ou un convertisseur série/IP) écoute : le connecteur s'y raccorde et se reconnecte en cas de coupure.
  const connect = () => {
    const socket = net.connect({ host: config.host, port: config.port }, () => attach(socket));
    socket.on('error', () => {});
    socket.on('close', () => setTimeout(connect, 10_000));
  };
  connect();
  log('info', `Connexion à l’automate ${config.host}:${config.port}…`);
} else if (config.mode === 'folder') {
  // L'automate dépose des fichiers d'export : ils sont transmis puis archivés.
  const watchDir = resolve(baseDir, config.folder ?? 'depot');
  const archiveDir = join(dataDir, 'archives');
  const rejectDir = join(dataDir, 'fichiers-refuses');
  for (const d of [watchDir, archiveDir, rejectDir]) mkdirSync(d, { recursive: true });
  const extensions = (config.extensions ?? ['.txt', '.csv', '.astm', '.hl7', '.dat']).map((e) => e.toLowerCase());
  const poll = async () => {
    for (const f of readdirSync(watchDir)) {
      const path = join(watchDir, f);
      if (!extensions.includes(extname(f).toLowerCase())) continue;
      const st = statSync(path);
      if (!st.isFile() || Date.now() - st.mtimeMs < 3_000) continue; // fichier encore en cours d'écriture
      const content = readFileSync(path, encoding === 'utf8' ? 'utf8' : 'latin1');
      try {
        const r = await api.send(content);
        const day = join(archiveDir, new Date().toISOString().slice(0, 10));
        mkdirSync(day, { recursive: true });
        renameSync(path, join(day, f));
        log('info', `Fichier ${f} transmis : ${r.status}${r.duplicate ? ' (déjà reçu)' : ''}.`);
      } catch (e) {
        if (e.retryable) {
          log('warn', `Fichier ${f} : ${e.message} — nouvel essai au prochain passage.`);
          break;
        }
        renameSync(path, join(rejectDir, f));
        writeFileSync(join(rejectDir, `${f}.motif.txt`), `${e.status} ${e.message}\n`);
        log('error', `Fichier ${f} refusé : ${e.message}`);
      }
    }
  };
  setInterval(poll, (config.pollSeconds ?? 10) * 1000);
  poll();
  log('info', `Surveillance du dossier ${watchDir} (${extensions.join(', ')}).`);
} else {
  log('error', `Mode « ${config.mode} » inconnu (tcp-server, tcp-client ou folder).`);
  process.exit(2);
}

process.on('SIGINT', () => {
  log('info', `Arrêt du connecteur (${spool.pending().length} message(s) en file d’attente, conservés pour le prochain démarrage).`);
  process.exit(0);
});
