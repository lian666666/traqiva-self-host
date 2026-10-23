import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { readTerminalKey as readProjectKey } from '../lib/private-input.mjs';

const previousTerm = process.env.TERM;
before(() => { process.env.TERM = 'xterm'; });
after(() => { if (previousTerm === undefined) delete process.env.TERM; else process.env.TERM = previousTerm; });

function terminal({ raw = false, paused = true } = {}) {
  const input = new PassThrough();
  input.isTTY = true; input.isRaw = raw;
  input.setRawMode = value => { input.isRaw = value; };
  if (paused === true) input.pause(); else if (paused === false) input.resume();
  let printed = '';
  const output = new Writable({ write(chunk, _encoding, done) { printed += chunk.toString(); done(); } });
  output.isTTY = true;
  return { input, output, printed: () => printed };
}

test('private key entry supports paste and correction without echo and restores the terminal', async () => {
  const t = terminal();
  const result = readProjectKey(t);
  t.input.write('trq_synthetic_wrong');
  for (let i = 0; i < 5; i++) t.input.write('\x7f');
  t.input.write('correct\r');
  assert.equal(await result, 'trq_synthetic_correct');
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.isPaused(), true);
  assert.equal(t.input.listenerCount('keypress'), 0);
  assert.equal(t.input.listenerCount('error'), 0);
  assert.equal(t.printed(), 'Project key (input hidden; Ctrl+C cancels): \n');
});

for (const [name, finish, message] of [
  ['Ctrl+C', t => t.input.write('\x03'), /cancelled/],
  ['end of input', t => t.input.end(), /ended before submission/],
  ['input failure', t => t.input.emit('error', new Error('trq_private_not_for_output')), /input failed/],
  ['oversized paste', t => t.input.write('x'.repeat(4097)), /8 to 4096/],
  ['empty submission', t => t.input.write('\r'), /8 to 4096/],
  ['pasted whitespace', t => t.input.write('trq_key value\r'), /8 to 4096/],
]) {
  test(`private key entry cleans up after ${name}`, async () => {
    const t = terminal({ raw: true, paused: false });
    const result = readProjectKey(t);
    finish(t);
    await assert.rejects(result, message);
    assert.equal(t.input.isRaw, true);
    assert.equal(t.input.isPaused(), false);
    assert.equal(t.input.listenerCount('keypress'), 0);
    assert.equal(t.input.listenerCount('error'), 0);
    assert.equal(t.printed(), 'Project key (input hidden; Ctrl+C cancels): \n');
  });
}

test('private key entry refuses streams that cannot hide input', async () => {
  const t = terminal(); t.input.isTTY = false;
  await assert.rejects(readProjectKey(t), /interactive terminal/);
  assert.equal(t.printed(), '');
  assert.equal(t.input.listenerCount('data'), 0);
});

test('private key entry releases an initially unconsumed terminal so the command can exit', async () => {
  const t = terminal({ paused: null });
  assert.equal(t.input.readableFlowing, null);
  const result = readProjectKey(t);
  t.input.write('trq_synthetic_exit_check\r');
  assert.equal(await result, 'trq_synthetic_exit_check');
  assert.equal(t.input.isPaused(), true);
});

test('submission closes raw console input before another read can be queued', async () => {
  const t = terminal({ paused: false });
  const result = readProjectKey(t);
  t.input.write('trq_synthetic_sync_close\r');
  assert.equal(t.input.isRaw, false);
  assert.equal(await result, 'trq_synthetic_sync_close');
});
