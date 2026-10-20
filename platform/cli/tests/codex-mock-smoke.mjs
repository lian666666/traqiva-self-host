// Explicit real-Codex / local fake-provider smoke test; no real provider key,
// copied auth store, global config modification, or model-provider request.
import { createServer } from 'node:http';
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { startAgentProxy, buildCodexArgs, agentEnvironment, readProxyMetadata } from '../lib/agent.mjs';

const binary = process.env.CODEX_CLI_PATH;
if (!binary) throw new Error('Set CODEX_CLI_PATH to the official executable explicitly.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(new URL('../bin/traqiva.mjs', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'TraqivaCodexMock-'));
const home = join(directory, 'traqiva'); const codexHome = join(directory, 'codex');
await mkdir(join(home, 'bin'), { recursive: true }); await mkdir(codexHome);
await writeFile(join(codexHome, 'config.toml'), '');
for (const [source, name, receipt] of [['runtime/build/traqiva-proxy-windows-amd64.exe', 'traqiva-proxy.exe', 'proxy-install.json'], ['runtime/build/traqiva-engine-0.1.0-windows-amd64.exe', 'traqiva-engine.exe', 'engine.json']]) {
  const path = join(root, source); const bytes = await readFile(path);
  await copyFile(path, join(home, 'bin', name));
  await writeFile(join(home, receipt), JSON.stringify({ version: '0.1.0-traqiva', sha256: createHash('sha256').update(bytes).digest('hex') }));
}
process.env.TRAQIVA_HOME = home;
const requests = [];
const server = createServer(async (request, response) => {
  const chunks = []; for await (const part of request) chunks.push(part);
  let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = {}; }
  requests.push({ path: request.url, body, fake_key_forwarded: request.headers.authorization === 'Bearer traqiva-synthetic-not-a-real-key' });
  if (request.url.includes('/models')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"data":[]}'); return; }
  const output = [{ type: 'message', id: 'msg_mock', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'MOCK_OK', annotations: [] }] }];
  const completed = { id: 'resp_mock', object: 'response', created_at: 1792494000, status: 'completed', model: body.model || 'gpt-6.1-sol', output, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } } };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [{ type: 'response.created', response: { ...completed, status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item: { ...output[0], status: 'in_progress', content: [] } }, { type: 'response.output_text.delta', item_id: 'msg_mock', output_index: 0, content_index: 0, delta: 'MOCK_OK' }, { type: 'response.output_item.done', output_index: 0, item: output[0] }, { type: 'response.completed', response: completed }]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  response.end();
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const upstream = `127.0.0.1:${server.address().port}`;
let proxy;
try {
  proxy = await startAgentProxy({ home, providerConfig: { openai: { base_url: `http://${upstream}` } }, extraEnv: { CAVE_SSRF_ALLOWLIST: upstream } });
  const env = agentEnvironment({ ...process.env, CODEX_HOME: codexHome, OPENAI_API_KEY: 'traqiva-synthetic-not-a-real-key' }, home);
  delete env.OPENAI_BASE_URL;
  const args = buildCodexArgs({ proxyUrl: proxy.url, cliPath: cli, nodePath: process.execPath, auth: 'api', useEnvKey: true, userArgs: ['--disable', 'plugins', '--disable', 'hooks', 'exec', '--json', '--skip-git-repo-check', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="low"', 'Return MOCK_OK without running any commands.'] });
  const child = spawn(binary, args, { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (x) => { stdout += x; }); child.stderr.on('data', (x) => { stderr += x; });
  const timeout = setTimeout(() => child.kill(), 25000);
  const exit = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); }); clearTimeout(timeout);
  await proxy.stop();
  await writeFile(join(directory, 'diagnostics.log'), stderr);
  const rows = await readProxyMetadata(proxy.database);
  const summary = { exit_code: exit, requests_received: requests.length, paths: requests.map((r) => r.path), fake_key_forwarded: requests.some((r) => r.fake_key_forwarded), recovery_tool_exposed: requests.some((r) => JSON.stringify(r.body).includes('traqiva_retrieve')), proxy_records: rows?.length, final_mock_answer: stdout.includes('MOCK_OK'), real_provider_key_supplied: false, real_model_completion_requested: false, auth_copied: false, private_test_directory: directory };
  console.log(JSON.stringify(summary, null, 2));
  if (exit !== 0 || !rows?.length || !summary.final_mock_answer) process.exitCode = 1;
} finally { await proxy?.stop(); server.closeAllConnections(); await new Promise((done) => server.close(done)); }
