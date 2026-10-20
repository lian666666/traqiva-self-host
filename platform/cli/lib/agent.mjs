import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { configHome, api } from './client.mjs';
import { engineStatus } from './native.mjs';
import { nativeProxyStatus, nativeProxyPath, localProxyEnv } from './proxy-native.mjs';

const execute = promisify(execFile);

export function validateCodexConfiguration(text, env, args) {
  const roots = text.split(/^\s*\[/m, 1)[0];
  const value = (key) => roots.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm'))?.[1];
  const provider = value('model_provider');
  if (/^\s*\[\s*mcp_servers\s*\.\s*["']?caveman(?:-cloud)?["']?\s*\]/m.test(text)) throw new Error('An existing legacy Caveman MCP integration must be disabled explicitly before this launcher can verify a Traqiva-only session.');
  if (provider && provider !== 'openai') throw new Error('Traqiva refuses to replace a custom provider. Use its existing connection or a separate official OpenAI Codex configuration.');
  if (/^\s*\[\s*model_providers\s*\.\s*["']?openai(?:["']?\s*\]|["']?\s*\.)/m.test(text)) throw new Error('Traqiva refuses a customized active OpenAI provider table. Review it in a separate configuration before using this launcher.');
  const official = (url) => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'api.openai.com' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && /^\/v1\/?$/.test(parsed.pathname); } catch { return false; } };
  if (env.OPENAI_BASE_URL && !official(env.OPENAI_BASE_URL)) throw new Error('Traqiva refuses a non-official OPENAI_BASE_URL; a third-party credential must not be forwarded to OpenAI.');
  if (value('openai_base_url') && !official(value('openai_base_url'))) throw new Error('Traqiva refuses a configured non-official endpoint.');
  if (value('chatgpt_base_url') && !/^https:\/\/chatgpt\.com(?:\/backend-api)?\/?$/.test(value('chatgpt_base_url'))) throw new Error('Traqiva refuses a custom ChatGPT endpoint.');
  if (value('profile') || args.some((arg) => /^-p.+/.test(arg) || /^(?:-p|--profile)(?:=|$)/.test(arg))) throw new Error('A custom Codex profile must be reviewed separately; this launcher refuses profile overrides.');
  if (args.some((arg) => /^(?:--oss|--local-provider)(?:=|$)/.test(arg))) throw new Error('Traqiva refuses to replace a local or open-source provider.');
  if (args.some((arg) => /^(?:model_provider(?:s)?|openai_base_url|chatgpt_base_url|mcp_servers)\s*(?:\.|=)/.test(arg) || /^--config=(?:model_provider|openai_base_url|chatgpt_base_url|mcp_servers)/.test(arg))) throw new Error('A child routing override conflicts with the verified Traqiva route.');
}

export function detectCodexAuth(status) {
  if (/logged in using chatgpt/i.test(status)) return 'chatgpt';
  if (/logged in using (?:an? )?api key/i.test(status)) return 'api';
  throw new Error('Codex sign-in could not be verified. Sign in using the official Codex CLI before launching Traqiva.');
}

async function codexPreflight(binary, env, args, requestedAuth) {
  let text = '';
  try { text = await readFile(join(env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('The selected Codex configuration could not be checked safely.'); }
  validateCodexConfiguration(text, env, args);
  const options = { env, timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 };
  let help;
  try { help = (await execute(binary, ['--help'], options)).stdout; }
  catch { throw new Error('The selected Codex CLI could not be started. Set TRAQIVA_CODEX_BIN to an official executable.'); }
  if (!help.includes('--no-daemon')) throw new Error('This launcher requires an official Codex CLI that supports --no-daemon. No global configuration was changed.');
  let observed;
  try { const result = await execute(binary, ['login', 'status'], options); observed = detectCodexAuth(result.stdout + result.stderr); }
  catch { if (requestedAuth !== 'api' || !env.OPENAI_API_KEY) throw new Error('Codex sign-in status could not be verified.'); }
  const auth = requestedAuth || observed;
  if (!['chatgpt', 'api'].includes(auth)) throw new Error('Codex auth mode must be chatgpt or api.');
  if (auth !== observed && !(auth === 'api' && env.OPENAI_API_KEY)) throw new Error('The requested auth mode does not match the current Codex sign-in.');
  return auth;
}

export function agentEnvironment(input, home) {
  const env = { ...input, TRAQIVA_HOME: home };
  for (const key of Object.keys(env)) if (/^(CODEX_|CAVE_|CAVEMAN_|CAVEMEM_)/.test(key) && key !== 'CODEX_HOME') delete env[key];
  return env;
}

export function buildCodexArgs({ proxyUrl, cliPath, nodePath, auth, useEnvKey = false, userArgs = [] }) {
  if (!['chatgpt', 'api'].includes(auth)) throw new Error('Codex auth mode must be chatgpt or api.');
  const overrides = {
    model_provider: 'traqiva',
    'model_providers.traqiva.name': 'Traqiva',
    'model_providers.traqiva.base_url': proxyUrl + (auth === 'api' ? '/openai/v1' : '/chatgpt'),
    'model_providers.traqiva.wire_api': 'responses',
    'model_providers.traqiva.requires_openai_auth': !(auth === 'api' && useEnvKey),
    'model_providers.traqiva.supports_websockets': false,
    ...(auth === 'api' && useEnvKey ? { 'model_providers.traqiva.env_key': 'OPENAI_API_KEY' } : {}),
    'mcp_servers.traqiva.command': nodePath,
    'mcp_servers.traqiva.args': [cliPath, 'mcp'],
    'mcp_servers.traqiva.startup_timeout_sec': 30,
    'mcp_servers.traqiva.env_vars': ['TRAQIVA_HOME'],
  };
  // A running desktop/shared daemon owns its already-resolved provider config.
  // Isolate this child session so overrides cannot silently reuse that daemon.
  const routing = Object.entries(overrides).flatMap(([name, value]) => ['-c', `${name}=${JSON.stringify(value)}`]);
  // exec/review own their config vector. In current Codex a child -c (such as
  // reasoning effort) replaces root -c overrides unless routing is also placed
  // in that child vector. Keep the user's model/effort values unchanged.
  const subcommand = userArgs.findIndex((arg) => ['exec', 'review', 'resume', 'fork'].includes(arg));
  return subcommand < 0 ? ['--no-daemon', ...routing, ...userArgs] : ['--no-daemon', ...userArgs.slice(0, subcommand + 1), ...routing, ...userArgs.slice(subcommand + 1)];
}

async function freePort() {
  const socket = createServer();
  await new Promise((done, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', done); });
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
}

export async function startAgentProxy({ home = configHome(), providerConfig = {}, extraEnv = {}, mode = 'compress' } = {}) {
  const installed = await nativeProxyStatus();
  if (!installed.installed) throw new Error(installed.note);
  const runId = randomUUID();
  const directory = join(home, 'agent-runs', runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const configFile = join(directory, 'proxy.yaml');
  await writeFile(configFile, JSON.stringify({ mode, listen: `127.0.0.1:${port}`, subscription_compress: 'live_zone', breakpoint_plan: 'off', optimizers: { 'anthropic-cache-breakpoints': false, 'openai-prompt-cache-key': false, 'bedrock-cache-points': false }, providers: providerConfig }), { mode: 0o600 });
  const database = join(directory, 'usage.db');
  const env = localProxyEnv(home, { CAVEMAN_CONFIG: configFile, CAVEMAN_DB: database, CAVEMAN_LISTEN: `127.0.0.1:${port}`, CAVEMAN_MODE: mode, CAVEMAN_LABEL: `traqiva-agent:${runId}`, CAVEMAN_PROXY_OWNER: 'wrap', CAVEMAN_TOOLSCHEMA_STRIP: 'off', CAVEMAN_BREAKPOINT_PLAN: 'off', ...extraEnv });
  // RecoveryViaMCP is not asserted through an environment shortcut. The adapter
  // must see the actual Traqiva MCP tool on each subscription request.
  delete env.CAVEMAN_RECOVERY;
  const log = createWriteStream(join(directory, 'proxy.log'), { flags: 'a', mode: 0o600 });
  const child = spawn(nativeProxyPath(), ['serve'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let startupError;
  child.once('error', (error) => { startupError = error; });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let state;
  const started = Date.now();
  try {
    while (Date.now() - started < 15_000) {
      if (startupError) throw new Error('The native proxy process could not start on this system.');
      if (child.exitCode !== null) throw new Error('Native proxy exited before becoming ready. Inspect this run’s private proxy.log.');
      try {
        const response = await fetch(url + '/health/live', { signal: AbortSignal.timeout(800) });
        const candidate = JSON.parse(await readFile(join(home, 'run', `${port}.json`), 'utf8'));
        if (response.ok && candidate.pid === child.pid && candidate.port === port && response.headers.get('x-caveman-instance') === candidate.instance_token) { state = candidate; break; }
      } catch {}
      await delay(100);
    }
    if (!state) throw new Error('The newly started native proxy could not be authenticated on its loopback port.');
  } catch (error) { child.kill(); log.end(); throw error; }
  return {
    url, runId, directory, database, process: child,
    async stop() {
      try { await fetch(url + '/caveman/shutdown', { method: 'POST', headers: { 'x-caveman-shutdown': state.shutdown_token }, signal: AbortSignal.timeout(3000) }); } catch {}
      if (child.exitCode === null) await Promise.race([new Promise((done) => child.once('exit', done)), delay(3500)]);
      if (child.exitCode === null) child.kill();
      log.end();
    },
  };
}

export async function readProxyMetadata(database) {
  try {
    // Deliberate allowlist: no prompt, response, credentials or recovery bodies
    // are read from SQLite or sent to the Traqiva control plane.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      return db.prepare(`SELECT request_id,ts,provider,model,endpoint,status_code,latency_ms,input_tokens,output_tokens,cached_input_tokens,token_usage_basis,request_bytes,response_bytes,raw_request_sha256,transformed_request_sha256,request_measurement_status,request_tokens_before,request_tokens_after,compression_tokens_before,compression_tokens_after,optimization_ids FROM requests WHERE endpoint LIKE '%/responses' OR endpoint LIKE '%/chat/completions' OR endpoint LIKE '%/messages' ORDER BY id LIMIT 10000`).all();
    } finally { db.close(); }
  } catch { return null; }
}

async function uploadMetadata(config, rows) {
  if (!config || !rows?.length) return { uploaded: 0 };
  const records = rows.map((row) => ({ id: `native-${row.request_id}`, provider: row.provider, model: row.model, status: row.status_code >= 400 ? 'error' : 'success', http_status: row.status_code, latency_ms: row.latency_ms, input_bytes: row.request_bytes, output_bytes: row.response_bytes, token_basis: row.token_usage_basis === 'provider_complete' ? 'provider' : 'unavailable', ...(row.token_usage_basis === 'provider_complete' ? { input_tokens: row.input_tokens, output_tokens: row.output_tokens, cached_tokens: row.cached_input_tokens } : {}), source: 'native_proxy', created_at: row.ts, compressed: !!row.raw_request_sha256 && row.raw_request_sha256 !== row.transformed_request_sha256, algorithm: row.optimization_ids || null }));
  try {
    let uploaded = 0;
    for (let i = 0; i < records.length; i += 50) uploaded += (await api(config, '/api/ingest', { records: records.slice(i, i + 50) })).accepted;
    return { uploaded };
  } catch { return { uploaded: 0, upload_unavailable: true }; }
}

export async function launchAgent(agent, args, { config = null, auth } = {}) {
  if (!['codex', 'claude'].includes(agent)) throw new Error('Supported launchers: codex and claude.');
  const engine = await engineStatus();
  if (!engine.installed) throw new Error('Install the Traqiva engine explicitly before launching an agent, so recovery tools can serve exact originals.');
  const home = configHome();
  const cliPath = fileURLToPath(new URL('../bin/traqiva.mjs', import.meta.url));
  const env = agentEnvironment(process.env, home);
  let binary; let childArgs;
  if (agent === 'codex') {
    binary = process.env.TRAQIVA_CODEX_BIN || process.env.CODEX_CLI_PATH || 'codex';
    auth = await codexPreflight(binary, env, args, auth);
  } else {
    binary = process.env.TRAQIVA_CLAUDE_BIN || 'claude';
    if (env.ANTHROPIC_BASE_URL && !/^https:\/\/api\.anthropic\.com\/?$/.test(env.ANTHROPIC_BASE_URL)) throw new Error('Traqiva refuses to replace a custom Anthropic endpoint.');
  }
  const proxy = await startAgentProxy({ home });
  if (agent === 'codex') {
    childArgs = buildCodexArgs({ proxyUrl: proxy.url, cliPath, nodePath: process.execPath, auth, useEnvKey: !!env.OPENAI_API_KEY, userArgs: args });
  } else {
    env.ANTHROPIC_BASE_URL = proxy.url + '/anthropic';
    childArgs = ['--mcp-config', JSON.stringify({ mcpServers: { traqiva: { command: process.execPath, args: [cliPath, 'mcp'], env: { TRAQIVA_HOME: home } } } }), ...args];
  }
  process.stderr.write(JSON.stringify({ event: 'traqiva_agent_started', agent, local_proxy: proxy.url, run_id: proxy.runId, global_configuration_changed: false, auto_model_routing: false }) + '\n');
  let code;
  try {
    const child = spawn(binary, childArgs, { env, stdio: 'inherit', windowsHide: true });
    code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', (value) => done(value ?? 1)); });
  } finally { await proxy.stop(); }
  const rows = await readProxyMetadata(proxy.database);
  const telemetry = await uploadMetadata(config, rows);
  const receipt = { event: 'traqiva_agent_finished', agent, run_id: proxy.runId, exit_code: code, requests_observed: rows?.length ?? null, transformed_requests: rows?.filter((row) => row.raw_request_sha256 && row.raw_request_sha256 !== row.transformed_request_sha256).length ?? null, provider_usage_complete_requests: rows?.filter((row) => row.token_usage_basis === 'provider_complete').length ?? null, evidence_basis: 'inferred', ...telemetry };
  receipt.route_verified = !!rows?.length;
  receipt.local_measurements = rows?.map((row) => ({ request_id: row.request_id, request_measurement_status: row.request_measurement_status, request_tokens_before_estimate: row.request_measurement_status === 'measured' ? row.request_tokens_before : null, request_tokens_after_estimate: row.request_measurement_status === 'measured' ? row.request_tokens_after : null, artifact_tokens_before_estimate: row.compression_tokens_before > 0 ? row.compression_tokens_before : null, artifact_tokens_after_estimate: row.compression_tokens_before > 0 ? row.compression_tokens_after : null, evidence_basis: 'inferred', provider_usage_basis: row.token_usage_basis })) || [];
  await writeFile(join(proxy.directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  process.stderr.write(JSON.stringify(receipt) + '\n');
  if (!rows?.length) {
    process.stderr.write('Traqiva did not observe a routed request. This agent session is not verified as connected or compressed. No global configuration was changed.\n');
    return code || 2;
  }
  return code;
}
