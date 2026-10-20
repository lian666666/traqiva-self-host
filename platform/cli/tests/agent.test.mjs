import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexArgs, agentEnvironment, validateCodexConfiguration, detectCodexAuth } from '../lib/agent.mjs';

test('Codex launcher overrides only the child provider and adds the matching Traqiva recovery MCP', () => {
  const args = buildCodexArgs({ proxyUrl: 'http://127.0.0.1:45678', cliPath: 'C:\\apps\\traqiva.mjs', nodePath: 'C:\\node\\node.exe', auth: 'chatgpt', userArgs: ['exec', '--json', 'Read a synthetic fixture.'] });
  assert.ok(args.includes('model_provider="traqiva"'));
  assert.equal(args[0], '--no-daemon');
  assert.ok(args.includes('model_providers.traqiva.base_url="http://127.0.0.1:45678/chatgpt"'));
  assert.ok(args.includes('model_providers.traqiva.supports_websockets=false'));
  assert.ok(args.includes('mcp_servers.traqiva.command="C:\\\\node\\\\node.exe"'));
  assert.ok(args.some((arg) => arg.startsWith('mcp_servers.traqiva.args=') && arg.includes('mcp')));
  assert.deepEqual(args.slice(-2), ['--json', 'Read a synthetic fixture.']);
  assert.ok(args.indexOf('model_provider="traqiva"') > args.indexOf('exec'), 'exec has a separate config vector: child -c flags must include routing');
  assert.equal(args.some((arg) => /auth\.json|password|tokenStore/.test(arg)), false);
  assert.equal(args.some((arg) => arg.startsWith('mcp_servers.caveman')), false, 'disabled placeholders without transports are invalid in current Codex');
});

test('launcher refuses a custom provider, endpoint and routing overrides before credentials can be rerouted', () => {
  assert.throws(() => validateCodexConfiguration('model_provider = "azure"', {}, []), /custom provider/);
  assert.throws(() => validateCodexConfiguration('', { OPENAI_BASE_URL: 'https://other.example/v1' }, []), /OPENAI_BASE_URL/);
  assert.throws(() => validateCodexConfiguration('openai_base_url = "https://other.example/v1"', {}, []), /endpoint/);
  assert.throws(() => validateCodexConfiguration('', {}, ['-c', 'model_provider="other"']), /routing override/);
  assert.throws(() => validateCodexConfiguration('', {}, ['--profile', 'other']), /profile/);
  assert.throws(() => validateCodexConfiguration('', {}, ['-pother']), /profile/);
  assert.throws(() => validateCodexConfiguration('', {}, ['--oss']), /provider/);
  assert.throws(() => validateCodexConfiguration('[mcp_servers.caveman]\ncommand="old-binary"', {}, []), /legacy/);
  assert.throws(() => validateCodexConfiguration('model_provider="openai"\n[model_providers.openai]\nbase_url="https://other.example/v1"', {}, []), /provider/);
  assert.doesNotThrow(() => validateCodexConfiguration('model_provider = "openai"\n[model_providers.unused]\nbase_url="https://unused.example/v1"', {}, ['exec', '--json']));
});

test('auth detection uses the actual login status, never an API-key-shaped string or environment presence', () => {
  assert.equal(detectCodexAuth('Logged in using ChatGPT'), 'chatgpt');
  assert.equal(detectCodexAuth('Logged in using an API key'), 'api');
  assert.throws(() => detectCodexAuth('Not logged in'), /sign-in/);
});

test('API-key Codex mode uses the OpenAI provider API path rather than subscription path', () => {
  const args = buildCodexArgs({ proxyUrl: 'http://127.0.0.1:45678', cliPath: '/app/traqiva.mjs', nodePath: '/node', auth: 'api', userArgs: [] });
  assert.ok(args.includes('model_providers.traqiva.base_url="http://127.0.0.1:45678/openai/v1"'));
});

test('an explicitly supplied API key uses the named environment key instead of silently choosing stored ChatGPT auth', () => {
  const args = buildCodexArgs({ proxyUrl: 'http://127.0.0.1:45678', cliPath: '/app/traqiva.mjs', nodePath: '/node', auth: 'api', useEnvKey: true });
  assert.ok(args.includes('model_providers.traqiva.requires_openai_auth=false'));
  assert.ok(args.includes('model_providers.traqiva.env_key="OPENAI_API_KEY"'));
  assert.equal(args.includes('model_providers.traqiva.requires_openai_auth=true'), false);
});

test('child environment drops inherited desktop IPC and old Caveman routing while preserving the chosen Codex home', () => {
  const env = agentEnvironment({ CODEX_THREAD_ID: 'desktop-thread', CODEX_CLI_PATH: 'resolved-before-cleaning', CODEX_HOME: '/chosen/codex', CAVEMAN_HOME: '/old', CAVE_TOKEN: 'old-secret', PATH: '/bin', OPENAI_API_KEY: 'ephemeral-provider-key' }, '/new/traqiva');
  assert.equal(env.CODEX_THREAD_ID, undefined);
  assert.equal(env.CAVE_TOKEN, undefined);
  assert.equal(env.CAVEMAN_HOME, undefined);
  assert.equal(env.CODEX_HOME, '/chosen/codex');
  assert.equal(env.TRAQIVA_HOME, '/new/traqiva');
  assert.equal(env.OPENAI_API_KEY, 'ephemeral-provider-key');
});
