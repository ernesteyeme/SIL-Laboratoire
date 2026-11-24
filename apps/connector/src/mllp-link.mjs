// Enveloppe MLLP (HL7 sur TCP) : VT message FS CR.
export const VT = '\x0b';
export const FS = '\x1c';

export class MllpReceiver {
  /** @param {(message: string) => void} onMessage */
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = '';
  }

  feed(chunk) {
    this.buffer += chunk;
    for (;;) {
      const start = this.buffer.indexOf(VT);
      if (start === -1) {
        this.buffer = '';
        return;
      }
      const end = this.buffer.indexOf(FS, start);
      if (end === -1) {
        this.buffer = this.buffer.slice(start);
        return;
      }
      const message = this.buffer.slice(start + 1, end);
      this.buffer = this.buffer.slice(end + 1).replace(/^\r/, '');
      if (message.trim()) this.onMessage(message);
    }
  }
}

export const wrapMllp = (message) => `${VT}${message}${FS}\r`;

/** ACK HL7 minimal construit localement (utilisé quand le SIL est injoignable et que le message est mis en file). */
export function localAck(message, code = 'AA', text = 'Message reçu, transmission différée') {
  const msh = message.split(/\r|\n/)[0] ?? '';
  const fs = msh[3] ?? '|';
  const f = msh.split(fs);
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `MSH${fs}${f[1] ?? '^~\\&'}${fs}SIL-CONNECTEUR${fs}${fs}${f[2] ?? ''}${fs}${f[3] ?? ''}${fs}${ts}${fs}${fs}ACK${fs}ACK${ts}${fs}P${fs}${f[11] ?? '2.5'}\rMSA${fs}${code}${fs}${f[9] ?? ''}${fs}${text}\r`;
}
