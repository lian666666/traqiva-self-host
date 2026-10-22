import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { configHome, normalizeOrigin, VERSION } from './client.mjs';
import { installEngine } from './native.mjs';
import { resolveAssistantCommand } from './commands.mjs';

const execute = promisify(execFile);
const DEFAULT_ORIGIN = 'https://YOUR-TRAQIVA.workers.dev';
const sourcePackage = fileURLToPath(new URL('../', import.meta.url));
const assistantName = (assistant) => assistant === 'codex' ? 'Codex' : 'Claude Code';

async function packageFiles(root) {
  const files = new Map();
  for (const name of ['package.json', 'README.md', 'LICENSE', 'NOTICE']) files.set(name, await readFile(join(root, name)));
  for (const directory of ['bin', 'lib']) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.mjs')) throw new Error('The CLI package contains an unexpected entry; nothing was copied.');
      files.set(`${directory}/${entry.name}`, await readFile(join(root, directory, entry.name)));
    }
  }
  if (JSON.parse(files.get('package.json').toString()).version !== VERSION) throw new Error('The CLI package version does not match this launcher.');
  return files;
}

async function persistClient(home, sourceRoot) {
  const files = await packageFiles(sourceRoot);
  const parent = join(home, 'client'); const target = join(parent, VERSION);
  try {
    const existing = await packageFiles(target);
    if (existing.size !== files.size || [...files].some(([name, bytes]) => !existing.get(name)?.equals(bytes))) throw new Error('The existing persistent client has changed; it was preserved. Review it before retrying.');
    return join(target, 'bin', 'traqiva.mjs');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(parent, '.install-'));
  try {
    await mkdir(join(staging, 'bin'), { mode: 0o700 });
    await mkdir(join(staging, 'lib'), { mode: 0o700 });
    for (const [name, bytes] of files) await writeFile(join(staging, name), bytes, { mode: 0o600, flag: 'wx' });
    // A complete client is moved into place only after all allowlisted files exist.
    await rename(staging, target);
  } catch (error) {
    // staging is created by mkdtemp directly under our selected client directory.
    await rm(staging, { recursive: true, force: true });
    if (['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw new Error('An existing persistent client was preserved. Review it before retrying.');
    throw error;
  }
  return join(target, 'bin', 'traqiva.mjs');
}

function manualConfiguration(assistant, cliPath, home) {
  if (assistant === 'codex') return `[mcp_servers.traqiva]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(cliPath)}, "mcp"]\n[mcp_servers.traqiva.env]\nTRAQIVA_HOME = ${JSON.stringify(home)}\n`;
  return JSON.stringify({ mcpServers: { traqiva: { command: process.execPath, args: [cliPath, 'mcp'], env: { TRAQIVA_HOME: home } } } }, null, 2) + '\n';
}

function registeredEntry(entry, cliPath, home) {
  const transport = entry?.transport;
  return entry?.name === 'traqiva' && entry.enabled !== false && transport?.type === 'stdio' && transport.command === process.execPath && JSON.stringify(transport.args) === JSON.stringify([cliPath, 'mcp']) && transport.env?.TRAQIVA_HOME === home;
}

async function registerMcp(assistant, cliPath, home, resolveCommand) {
  try {
    const command = await resolveCommand(assistant);
    const run = async (args) => await execute(command.file, [...(command.prefix || []), ...args], { env: process.env, windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
    if (assistant === 'codex') {
      const probe = JSON.parse((await run(['mcp', 'list', '--json'])).stdout);
      if (!Array.isArray(probe) || probe.some((entry) => typeof entry?.name !== 'string')) return { registered: false, note: 'MCP settings could not be checked safely.' };
      if (probe.some((entry) => entry.name === 'traqiva')) return { registered: false, note: 'Existing traqiva MCP settings were preserved.' };
      await run(['mcp', 'add', 'traqiva', '--env', `TRAQIVA_HOME=${home}`, '--', process.execPath, cliPath, 'mcp']);
      const saved = JSON.parse((await run(['mcp', 'get', 'traqiva', '--json'])).stdout);
      if (!registeredEntry(saved, cliPath, home)) return { registered: false, note: 'The MCP command returned, but its saved configuration could not be verified.' };
    } else {
      try {
        await run(['mcp', 'get', 'traqiva']);
        return { registered: false, note: 'Existing traqiva MCP settings were preserved.' };
      } catch (error) {
        const message = `${error.stdout || ''}\n${error.stderr || ''}`;
        if (!/No MCP server found with name:?\s*traqiva/i.test(message)) return { registered: false, note: 'Claude Code MCP settings could not be checked safely.' };
      }
      await run(['mcp', 'add', 'traqiva', '--transport', 'stdio', '--scope', 'user', '--env', `TRAQIVA_HOME=${home}`, '--', process.execPath, cliPath, 'mcp']);
      const saved = (await run(['mcp', 'get', 'traqiva'])).stdout;
      if (![process.execPath, cliPath, home].every((value) => saved.includes(value))) return { registered: false, note: 'The MCP command returned, but its saved configuration could not be verified.' };
    }
    return { registered: true };
  } catch {
    // Assistant output may contain other configured credentials. Never echo it.
    return { registered: false, note: `${assistantName(assistant)} is unavailable or MCP registration could not be verified.` };
  }
}

/** A local installer only: no project keys, provider calls or automatic routing. */
export async function runQuickstart({ origin = DEFAULT_ORIGIN, home = configHome(), sourceRoot = sourcePackage } = {}, io = {}) {
  const interactive = io.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  if (!interactive) throw new Error('Setup requires an interactive terminal. Run traqiva init in your terminal; no changes were made.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('Traqiva setup requires Node.js 22.13 or newer.');
  origin = normalizeOrigin(origin); home = resolve(home);
  const write = io.write ?? ((text) => process.stdout.write(text));
  const readline = io.question ? null : createInterface({ input: process.stdin, output: process.stdout });
  const question = io.question ?? ((text) => readline.question(text));
  const install = io.install ?? installEngine;
  const resolveCommand = io.resolveCommand ?? resolveAssistantCommand;
  try {
    write(`\nTraqiva ${VERSION}\nLocal compression. No account required.\n\n`);
    const selection = (await question('Your workflow: 1 Codex, 2 Claude Code, 3 Local files [1]: ')).trim() || '1';
    if (!['1', '2', '3'].includes(selection)) throw new Error('Choose 1, 2 or 3. No changes were made.');
    const assistant = selection === '1' ? 'codex' : selection === '2' ? 'claude' : null;
    let automatic = false;
    if (assistant) {
      const mode = (await question('MCP setup: 1 Register automatically, 2 Print settings [1]: ')).trim() || '1';
      if (!['1', '2'].includes(mode)) throw new Error('Choose 1 or 2. No changes were made.');
      automatic = mode === '1';
    }
    write(`\nDownloads: ${origin}\nLocal files: ${home}\n`);
    const consent = await question(`Install the local engine and client${automatic ? `, and add Traqiva MCP to ${assistantName(assistant)}` : ''}? [y/N]: `);
    if (!/^(?:y|yes)$/i.test(consent.trim())) { write('Cancelled. No changes made.\n'); return { status: 'cancelled' }; }
    write('Installing checksum-verified engine…\n');
    const engine = await install(origin);
    if (engine?.installed !== true) throw new Error('The native engine did not confirm installation. MCP setup was not attempted.');
    const cliPath = await persistClient(home, sourceRoot);
    write('Local engine ready.\n');
    if (!assistant) {
      const quote = (value) => process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
      write(`Run with Node: ${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(cliPath)} compress ./build.log\n`);
      return { status: 'local', cliPath };
    }
    if (automatic) {
      const result = await registerMcp(assistant, cliPath, home, resolveCommand);
      if (result.registered) {
        write(`Traqiva MCP registered in ${assistantName(assistant)}. Restart the assistant or open a new session to load its tools.\n`);
        write('Tools run when called. No cloud project or provider connection was created.\n');
        return { status: 'registered', cliPath, assistant };
      }
      write(`${result.note}\n`);
    }
    write(`Action required: review and add this MCP entry to ${assistantName(assistant)} settings, preserving your other settings.\n`);
    write(manualConfiguration(assistant, cliPath, home));
    write('Restart the assistant after adding it. Tools run when called; this does not take over an existing chat.\n');
    return { status: 'manual', cliPath, assistant };
  } finally { readline?.close(); }
}
