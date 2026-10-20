#!/usr/bin/env node
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const platform = dirname(dirname(fileURLToPath(import.meta.url)));
const sha = value => createHash('sha256').update(value).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function parseArgs(args) {
  const result = { dryRun: false, reuseExisting: false, reuseExistingWorker: false };
  const names = { 'account-id': 'accountId', name: 'name', database: 'database', profile: 'profile' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; if (seen.has(flag)) throw new Error('Repeated option.'); seen.add(flag);
    if (flag === '--dry-run') result.dryRun = true;
    else if (flag === '--reuse-existing') result.reuseExisting = true;
    else if (flag === '--reuse-existing-worker') result.reuseExistingWorker = true;
    else { const key = names[flag.slice(2)]; if (!flag.startsWith('--') || !key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown option or missing value.'); result[key] = args[++i]; }
  }
  validate(result); return result;
}
function validate(options) {
  if (!/^[a-f0-9]{32}$/.test(options.accountId || '')) throw new Error('Provide an explicit 32-character --account-id from your Cloudflare account.');
  if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(options.name || '')) throw new Error('Provide a unique --name with 3–63 lowercase letters, digits or internal hyphens.');
  if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(options.database || '')) throw new Error('Provide an explicit --database with 3–63 lowercase letters, digits or internal hyphens.');
  if (options.profile && !/^[a-zA-Z0-9_-]{1,64}$/.test(options.profile)) throw new Error('Invalid auth profile name.');
}
export function makeConfig(options, databaseId) {
  validate(options);
  return { $schema: './node_modules/wrangler/config-schema.json', name: options.name, account_id: options.accountId, main: 'server/index.ts', compatibility_date: '2026-10-20', compatibility_flags: ['nodejs_compat'], workers_dev: true,
    assets: { directory: './dist', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*', '/v1/*', '/health'] },
    d1_databases: [{ binding: 'DB', database_name: options.database, ...(databaseId ? { database_id: databaseId } : {}), migrations_dir: 'migrations' }],
    triggers: { crons: ['17 3 * * *'] }, observability: { enabled: true, head_sampling_rate: 1, redact_query_string: true } };
}
export function runner(directory, options) {
  return async (kind, args, authEnv) => {
    let executable;
    if (kind === 'npm') { executable = process.env.npm_execpath; if (!executable) throw new Error('Run this script through npm run self-host.'); }
    else executable = join(directory, 'node_modules/wrangler/bin/wrangler.js');
    const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: options.accountId, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
    if (authEnv) { delete env.CLOUDFLARE_API_TOKEN; delete env.CF_API_TOKEN; delete env.CLOUDFLARE_API_KEY; delete env.CF_API_KEY; delete env.CLOUDFLARE_EMAIL; delete env.CF_EMAIL; Object.assign(env, authEnv); }
    // The selected --profile is passed explicitly; no global login is changed.
    const result = await execute(process.execPath, [executable, ...args], { cwd: directory, env, windowsHide: true, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
    return result.stdout;
  };
}
export async function selectedIdentity(invoke, configPath, options) {
  const configFlags = ['--config', configPath];
  if (!options.profile) return JSON.parse(await invoke('wrangler', ['whoami', '--json', ...configFlags]));
  // Wrangler deliberately rejects --profile on whoami. Its official auth-token
  // command selects a profile; keep the result only in memory for this child.
  const credential = JSON.parse(await invoke('wrangler', ['auth', 'token', '--json', ...configFlags, '--profile', options.profile]));
  let authEnv;
  if (['oauth', 'api_token'].includes(credential?.type) && typeof credential.token === 'string' && credential.token.length > 0 && credential.token.length <= 16384) authEnv = { CLOUDFLARE_API_TOKEN: credential.token };
  else if (credential?.type === 'api_key' && typeof credential.key === 'string' && credential.key.length > 0 && credential.key.length <= 16384 && typeof credential.email === 'string' && credential.email.length <= 254) authEnv = { CLOUDFLARE_API_KEY: credential.key, CLOUDFLARE_EMAIL: credential.email };
  else throw new Error('The selected Wrangler profile returned an unsupported credential type.');
  return JSON.parse(await invoke('wrangler', ['whoami', '--json', ...configFlags], authEnv));
}
const readOptional = async path => { try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Self-host files must not be symbolic links.'); return await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
export function isWorkerNotFound(error) {
  return error?.code === 10007 || /\[code:\s*10007\]/.test(String(error?.stderr || ''));
}
export async function bootstrap(options, { directory = platform, run, log = () => {} } = {}) {
  validate(options); directory = resolve(directory);
  const configPath = join(directory, 'wrangler.self-host.jsonc'), statePath = join(directory, '.self-host-state.json');
  if (options.dryRun) return { dry_run: true, network_requests: 0, files_written: 0, config_file: configPath, config: makeConfig(options), plan: ['Verify selected account with Wrangler whoami --json', 'Refuse an existing Worker unless owned resume or --reuse-existing-worker', 'List databases only in that account', 'Create a new named D1 database (existing requires --reuse-existing)', 'npm run pack:cli', 'npm run build', 'Apply DB migrations --remote using only wrangler.self-host.jsonc', 'Deploy only wrangler.self-host.jsonc'] };
  const existing = await readOptional(configPath), saved = await readOptional(statePath);
  let state;
  if (existing !== null || saved !== null) {
    try { state = JSON.parse(saved); } catch { throw new Error('Existing self-host files are not owned by this bootstrap; nothing was overwritten.'); }
    if (!existing || !state || state.schema !== 1 || state.accountId !== options.accountId || state.name !== options.name || state.database !== options.database || state.config_sha256 !== sha(existing)) throw new Error('Existing self-host files are not owned by this exact account/name/database or were modified; nothing was overwritten.');
  } else {
    const config = JSON.stringify(makeConfig(options), null, 2) + '\n';
    state = { schema: 1, accountId: options.accountId, name: options.name, database: options.database, databaseId: null, config_sha256: sha(config) };
    await writeFile(configPath, config, { flag: 'wx', mode: 0o600 });
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  const invoke = run || runner(directory, options);
  const flags = ['--config', configPath, ...(options.profile ? ['--profile', options.profile] : [])];
  log('Verifying the explicitly selected Cloudflare account.');
  let identity;
  try { identity = await selectedIdentity(invoke, configPath, options); } catch { throw new Error('Wrangler authentication could not be verified. For named profiles, create/authenticate your own profile with wrangler auth create; otherwise use wrangler login or a scoped Cloudflare API token. No cloud resources were changed.'); }
  if (identity.loggedIn !== true || !identity.accounts?.some(account => account.id === options.accountId)) throw new Error('The requested account is not among the authenticated accounts. No database or Worker was changed.');
  let workerExists = false;
  try {
    const versions = JSON.parse(await invoke('wrangler', ['versions', 'list', '--json', ...flags]));
    if (!Array.isArray(versions)) throw new Error('Invalid Worker versions response.');
    workerExists = true;
  } catch (error) {
    if (!isWorkerNotFound(error)) throw new Error('Could not determine whether the selected Worker already exists. No database or Worker was changed. Check account access/network and retry.');
  }
  if (workerExists && state.worker_deployed !== true && !options.reuseExistingWorker) throw new Error('This Worker name already exists. Choose a fresh name or explicitly use --reuse-existing-worker to authorize replacing it. No database or Worker was changed.');
  const list = async () => { const data = JSON.parse(await invoke('wrangler', ['d1', 'list', '--json', ...flags])); if (!Array.isArray(data)) throw new Error('Wrangler returned an invalid D1 list.'); return data; };
  let databases = await list(), database = databases.find(item => item.name === options.database), created = false;
  if (state.databaseId) {
    if (!database || database.uuid !== state.databaseId) throw new Error('The saved database no longer matches this account; refusing a different database.');
  } else if (database && !options.reuseExisting) throw new Error('This database name already exists. Choose a fresh name or explicitly use --reuse-existing to authorize migrations to it.');
  else if (!database) {
    log('Creating the new explicitly named D1 database.');
    await invoke('wrangler', ['d1', 'create', options.database, '--update-config=false', ...flags]);
    databases = await list(); database = databases.find(item => item.name === options.database); created = true;
  }
  if (!database || !UUID.test(database.uuid)) throw new Error('The new database UUID could not be verified. No migrations or deployment were attempted.');
  const config = JSON.stringify(makeConfig(options, database.uuid), null, 2) + '\n';
  state.databaseId = database.uuid; state.config_sha256 = sha(config);
  await writeFile(configPath, config, { mode: 0o600 }); await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  for (const command of [['pack:cli'], ['build']]) { log(`Running npm run ${command[0]}.`); await invoke('npm', ['run', ...command]); }
  log('Applying the versioned migrations to the selected DB binding.');
  await invoke('wrangler', ['d1', 'migrations', 'apply', 'DB', '--remote', ...flags]);
  log('Deploying the selected Worker with its own database.');
  const deployment = await invoke('wrangler', ['deploy', ...flags]);
  state.worker_deployed = true;
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  const urls = [...new Set(deployment.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/g) || [])];
  return { deployed: true, account_id: options.accountId, worker_name: options.name, database_name: options.database, database_created: created, config_file: configPath, urls, google_oauth: 'disabled_until_you_configure_your_own_client', production_config_modified: false, note: 'Deployment is not proof of the application flow. Open your own URL, create an account and verify it.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await bootstrap(parseArgs(process.argv.slice(2)), { log: message => process.stderr.write(message + '\n') }), null, 2)); }
  catch (error) { console.error(error.message?.startsWith('Command failed:') ? 'A self-host command failed. No automatic rollback or deletion was attempted. Review the selected configuration and rerun after fixing the reported stage.' : error.message); process.exitCode = 1; }
}
