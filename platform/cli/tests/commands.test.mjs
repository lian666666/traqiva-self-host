import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const commands = await import('../lib/commands.mjs').catch(() => ({}));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'traqiva command resolver '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function npmShim(root, agent) {
  const packageName = agent === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code';
  const relative = agent === 'codex' ? ['bin', 'codex.js'] : ['cli.js'];
  const packagePath = join(root, 'node_modules', packageName);
  await mkdir(join(packagePath, ...relative.slice(0, -1)), { recursive: true });
  await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: packageName, type: 'module' }));
  const script = join(packagePath, ...relative);
  await writeFile(script, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  await writeFile(join(root, `${agent}.cmd`), '@echo This shim must never execute\r\nexit /b 99\r\n');
  return { script, packagePath };
}

test('Windows resolver prefers a native executable over earlier npm command shims', async (t) => {
  assert.equal(typeof commands.resolveAssistantCommand, 'function', 'Safe Windows assistant resolution is missing.');
  const root = await fixture(t); const npmPath = join(root, 'npm prefix'); const nativePath = join(root, 'native cli');
  await npmShim(npmPath, 'codex'); await mkdir(nativePath); await writeFile(join(nativePath, 'codex.exe'), 'native fixture');
  const result = await commands.resolveAssistantCommand('codex', { platform: 'win32', env: { PATH: `${npmPath};${nativePath}` } });
  assert.deepEqual(result, { file: join(nativePath, 'codex.exe'), prefix: [] });
});

test('Windows npm Codex shim resolves its official Node entry and preserves spaced argument vectors', async (t) => {
  assert.equal(typeof commands.resolveAssistantCommand, 'function');
  const root = await fixture(t); const npm = await npmShim(root, 'codex');
  const result = await commands.resolveAssistantCommand('codex', { platform: 'win32', env: { Path: root } });
  assert.deepEqual(result, { file: process.execPath, prefix: [npm.script] });
  const output = await execute(result.file, [...result.prefix, 'mcp', 'get', 'a name;$(not-a-shell)'], { windowsHide: true });
  assert.deepEqual(JSON.parse(output.stdout), ['mcp', 'get', 'a name;$(not-a-shell)']);
});

test('Windows npm Claude shim resolves only the expected official package entry', async (t) => {
  assert.equal(typeof commands.resolveAssistantCommand, 'function');
  const root = await fixture(t); const npm = await npmShim(root, 'claude');
  const result = await commands.resolveAssistantCommand('claude', { platform: 'win32', env: { PATH: root } });
  assert.deepEqual(result, { file: process.execPath, prefix: [npm.script] });
  await writeFile(join(npm.packagePath, 'package.json'), JSON.stringify({ name: 'some-other-package' }));
  await assert.rejects(commands.resolveAssistantCommand('claude', { platform: 'win32', env: { PATH: root } }), /not found|unavailable|unsupported/i);
});

test('explicit JavaScript and native executable overrides bypass shells entirely', async (t) => {
  assert.equal(typeof commands.resolveAssistantCommand, 'function');
  const root = await fixture(t); const script = join(root, 'official entry.mjs'); const native = join(root, 'official codex.exe');
  await writeFile(script, 'console.log("entry works");\n'); await writeFile(native, 'native fixture');
  const js = await commands.resolveAssistantCommand('codex', { platform: 'win32', env: { TRAQIVA_CODEX_BIN: script, PATH: '' } });
  assert.deepEqual(js, { file: process.execPath, prefix: [script] });
  assert.equal((await execute(js.file, js.prefix, { windowsHide: true })).stdout.trim(), 'entry works');
  assert.deepEqual(await commands.resolveAssistantCommand('codex', { platform: 'win32', env: { TRAQIVA_CODEX_BIN: native, PATH: '' } }), { file: native, prefix: [] });
});

test('unsupported Windows shims fail closed without invoking cmd or Powershell', async (t) => {
  assert.equal(typeof commands.resolveAssistantCommand, 'function');
  const root = await fixture(t); const shim = join(root, 'codex.cmd');
  await writeFile(shim, '@echo dangerous script must never run\r\n');
  await assert.rejects(commands.resolveAssistantCommand('codex', { platform: 'win32', env: { PATH: root } }), /not found|unavailable|unsupported/i);
  await assert.rejects(commands.resolveAssistantCommand('codex', { platform: 'win32', env: { TRAQIVA_CODEX_BIN: shim, PATH: root } }), /not found|unavailable|unsupported/i);
});
