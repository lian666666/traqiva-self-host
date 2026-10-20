import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const bin = fileURLToPath(new URL('../bin/traqiva.mjs', import.meta.url));
const projectKey = 'trq_test_private_ingest_key_which_must_not_be_printed';
const project = 'test-project';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'traqiva-cli-test-'));
  const received = [];
  const originals = new Map();
  const behavior = { corruptRecovery: false };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : null;
    received.push({ url: request.url, headers: request.headers, body });
    response.setHeader('content-type', 'application/json');
    if (request.headers['x-traqiva-key'] !== projectKey) {
      response.writeHead(401).end(JSON.stringify({ error: 'Invalid project key' }));
      return;
    }
    if (request.url === '/api/connection') {
      response.end(JSON.stringify({ connected: true, project: { id: project, name: 'Test' }, workspace: { id: 'w1', name: 'Workspace', mode: 'live' } }));
    } else if (request.url === '/api/ingest') {
      response.end(JSON.stringify({ accepted: body.records.length, ids: body.records.map((_, i) => `trace-${i}`) }));
    } else if (request.url === '/api/compress') {
      const original = body.text;
      const compressedText = JSON.stringify(JSON.parse(original));
      const recovery_handle = `h-${originals.size + 1}`;
      originals.set(recovery_handle, original);
      response.end(JSON.stringify({ compressedText, algorithm: 'json_minify', original_tokens_estimate: 20, optimized_tokens_estimate: 10, token_basis: 'estimated', recovery_handle, changed: original !== compressedText }));
    } else if (request.url.startsWith('/api/recover/')) {
      const handle = decodeURIComponent(request.url.slice('/api/recover/'.length));
      if (!originals.has(handle)) { response.writeHead(404).end(JSON.stringify({ error: 'Recovery not found' })); return; }
      response.end(JSON.stringify({ original: behavior.corruptRecovery ? 'a different original' : originals.get(handle), project_id: project, content_type: 'json', created_at: new Date().toISOString() }));
    } else if (request.url === '/v1/chat/completions') {
      response.setHeader('content-type', 'text/event-stream');
      response.write('data: {"id":"hello","usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n');
      response.end('data: [DONE]\n\n');
    } else if (request.url === '/v1/responses') {
      response.writeHead(429).end(JSON.stringify({ error: { message: 'Rate limit reached' } }));
    } else {
      response.writeHead(404).end(JSON.stringify({ error: 'Unknown route' }));
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(home, { recursive: true, force: true }); });
  const env = { ...process.env, TRAQIVA_HOME: home };
  async function run(args, stdin = '') {
    return await new Promise((done) => {
      const child = spawn(process.execPath, [bin, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => done({ code, stdout, stderr }));
      child.stdin.end(stdin);
    });
  }
  async function connect() {
    const result = await run(['connect', '--url', url, '--project', project, '--key', projectKey]);
    assert.equal(result.code, 0, result.stderr);
    return result;
  }
  return { home, env, url, run, received, originals, behavior, connect };
}

test('connect validates remote identity, stores credentials privately and never prints the key', async (t) => {
  const f = await fixture(t);
  const bad = await f.run(['connect', '--url', f.url, '--project', 'wrong-project', '--key', projectKey]);
  assert.notEqual(bad.code, 0);
  await assert.rejects(readFile(join(f.home, 'config.json')));
  const result = await f.connect();
  assert.equal(`${result.stdout}${result.stderr}`.includes(projectKey), false);
  const config = JSON.parse(await readFile(join(f.home, 'config.json'), 'utf8'));
  assert.equal(config.url, f.url);
  assert.equal(config.project, project);
  assert.equal(config.key, projectKey);
  if (process.platform !== 'win32') assert.equal((await stat(join(f.home, 'config.json'))).mode & 0o777, 0o600);
  const status = await f.run(['status']);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).connected, true);
});

test('missing configuration and invalid URL never claim connected', async (t) => {
  const f = await fixture(t);
  const result = await f.run(['status']);
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout.includes('"connected":true'), false);
  const unsafe = await f.run(['connect', '--url', 'https://user:secret@example.com', '--project', project, '--key', projectKey]);
  assert.notEqual(unsafe.code, 0);
  assert.equal(unsafe.stderr.includes('secret'), false);
});

test('record sends JSON trace metadata and reports accepted records', async (t) => {
  const f = await fixture(t); await f.connect();
  const file = join(f.home, 'trace.json');
  await writeFile(file, JSON.stringify({ records: [{ model: 'test-model', provider: 'openai', input_tokens: 10, output_tokens: 2, source: 'cli' }] }));
  const result = await f.run(['record', file]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).accepted, 1);
  assert.equal(f.received.at(-1).body.records[0].model, 'test-model');
});

