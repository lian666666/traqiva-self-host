#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { api, containsCredentials, identity, loadConfig, normalizeOrigin, publicError, readBoundedFile, saveConfig, VERSION } from '../lib/client.mjs';
import { serveMcp } from '../lib/mcp.mjs';
import { serveProxy } from '../lib/proxy.mjs';
import { engineStatus, installEngine } from '../lib/native.mjs';
import { compressArtifact, recoverArtifact } from '../lib/operations.mjs';
import { installNativeProxy, nativeProxyStatus } from '../lib/proxy-native.mjs';
import { launchAgent } from '../lib/agent.mjs';

const help = `Traqiva ${VERSION} — API-key gateway bridge and recoverable artifact compression

traqiva connect --url ORIGIN --project ID --key PROJECT_INGEST_KEY
traqiva status
traqiva record TRACE.json
traqiva compress FILE
traqiva recover HANDLE
traqiva engine install [--url ORIGIN]
traqiva engine status
traqiva proxy install [--url ORIGIN]
traqiva proxy status
traqiva agent codex [--auth chatgpt|api] -- [CODEX_ARGUMENTS]
traqiva agent claude -- [CLAUDE_ARGUMENTS]
traqiva serve [--port 8788]
traqiva mcp
traqiva setup --agent codex|claude --print

Connection is stored locally in ~/.traqiva/config.json (0600 where supported;
Windows profile ACLs apply).
TRAQIVA_HOME selects an isolated configuration directory.
Provider API keys are forwarded per request, never saved by the bridge.
The optional native engine is installed only by the explicit install command.
It compresses artifacts locally with exact recovery; cloud mode is lossless JSON.
The experimental native agent launcher uses child-only settings, not the current
desktop chat. Subscription routing was verified; the tested task compressed zero
requests because recovery was unproven. No Auto routing or verified savings.
`;

