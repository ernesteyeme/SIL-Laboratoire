// Couche liaison ASTM E1381 (LIS01-A2) côté SIL : réception (ENQ / trames / EOT) et émission vers l'automate.
// Aucune dépendance : les octets sont manipulés en latin1 pour que la somme de contrôle porte exactement sur les octets reçus.

export const ENQ = '\x05';
export const ACK = '\x06';
export const NAK = '\x15';
export const EOT = '\x04';
export const STX = '\x02';
export const ETX = '\x03';
export const ETB = '\x17';
export const CR = '\r';
export const LF = '\n';

/** Somme de contrôle E1381 : somme modulo 256 des octets du n° de trame jusqu'à ETX/ETB inclus, en 2 hexadécimaux. */
export function checksum(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum = (sum + body.charCodeAt(i)) % 256;
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/** Découpe un message (enregistrements séparés par CR) en trames de 240 caractères au plus (E1381 : 247 octets par trame). */
export function buildFrames(message, maxText = 240) {
  const frames = [];
  let fn = 1;
  const records = message.split(CR).filter((r) => r.length > 0);
  for (const record of records) {
    const text = record + CR;
    for (let i = 0; i < text.length; i += maxText) {
      const chunk = text.slice(i, i + maxText);
      const last = i + maxText >= text.length;
      const body = `${fn % 8}${chunk}${last ? ETX : ETB}`;
      frames.push(`${STX}${body}${checksum(body)}${CR}${LF}`);
      fn++;
    }
  }
  return frames;
}

/**
 * Récepteur E1381. On lui passe les octets reçus ; il renvoie les octets à répondre (ACK/NAK)
 * et signale chaque message complet (enregistrements ASTM non tramés) via onMessage.
 */
export class AstmReceiver {
  /** @param {{ onMessage: (text: string) => void, onLog?: (level: string, msg: string) => void, timeoutMs?: number }} opts */
  constructor(opts) {
    this.onMessage = opts.onMessage;
    this.log = opts.onLog ?? (() => {});
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.buffer = '';
    this.text = '';
    this.expected = 1;
    this.lastAccepted = null;
    this.lastActivity = Date.now();
  }

  /** Abandon d'une transmission interrompue (aucun octet depuis plus de timeoutMs). */
  checkTimeout(now = Date.now()) {
    if (this.state === 'receiving' && now - this.lastActivity > this.timeoutMs) {
      this.log('warn', 'Transmission interrompue (délai dépassé) : message partiel abandonné.');
      this.reset();
    }
  }

  /** @param {string} chunk octets reçus (latin1) @returns {string} octets à renvoyer à l'automate */
  feed(chunk) {
    this.lastActivity = Date.now();
    let reply = '';
    this.buffer += chunk;
    while (this.buffer.length > 0) {
      if (this.state === 'idle') {
        const i = this.buffer.indexOf(ENQ);
        if (i === -1) {
          this.buffer = '';
          break;
        }
        this.buffer = this.buffer.slice(i + 1);
        this.state = 'receiving';
        this.text = '';
        this.expected = 1;
        this.lastAccepted = null;
        reply += ACK;
        continue;
      }
      // État « réception »
      const c = this.buffer[0];
      if (c === EOT) {
        this.buffer = this.buffer.slice(1);
        const message = this.text;
        this.reset();
        if (message.trim().length > 0) this.onMessage(message);
        continue;
      }
      if (c === ENQ) {
        // Nouvel établissement sans EOT : on repart de zéro.
        this.buffer = this.buffer.slice(1);
        this.text = '';
        this.expected = 1;
        this.lastAccepted = null;
        reply += ACK;
        continue;
      }
      if (c !== STX) {
        this.buffer = this.buffer.slice(1);
        continue;
      }
      const lf = this.buffer.indexOf(LF);
      if (lf === -1) break; // trame incomplète : attendre la suite
      const frame = this.buffer.slice(0, lf + 1);
      this.buffer = this.buffer.slice(lf + 1);
      const m = frame.match(/^\x02([0-7])([\s\S]*)([\x03\x17])([0-9A-Fa-f]{2})\r\n$/);
      if (!m) {
        this.log('warn', 'Trame mal formée : NAK.');
        reply += NAK;
        continue;
      }
      const [, fnText, content, end, cs] = m;
      const fn = Number(fnText);
      if (cs.toUpperCase() !== checksum(fnText + content + end)) {
        this.log('warn', `Trame ${fn} : somme de contrôle invalide, NAK (l'automate va la renvoyer).`);
        reply += NAK;
        continue;
      }
      if (this.lastAccepted !== null && fn === this.lastAccepted) {
        // Retransmission d'une trame déjà acceptée (notre ACK s'est perdu) : on acquitte sans la dupliquer.
        reply += ACK;
        continue;
      }
      if (fn !== this.expected % 8) {
        this.log('warn', `Trame ${fn} reçue alors que ${this.expected % 8} était attendue : NAK.`);
        reply += NAK;
        continue;
      }
      this.text += content;
      this.lastAccepted = fn;
      this.expected = fn + 1;
      reply += ACK;
    }
    return reply;
  }
}

/**
 * Émission d'un message vers l'automate (réponse à une requête hôte) : ENQ, trames acquittées une à une, EOT.
 * @param {(data: string) => void} write
 * @param {() => Promise<string>} nextControl attend le prochain caractère de contrôle de l'automate (ACK, NAK, EOT, ENQ)
 */
export async function sendAstm(write, nextControl, message, { retries = 6 } = {}) {
  write(ENQ);
  const first = await nextControl();
  if (first !== ACK) throw new Error(first === ENQ ? 'Conflit : l’automate veut émettre en même temps (l’hôte cède la ligne).' : 'L’automate a refusé l’établissement (NAK).');
  for (const frame of buildFrames(message)) {
    let attempt = 0;
    for (;;) {
      write(frame);
      const r = await nextControl();
      if (r === ACK) break;
      if (r === EOT) {
        write(EOT);
        throw new Error('L’automate a interrompu la transmission (EOT).');
      }
      if (++attempt >= retries) {
        write(EOT);
        throw new Error('Trame refusée 6 fois : transmission abandonnée.');
      }
    }
  }
  write(EOT);
}