test('record refuses credential fields before making an ingestion request', async (t) => {
  const f = await fixture(t); await f.connect();
  const file = join(f.home, 'unsafe-trace.json');
  await writeFile(file, JSON.stringify({ model: 'test', request: { headers: { Authorization: 'Bearer do-not-upload' } } }));
  const before = f.received.length;
  const result = await f.run(['record', file]);
  assert.notEqual(result.code, 0);
  assert.equal(f.received.length, before);
  assert.equal(result.stderr.includes('do-not-upload'), false);
});

test('compress and recover use real remote recovery and preserve exact original whitespace', async (t) => {
  const f = await fixture(t); await f.connect();
  const original = '{\n  "items": [1, 2, 3],\n  "safe": true\n}\n';
  const file = join(f.home, 'payload.json'); await writeFile(file, original);
  const compressed = await f.run(['compress', file]);
  assert.equal(compressed.code, 0, compressed.stderr);
  const result = JSON.parse(compressed.stdout);
  assert.equal(result.compressedText, JSON.stringify(JSON.parse(original)));
  assert.equal(result.evidence_basis, 'inferred');
  const recovered = await f.run(['recover', result.recovery_handle]);
  assert.equal(recovered.code, 0, recovered.stderr);
  assert.equal(recovered.stdout, original);
  const absent = await f.run(['recover', 'not-found']);
  assert.notEqual(absent.code, 0);
});

test('compress publishes no receipt when the recovery read does not reproduce the source', async (t) => {
  const f = await fixture(t); await f.connect();
  f.behavior.corruptRecovery = true;
  const file = join(f.home, 'original.json');
  await writeFile(file, '{ "must": "survive" }\n');
  const result = await f.run(['compress', file]);
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Recovery verification/);
});

test('stdio MCP implements negotiation, tools, recovery, session stats and structured tool failures', async (t) => {
  const f = await fixture(t); await f.connect();
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'traqiva_compress', arguments: { input: '{\n "hello": "world"\n}' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'traqiva_retrieve', arguments: { recovery_handle: 'h-1' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'traqiva_stats', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'traqiva_retrieve', arguments: { recovery_handle: 'missing' } } },
  ];
  const result = await f.run(['mcp'], requests.map((x) => JSON.stringify(x)).join('\n') + '\n');
  assert.equal(result.code, 0, result.stderr);
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(replies.length, 6);
  assert.equal(replies[0].result.protocolVersion, '2024-11-05');
  assert.ok(replies[1].result.tools.some((tool) => tool.name === 'traqiva_retrieve'));
  assert.equal(JSON.parse(replies[3].result.content[0].text).original, '{\n "hello": "world"\n}');
  const stats = JSON.parse(replies[4].result.content[0].text);
  assert.equal(stats.compression_requests, 1);
  assert.equal(stats.evidence_basis, 'inferred');
  assert.equal(replies[5].result.isError, true);
  assert.equal(result.stdout.includes(projectKey), false);
});

test('MCP returns protocol errors for malformed calls without stdout chatter', async (t) => {
  const f = await fixture(t); await f.connect();
  const result = await f.run(['mcp'], '{broken\n' + JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
  assert.equal(result.code, 0, result.stderr);
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(replies[0].error.code, -32700);
  assert.equal(replies[1].error.code, -32002);
});

test('setup prints explicit MCP config without writing host agent configuration', async (t) => {
  const f = await fixture(t);
  const result = await f.run(['setup', '--agent', 'codex', '--print']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[mcp_servers\.traqiva\]/);
  assert.match(result.stdout, /mcp/);
  await assert.rejects(readFile(join(f.home, 'config.json')));
  const refused = await f.run(['setup', '--agent', 'claude', '--apply']);
  assert.notEqual(refused.code, 0);
});

test('local server forwards authenticated API traffic and preserves SSE and upstream errors', async (t) => {
  const f = await fixture(t); await f.connect();
  const child = spawn(process.execPath, [bin, 'serve', '--port', '0'], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => child.kill());
  const ready = await new Promise((done, reject) => {
    let stderr = ''; const timeout = setTimeout(() => reject(new Error(`Proxy did not start: ${stderr}`)), 5000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const line = stderr.split('\n').find((entry) => entry.includes('"listening"'));
      if (line) { clearTimeout(timeout); done(JSON.parse(line)); }
    });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Proxy exited ${code}: ${stderr}`)); });
  });
  const response = await fetch(`${ready.listening}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer local-test-provider-key', 'content-type': 'application/json', cookie: 'private-cookie=do-not-forward' }, body: JSON.stringify({ model: 'test', messages: [] }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(await response.text(), /data: \[DONE\]/);
  assert.equal(f.received.at(-1).headers.authorization, 'Bearer local-test-provider-key');
  assert.equal(f.received.at(-1).headers.cookie, undefined);
  const limited = await fetch(`${ready.listening}/v1/responses`, { method: 'POST', headers: { authorization: 'Bearer local-test-provider-key', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(limited.status, 429);
  const noKey = await fetch(`${ready.listening}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noKey.status, 401);
  const unknown = await fetch(`${ready.listening}/not-supported`);
  assert.equal(unknown.status, 404);
});