function parse(args, allowed = []) {
  const flags = {}; const positional = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const flag = value.slice(2);
    if (!allowed.includes(flag) || Object.hasOwn(flags, flag)) throw new Error('Unknown or repeated command option. Use traqiva --help.');
    if (flag === 'print') flags[flag] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Option --${flag} requires a value.`);
      flags[flag] = args[++i];
    }
  }
  return { flags, positional };
}
const output = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['--help', '-h', 'help'].includes(command)) { process.stdout.write(help); return; }
  if (command === '--version') { process.stdout.write(VERSION + '\n'); return; }
  if (command === 'setup') {
    const { flags, positional } = parse(args, ['agent', 'print']);
    if (positional.length || !['codex', 'claude'].includes(flags.agent) || !flags.print) throw new Error('Use setup --agent codex|claude --print. Agent files are never changed automatically.');
    const executable = fileURLToPath(import.meta.url);
    if (flags.agent === 'codex') process.stdout.write(`# Review and add this to your Codex config.toml. No files have been changed.\n[mcp_servers.traqiva]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(executable)}, "mcp"]\n# Connect the project first with traqiva connect. This adds MCP tools only.\n`);
    else output({ mcpServers: { traqiva: { command: process.execPath, args: [executable, 'mcp'] } }, notice: 'Review before adding to your Claude MCP config. No files have been changed. This adds tools, not automatic model routing.' });
    return;
  }
  if (command === 'connect') {
    const { flags, positional } = parse(args, ['url', 'project', 'key']);
    if (positional.length || !flags.url || !flags.project || !flags.key) throw new Error('connect requires --url ORIGIN --project ID --key PROJECT_INGEST_KEY.');
    const config = { url: normalizeOrigin(flags.url), project: flags.project, key: flags.key };
    if (config.key.length < 8 || /[\r\n]/.test(config.key)) throw new Error('Use a valid project ingest key.');
    const state = await identity(config);
    await saveConfig(config);
    output({ ...state, credential_stored: true, provider_credentials_stored: false });
    return;
  }
  let config;
  if (['compress', 'recover', 'mcp', 'engine', 'proxy', 'agent'].includes(command)) {
    try { config = await loadConfig(); } catch { config = null; }
  } else config = await loadConfig();
  if (command === 'proxy') {
    const [action, ...proxyArgs] = args;
    if (action === 'status') {
      const { positional } = parse(proxyArgs); if (positional.length) throw new Error('proxy status accepts no arguments.');
      output(await nativeProxyStatus());
    } else if (action === 'install') {
      const { flags, positional } = parse(proxyArgs, ['url']);
      const origin = flags.url ?? config?.url;
      if (positional.length || !origin) throw new Error('Use proxy install --url YOUR_TRAQIVA_ORIGIN. Installation is never automatic.');
      output(await installNativeProxy(origin));
    } else throw new Error('Use proxy install [--url ORIGIN] or proxy status.');
    return;
  }
  if (command === 'agent') {
    const [agent, ...rest] = args;
    const separator = rest.indexOf('--');
    const ownArgs = separator < 0 ? rest : rest.slice(0, separator);
    const userArgs = separator < 0 ? [] : rest.slice(separator + 1);
    const { flags, positional } = parse(ownArgs, ['auth']);
    if (positional.length) throw new Error('Place agent arguments after --, for example: traqiva agent codex -- exec "your task".');
    process.exitCode = await launchAgent(agent, userArgs, { config, ...(flags.auth ? { auth: flags.auth } : {}) });
    return;
  }
  if (command === 'engine') {
    const [action, ...engineArgs] = args;
    if (action === 'status') {
      const { positional } = parse(engineArgs); if (positional.length) throw new Error('engine status accepts no arguments.');
      output(await engineStatus());
    } else if (action === 'install') {
      const { flags, positional } = parse(engineArgs, ['url']);
      const origin = flags.url ?? config?.url;
      if (positional.length || !origin) throw new Error('Use engine install --url YOUR_TRAQIVA_ORIGIN, or connect a project first. Installation is never automatic.');
      output(await installEngine(origin));
    } else throw new Error('Use engine install [--url ORIGIN] or engine status.');
    return;
  }
  if (command === 'status') {
    const parsed = parse(args); if (parsed.positional.length) throw new Error('status accepts no arguments.');
    output({ ...(await identity(config)), engine: await engineStatus() });
  } else if (command === 'record') {
    const { positional } = parse(args);
    if (positional.length !== 1) throw new Error('record requires one JSON file.');
    let document;
    try { document = JSON.parse(await readBoundedFile(positional[0])); } catch { throw new Error('Trace input must be a valid JSON file of at most 1 MiB.'); }
    const records = Array.isArray(document) ? document : Array.isArray(document?.records) ? document.records : [document];
    if (!records.length || records.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Trace file must contain a record object or a records array.');
    if (containsCredentials(records)) throw new Error('Trace file contains credential-like fields. Remove authorization, cookies, passwords and keys before uploading.');
    const result = await api(config, '/api/ingest', { records });
    if (!Number.isInteger(result?.accepted) || result.accepted < 0 || !Array.isArray(result.ids)) throw new Error('Traqiva did not confirm trace ingestion.');
    output(result);
  } else if (command === 'compress') {
    const { positional } = parse(args);
    if (positional.length !== 1) throw new Error('compress requires one UTF-8 file. Installed native engines work locally; otherwise the connected cloud service is used.');
    output(await compressArtifact(config, await readBoundedFile(positional[0])));
  } else if (command === 'recover') {
    const { positional } = parse(args);
    if (positional.length !== 1) throw new Error('recover requires one recovery handle.');
    process.stdout.write((await recoverArtifact(config, positional[0])).original);
  } else if (command === 'mcp') {
    const { positional } = parse(args); if (positional.length) throw new Error('mcp accepts no arguments.');
    await serveMcp(config);
  } else if (command === 'serve') {
    const { flags, positional } = parse(args, ['port']);
    const port = Number(flags.port ?? 8788);
    if (positional.length || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
    await identity(config);
    await serveProxy(config, port);
  } else throw new Error('Unknown command. Use traqiva --help.');
}

main().catch((error) => {
  const values = process.argv.slice(2);
  const secrets = values.flatMap((value, index) => value === '--key' ? [values[index + 1]] : []);
  process.stderr.write(`Traqiva: ${publicError(error, secrets)}\n`);
  process.exitCode = 1;
});
