import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/traqiva.mjs', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const quickstart = await import('../lib/quickstart.mjs').catch(() => ({}));

async function fixture(t, answers = []) {
  const home = await mkdtemp(join(tmpdir(), 'traqiva-quickstart-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const output = []; let installs = 0;
  return {
    home, output,
    options: { origin: 'http://127.0.0.1:8789', home, sourceRoot },
    io: { interactive: true, question: async () => answers.shift() ?? '', write: (text) => output.push(text), install: async () => { installs++; return { installed: true }; } },
    installs: () => installs,
  };
}

test('noninteractive init refuses installation instead of silently accepting defaults', async (t) => {
  const f = await fixture(t);
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, [bin, 'init', '--url', f.options.origin], { env: { ...process.env, TRAQIVA_HOME: f.home }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('close', (code) => done({ code, stdout, stderr }));
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /interactive terminal/i);
  assert.deepEqual(await readdir(f.home), []);
});

test('no-argument piped execution gives setup guidance without writing user state', async (t) => {
  const f = await fixture(t);
  const result = await execute(process.execPath, [bin], { env: { ...process.env, TRAQIVA_HOME: f.home }, windowsHide: true });
  assert.match(result.stdout, /traqiva init/);
  assert.deepEqual(await readdir(f.home), []);
});

test('declining the wizard makes no installation or persistent copy', async (t) => {
  assert.equal(typeof quickstart.runQuickstart, 'function', 'The quickstart wizard is not implemented.');
  const f = await fixture(t, ['3', 'n']);
  const result = await quickstart.runQuickstart(f.options, f.io);
  assert.equal(result.status, 'cancelled');
  assert.equal(f.installs(), 0);
  assert.deepEqual(await readdir(f.home), []);
});

test('local setup prints a usable shell command instead of JSON-escaped Windows paths', async (t) => {
  const f = await fixture(t, ['3', 'y']);
  const result = await quickstart.runQuickstart(f.options, f.io);
  const line = f.output.join('').split('\n').find((value) => value.startsWith('Run with Node: '));
  if (process.platform === 'win32') assert.match(line, /^Run with Node: & '/);
  assert.equal(line.includes(process.execPath), true);
  assert.equal(line.includes(result.cliPath), true);
  assert.equal(line.includes('\\\\'), false);
});

test('manual MCP setup points at a persistent allowlisted package and preserves private config', async (t) => {
  assert.equal(typeof quickstart.runQuickstart, 'function');
  const f = await fixture(t, ['1', '2', 'yes']);
  await writeFile(join(f.home, 'config.json'), '{"private":"do-not-copy-or-change"}\n');
  const result = await quickstart.runQuickstart(f.options, f.io);
  assert.equal(result.status, 'manual');
  assert.equal(f.installs(), 1);
  assert.equal(result.cliPath, join(f.home, 'client', '0.1.1', 'bin', 'traqiva.mjs'));
  assert.equal(await readFile(result.cliPath, 'utf8'), await readFile(bin, 'utf8'));
  assert.deepEqual((await readdir(join(f.home, 'client', '0.1.1'))).sort(), ['LICENSE', 'NOTICE', 'README.md', 'bin', 'lib', 'package.json']);
  assert.equal(await readFile(join(f.home, 'config.json'), 'utf8'), '{"private":"do-not-copy-or-change"}\n');
  assert.match(f.output.join(''), /mcp_servers\.traqiva/);
  assert.match(f.output.join(''), /TRAQIVA_HOME/);
  assert.equal(f.output.join('').includes('do-not-copy-or-change'), false);
});

test('engine failure stops before persistent MCP setup and cannot print ready', async (t) => {
  assert.equal(typeof quickstart.runQuickstart, 'function');
  const f = await fixture(t, ['1', '1', 'y']);
  f.io.install = async () => { throw new Error('Checksum failed.'); };
  await assert.rejects(quickstart.runQuickstart(f.options, f.io), /Checksum failed/);
  assert.deepEqual(await readdir(f.home), []);
  assert.equal(/ready|registered/i.test(f.output.join('')), false);
});

test('existing modified persistent client is never overwritten', async (t) => {
  assert.equal(typeof quickstart.runQuickstart, 'function');
  const f = await fixture(t, ['3', 'y']);
  const first = await quickstart.runQuickstart(f.options, f.io);
  await writeFile(first.cliPath, '// user-modified copy\n');
  const answers = ['3', 'y']; const second = { ...f.io, question: async () => answers.shift() ?? '' };
  await assert.rejects(quickstart.runQuickstart(f.options, second), /existing.*client|client.*changed/i);
  assert.equal(await readFile(first.cliPath, 'utf8'), '// user-modified copy\n');
});

async function fakeCodex(t, home, existing = false) {
  const file = join(home, 'fake-codex.mjs'); const config = join(home, 'fake-agent-config.json');
  const prior = { unrelated: { command: 'keep-me', env: { PRIVATE_VALUE: 'never-print-me' } }, ...(existing ? { traqiva: { command: 'existing-client', args: ['keep'] } } : {}) };
  await writeFile(config, JSON.stringify(prior));
  await writeFile(file, `import { readFile, writeFile } from 'node:fs/promises';
const file = ${JSON.stringify(config)}; const args = process.argv.slice(2); const config = JSON.parse(await readFile(file, 'utf8'));
if (args.join(' ') === 'mcp list --json') console.log(JSON.stringify(Object.entries(config).map(([name, transport]) => ({ name, enabled: true, transport: { type: 'stdio', ...transport } }))));
else if (args[0] === 'mcp' && args[1] === 'add' && args[2] === 'traqiva') {
  if (config.traqiva || args[3] !== '--env' || !args[4].startsWith('TRAQIVA_HOME=') || args[5] !== '--' || args.at(-1) !== 'mcp') process.exit(4);
  config.traqiva = { command: args[6], args: args.slice(7), env: { TRAQIVA_HOME: args[4].slice(13) } }; await writeFile(file, JSON.stringify(config));
} else if (args.join(' ') === 'mcp get traqiva --json' && config.traqiva) console.log(JSON.stringify({ name: 'traqiva', enabled: true, transport: { type: 'stdio', ...config.traqiva } }));
else process.exit(3);
`);
  return { prior, config, command: { file: process.execPath, prefix: [file] } };
}

test('automatic registration uses official argument vectors and verifies the saved persistent MCP', async (t) => {
  assert.equal(typeof quickstart.runQuickstart, 'function');
  const f = await fixture(t, ['1', '1', 'y']);
  const fake = await fakeCodex(t, f.home);
  f.io.resolveCommand = async () => fake.command;
  const result = await quickstart.runQuickstart(f.options, f.io);
  assert.equal(result.status, 'registered');
  const saved = JSON.parse(await readFile(fake.config, 'utf8'));
  assert.deepEqual(saved.unrelated, fake.prior.unrelated);
  assert.deepEqual(saved.traqiva, { command: process.execPath, args: [result.cliPath, 'mcp'], env: { TRAQIVA_HOME: f.home } });
  assert.equal(f.output.join('').includes('never-print-me'), false);
  assert.match(f.output.join(''), /restart|new session/i);
});

test('existing same-name MCP is preserved and reported as manual action required', async (t) => {
  assert.equal(typeof quickstart.runQuickstart, 'function');
  const f = await fixture(t, ['1', '1', 'y']);
  const fake = await fakeCodex(t, f.home, true);
  f.io.resolveCommand = async () => fake.command;
  const before = await readFile(fake.config, 'utf8');
  const result = await quickstart.runQuickstart(f.options, f.io);
  assert.equal(result.status, 'manual');
  assert.equal(await readFile(fake.config, 'utf8'), before);
  assert.match(f.output.join(''), /existing.*preserved/i);
});

test('missing assistant prints actionable persistent configuration without claiming registration', async (t) => {
  assert.equal(typeof quickstart.runQuickstart, 'function');
  const f = await fixture(t, ['2', '1', 'y']);
  f.io.resolveCommand = async () => { throw new Error('Executable missing.'); };
  const result = await quickstart.runQuickstart(f.options, f.io);
  assert.equal(result.status, 'manual');
  assert.match(f.output.join(''), /mcpServers/);
  assert.equal(/MCP registered/.test(f.output.join('')), false);
});

test('Claude registration scopes the new stdio server to the user and preserves other entries', async (t) => {
  const f = await fixture(t, ['2', '1', 'y']);
  const config = join(f.home, 'claude-fixture.json'); const executable = join(f.home, 'fake-claude.mjs');
  await writeFile(config, JSON.stringify({ another: { command: 'preserve-other-tools' } }));
  await writeFile(executable, `import { readFile, writeFile } from 'node:fs/promises';
const file = ${JSON.stringify(config)}; const args = process.argv.slice(2); const config = JSON.parse(await readFile(file, 'utf8'));
if (args.join(' ') === 'mcp get traqiva') {
  if (!config.traqiva) { console.error('No MCP server found with name: traqiva'); process.exit(1); }
  console.log('Command: ' + config.traqiva.command + '\\nArgs: ' + config.traqiva.args.join(' ') + '\\nEnv: TRAQIVA_HOME=' + config.traqiva.home);
} else if (args.slice(0, 9).join(' ') === 'mcp add traqiva --transport stdio --scope user --env ' + args[8] && args[8].startsWith('TRAQIVA_HOME=') && args[9] === '--' && args.at(-1) === 'mcp') {
  if (config.traqiva) process.exit(4);
  config.traqiva = { command: args[10], args: args.slice(11), home: args[8].slice(13), scope: args[6] }; await writeFile(file, JSON.stringify(config));
} else process.exit(3);
`);
  f.io.resolveCommand = async () => ({ file: process.execPath, prefix: [executable] });
  const result = await quickstart.runQuickstart(f.options, f.io);
  assert.equal(result.status, 'registered');
  const saved = JSON.parse(await readFile(config, 'utf8'));
  assert.deepEqual(saved.another, { command: 'preserve-other-tools' });
  assert.deepEqual(saved.traqiva, { command: process.execPath, args: [result.cliPath, 'mcp'], home: f.home, scope: 'user' });
});

test('an unreadable assistant configuration fails closed instead of overwriting settings', async (t) => {
  const f = await fixture(t, ['1', '1', 'y']);
  const file = join(f.home, 'unreadable-codex.mjs');
  await writeFile(file, `if (process.argv.slice(2).join(' ') === 'mcp list --json') console.log('not valid JSON'); else process.exit(99);`);
  f.io.resolveCommand = async () => ({ file: process.execPath, prefix: [file] });
  const result = await quickstart.runQuickstart(f.options, f.io);
  assert.equal(result.status, 'manual');
  assert.equal(/MCP registered/.test(f.output.join('')), false);
});
