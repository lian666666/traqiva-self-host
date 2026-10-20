import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { engineStatus, installEngine, nativeCompress, nativeRecover } from '../lib/native.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const windowsBuild = fileURLToPath(new URL('../../runtime/build/traqiva-engine-0.1.0-windows-amd64.exe', import.meta.url));
const downloadDirectory = fileURLToPath(new URL('../../public/downloads/', import.meta.url));
async function isolated(t) {
  const home = await mkdtemp(join(tmpdir(), 'traqiva-native-test-'));
  const previous = process.env.TRAQIVA_HOME;
  process.env.TRAQIVA_HOME = home;
  t.after(async () => { if (previous === undefined) delete process.env.TRAQIVA_HOME; else process.env.TRAQIVA_HOME = previous; await rm(home, { recursive: true, force: true }); });
  return home;
}

test('engine installation refuses a corrupt archive and never marks it installed', async (t) => {
  const home = await isolated(t);
  const notices = Buffer.from(JSON.stringify({ files: [] }));
  const archive = gzipSync(Buffer.from('not a native executable'));
  const manifest = { schema_version: 1, version: '0.1.0', notices: { file: 'engine-notices.json', sha256: sha(notices) }, artifacts: { [`${process.platform}-${process.arch}`]: { file: 'engine.gz', sha256: '0'.repeat(64), binary_sha256: sha(Buffer.from('not a native executable')) } } };
  const server = createServer((request, response) => {
    response.end(request.url.endsWith('engine-manifest.json') ? JSON.stringify(manifest) : request.url.endsWith('engine-notices.json') ? notices : archive);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  await assert.rejects(installEngine(`http://127.0.0.1:${server.address().port}`), /SHA-256 verification/);
  assert.equal((await engineStatus()).installed, false);
  assert.equal(existsSync(join(home, 'bin', process.platform === 'win32' ? 'traqiva-engine.exe' : 'traqiva-engine')), false);
});

test('source-built Windows engine genuinely compresses logs and recovers exact text without cloud', { skip: process.platform !== 'win32' || !existsSync(windowsBuild) }, async (t) => {
  const home = await isolated(t);
  await mkdir(join(home, 'bin'));
  const binary = await readFile(windowsBuild);
  await copyFile(windowsBuild, join(home, 'bin', 'traqiva-engine.exe'));
  await writeFile(join(home, 'engine.json'), JSON.stringify({ version: '0.1.0', sha256: sha(binary) }));
  const original = '2026-10-20 INFO start\r\n' + '2026-10-20 INFO worker=checkout status=ok processed=1\r\n'.repeat(150) + '2026-10-20 ERROR DB_TIMEOUT retry=true\r\n2026-10-20 INFO end\r\n';
  const result = await nativeCompress(original, 'log');
  assert.equal(result.runtime, 'native');
  assert.equal(result.changed, true);
  assert.equal(result.recovery_verified, true);
  assert.ok(result.optimized_tokens_estimate < result.original_tokens_estimate);
  assert.match(result.compressedText, /DB_TIMEOUT/);
  assert.match(result.recovery_handle, /^local:ccr_/);
  assert.equal((await nativeRecover(result.recovery_handle)).original, original);
  assert.equal(existsSync(join(home, 'recovery.db')), true);
  assert.equal(existsSync(join(home, '.caveman')), false);
});

test('explicit native installation verifies the published manifest, notices and executable before use', { skip: process.platform !== 'win32' || !existsSync(join(downloadDirectory, 'engine-manifest.json')) }, async (t) => {
  const home = await isolated(t);
  const server = createServer(async (request, response) => {
    try {
      const name = request.url.slice('/downloads/'.length);
      if (!request.url.startsWith('/downloads/') || !/^[a-zA-Z0-9._-]+$/.test(name)) { response.writeHead(404).end(); return; }
      response.end(await readFile(join(downloadDirectory, name)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  const result = await installEngine(`http://127.0.0.1:${server.address().port}`);
  assert.equal(result.installed, true);
  assert.equal(result.runtime_info.schema, 'traqiva.engine.v1');
  assert.equal(result.automatic_agent_configuration, false);
  const notices = JSON.parse(await readFile(join(home, 'engine-NOTICES.json'), 'utf8'));
  assert.ok(notices.files.length > 10);
  const receipt = await nativeCompress('INFO start\n' + 'INFO row=42 result=ok count=1\n'.repeat(100) + 'ERROR AUTH_EXPIRED\nINFO end\n', 'log');
  assert.equal(receipt.changed, true);
  assert.match(receipt.compressedText, /AUTH_EXPIRED/);
  assert.equal(existsSync(join(home, 'config.json')), false);
});
