import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { startAgentProxy, readProxyMetadata } from '../lib/agent.mjs';
import { nativeRecover } from '../lib/native.mjs';
import { setControl } from '../lib/controls.mjs';

const proxyBuild = fileURLToPath(new URL('../../runtime/build/traqiva-proxy-windows-amd64.exe', import.meta.url));
const engineBuild = fileURLToPath(new URL('../../runtime/build/traqiva-engine-0.1.0-windows-amd64.exe', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('source-built native proxy compresses actual Responses tool traffic, preserves SSE and recovers the exact source through Traqiva names', { skip: process.platform !== 'win32' || !existsSync(proxyBuild) || !existsSync(engineBuild), timeout: 30000 }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'traqiva-proxy-integration-'));
  const previous = process.env.TRAQIVA_HOME; process.env.TRAQIVA_HOME = home;
  let bridge; let upstream;
  t.after(async () => {
    await bridge?.stop();
    if (upstream) { upstream.closeAllConnections(); await new Promise((done) => upstream.close(done)); }
    if (previous === undefined) delete process.env.TRAQIVA_HOME; else process.env.TRAQIVA_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });
  await mkdir(join(home, 'bin'));
  for (const [source, name, receipt] of [[proxyBuild, 'traqiva-proxy.exe', 'proxy-install.json'], [engineBuild, 'traqiva-engine.exe', 'engine.json']]) {
    await copyFile(source, join(home, 'bin', name));
    await writeFile(join(home, receipt), JSON.stringify({ version: '0.1.0-traqiva', sha256: sha(await readFile(source)) }));
  }
  const captured = [];
  const expectedSse = 'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_mock","status":"completed","output":[],"usage":{"input_tokens":99,"output_tokens":2,"input_tokens_details":{"cached_tokens":0}}}}\n\n';
  upstream = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    captured.push({ path: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(expectedSse);
  });
  await new Promise((done) => upstream.listen(0, '127.0.0.1', done));
  bridge = await startAgentProxy({ home, providerConfig: { openai: { base_url: `http://127.0.0.1:${upstream.address().port}` } }, extraEnv: { CAVE_SSRF_ALLOWLIST: `127.0.0.1:${upstream.address().port}` } });
  const log = '2026-10-20 INFO begin\n' + '2026-10-20 INFO worker=jobs result=ok count=1\n'.repeat(300) + '2026-10-20 ERROR DB_TIMEOUT retry=true\n2026-10-20 INFO end\n';
  const body = {
    model: 'gpt-6.1-sol', stream: true,
    input: [{ role: 'user', content: 'Report the DB_TIMEOUT line.' }, { type: 'function_call', call_id: 'call_read', name: 'read_log', arguments: '{}' }, { type: 'function_call_output', call_id: 'call_read', output: log }],
    tools: [{ type: 'function', name: 'mcp__traqiva__traqiva_retrieve', description: 'Recover exact original', parameters: { type: 'object', properties: { recovery_handle: { type: 'string' } }, required: ['recovery_handle'] } }],
  };
  const response = await fetch(bridge.url + '/openai/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-test-key' }, body: JSON.stringify(body) });
  const receivedSse = await response.text();
  assert.equal(response.status, 200, receivedSse);
  assert.equal(receivedSse, expectedSse);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].authorization, 'Bearer synthetic-test-key');
  assert.ok(captured[0].body.length < JSON.stringify(body).length / 2, 'tool result must actually shrink on the upstream wire');
  const transformed = JSON.parse(captured[0].body);
  assert.equal(transformed.input[0].content, body.input[0].content, 'user instructions must remain unchanged');
  assert.match(captured[0].body, /DB_TIMEOUT/);
  const handles = [...captured[0].body.matchAll(/ccr_[a-f0-9]{32}/g)].map((match) => match[0]);
  assert.ok(handles.length > 0, 'must publish a recoverable native handle');
  assert.equal((await nativeRecover(handles[0])).original, log);
  await bridge.stop();
  const rows = await readProxyMetadata(bridge.database);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status_code, 200);
  assert.notEqual(rows[0].raw_request_sha256, rows[0].transformed_request_sha256);
  await setControl('read-less', false, { home });
  bridge = await startAgentProxy({ home, providerConfig: { openai: { base_url: `http://127.0.0.1:${upstream.address().port}` } }, extraEnv: { CAVE_SSRF_ALLOWLIST: `127.0.0.1:${upstream.address().port}` } });
  const raw = JSON.stringify(body);
  const unchanged = await fetch(bridge.url + '/openai/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-test-key' }, body: raw });
  assert.equal(await unchanged.text(), expectedSse);
  assert.equal(captured.at(-1).body, raw, 'Read Less off must leave the actual upstream request unchanged');
});
