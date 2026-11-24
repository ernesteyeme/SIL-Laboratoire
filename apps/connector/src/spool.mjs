// File d'attente sur disque : un message reçu de l'automate est écrit AVANT toute tentative d'envoi,
// et n'est supprimé qu'après acceptation par le SIL. Une coupure réseau ou un redémarrage ne perd rien.
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export class Spool {
  constructor(dir) {
    this.dir = dir;
    this.errorDir = join(dir, 'erreurs');
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(this.errorDir, { recursive: true });
  }

  /** Enregistre un message ; le nom garantit l'ordre d'arrivée. */
  put(message) {
    const name = `${Date.now().toString().padStart(15, '0')}-${randomBytes(3).toString('hex')}.msg`;
    const tmp = join(this.dir, `${name}.tmp`);
    writeFileSync(tmp, message, 'utf8');
    renameSync(tmp, join(this.dir, name)); // écriture atomique
    return name;
  }

  pending() {
    return readdirSync(this.dir).filter((f) => f.endsWith('.msg')).sort();
  }

  read(name) {
    return readFileSync(join(this.dir, name), 'utf8');
  }

  done(name) {
    unlinkSync(join(this.dir, name));
  }

  /** Message refusé définitivement par le SIL (contenu invalide) : mis de côté avec l'explication. */
  reject(name, reason) {
    renameSync(join(this.dir, name), join(this.errorDir, name));
    writeFileSync(join(this.errorDir, `${name}.motif.txt`), `${new Date().toISOString()} ${reason}\n`, 'utf8');
  }
}

/**
 * Boucle d'envoi : transmet les messages en attente dans l'ordre, s'arrête au premier échec temporaire
 * et réessaie avec un délai croissant (5 s → 5 min).
 */
export function startSender(spool, api, log, { onResult } = {}) {
  let delay = 5_000;
  let running = false;
  let timer = null;
  async function drain() {
    if (running) return;
    running = true;
    try {
      for (const name of spool.pending()) {
        const message = spool.read(name);
        try {
          const r = await api.send(message);
          spool.done(name);
          delay = 5_000;
          const counts = Object.entries(r.counts ?? {}).map(([k, v]) => `${k}=${v}`).join(' ');
          log('info', `Message transmis${r.duplicate ? ' (déjà reçu par le SIL)' : ''} : ${r.status} ${counts}`);
          onResult?.(r, message);
        } catch (e) {
          if (e.retryable) {
            log('warn', `${e.message} — nouvel essai dans ${Math.round(delay / 1000)} s (${spool.pending().length} message(s) en attente).`);
            delay = Math.min(delay * 2, 300_000);
            break;
          }
          log('error', `Message refusé par le SIL (${e.status}) : ${e.message} — mis de côté dans « erreurs ».`);
          spool.reject(name, `${e.status} ${e.message}`);
        }
      }
    } finally {
      running = false;
      clearTimeout(timer);
      timer = setTimeout(drain, spool.pending().length ? delay : 5_000);
    }
  }
  drain();
  return { kick: () => setImmediate(drain), stop: () => clearTimeout(timer) };
}
