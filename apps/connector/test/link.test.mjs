import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACK, AstmReceiver, buildFrames, checksum, ENQ, EOT, NAK } from '../src/astm-link.mjs';
import { localAck, MllpReceiver, wrapMllp } from '../src/mllp-link.mjs';

const MSG = 'H|\\^&\rP|1\rO|1|2611220001\rR|1|^^^HGB|12.8|g/dL\rL|1|N\r';

test('somme de contrôle E1381', () => {
  assert.equal(checksum('1H\r\x03'), ((0x31 + 0x48 + 0x0d + 0x03) % 256).toString(16).toUpperCase());
});

test('réception complète : ACK à l’établissement et à chaque trame, message remis à EOT', () => {
  const got = [];
  const rx = new AstmReceiver({ onMessage: (m) => got.push(m) });
  assert.equal(rx.feed(ENQ), ACK);
  for (const f of buildFrames(MSG)) assert.equal(rx.feed(f), ACK);
  assert.equal(rx.feed(EOT), '');
  assert.deepEqual(got, [MSG]);
});

test('octets reçus en morceaux arbitraires', () => {
  const got = [];
  const rx = new AstmReceiver({ onMessage: (m) => got.push(m) });
  const all = ENQ + buildFrames(MSG).join('') + EOT;
  let replies = '';
  for (let i = 0; i < all.length; i += 3) replies += rx.feed(all.slice(i, i + 3));
  assert.equal(replies, ACK.repeat(1 + buildFrames(MSG).length));
  assert.deepEqual(got, [MSG]);
});

test('somme de contrôle fausse → NAK, puis la retransmission correcte est acceptée', () => {
  const got = [];
  const rx = new AstmReceiver({ onMessage: (m) => got.push(m) });
  rx.feed(ENQ);
  const [f1, f2, ...rest] = buildFrames(MSG);
  rx.feed(f1);
  const bad = f2.slice(0, -4) + (f2.slice(-4, -2) === '00' ? '01' : '00') + '\r\n';
  assert.equal(rx.feed(bad), NAK);
  assert.equal(rx.feed(f2), ACK);
  for (const f of rest) rx.feed(f);
  rx.feed(EOT);
  assert.deepEqual(got, [MSG]);
});

test('trame retransmise après perte de l’ACK : acquittée sans doublon', () => {
  const got = [];
  const rx = new AstmReceiver({ onMessage: (m) => got.push(m) });
  rx.feed(ENQ);
  const frames = buildFrames(MSG);
  rx.feed(frames[0]);
  assert.equal(rx.feed(frames[0]), ACK);
  for (const f of frames.slice(1)) rx.feed(f);
  rx.feed(EOT);
  assert.deepEqual(got, [MSG]);
});

test('trame hors séquence → NAK ; enregistrement long découpé en trames ETB et recollé', () => {
  const rx = new AstmReceiver({ onMessage: () => {} });
  rx.feed(ENQ);
  assert.equal(rx.feed(buildFrames(MSG)[1]), NAK);
  const long = `H|\\^&\rC|1|I|${'x'.repeat(600)}|G\rL|1|N\r`;
  const frames = buildFrames(long);
  assert.ok(frames.length >= 4 && frames.some((f) => f.includes('\x17')));
  const got = [];
  const rx2 = new AstmReceiver({ onMessage: (m) => got.push(m) });
  rx2.feed(ENQ);
  for (const f of frames) assert.equal(rx2.feed(f), ACK);
  rx2.feed(EOT);
  assert.deepEqual(got, [long]);
});

test('transmission interrompue : abandon après le délai', () => {
  const got = [];
  const rx = new AstmReceiver({ onMessage: (m) => got.push(m), timeoutMs: 10 });
  rx.feed(ENQ);
  rx.feed(buildFrames(MSG)[0]);
  rx.checkTimeout(Date.now() + 1000);
  assert.equal(rx.state, 'idle');
  rx.feed(EOT);
  assert.deepEqual(got, []);
});

test('MLLP : messages successifs dans un même flux, ACK local', () => {
  const got = [];
  const rx = new MllpReceiver((m) => got.push(m));
  const m1 = 'MSH|^~\\&|A|B|C|D|20261122||ORU^R01|42|P|2.5\rOBX|1';
  rx.feed(wrapMllp(m1).slice(0, 10));
  rx.feed(wrapMllp(m1).slice(10) + wrapMllp('MSH|x'));
  assert.deepEqual(got, [m1, 'MSH|x']);
  assert.match(localAck(m1).split('\r')[1], /^MSA\|AA\|42\|/);
});
