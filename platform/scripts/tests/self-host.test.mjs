import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, makeConfig, bootstrap, selectedIdentity } from '../self-host.mjs';

const options = { accountId: 'a'.repeat(32), name: 'my-traqiva', database: 'my-traqiva-db' };
const uuid = '11111111-2222-4333-8444-555555555555';
function mockRunner(existing = []) {
  const commands = []; let databases = [...existing];
  return { commands, run: async (kind, args) => {
    commands.push({ kind, args });
    if (args[0] === 'whoami') return JSON.stringify({ loggedIn: true, accounts: [{ id: options.accountId }] });
    if (args[0] === 'versions') throw Object.assign(new Error('Worker not found'), { code: 10007 });
    if (args[0] === 'd1' && args[1] === 'list') return JSON.stringify(databases);
    if (args[0] === 'd1' && args[1] === 'create') databases.push({ name: options.database, uuid });
    return '';
  } };
}
test('requires an explicit account and safe worker/database names', () => {
  assert.throws(() => parseArgs([]), /account-id/);
  assert.throws(() => parseArgs(['--account-id', options.accountId, '--name', 'bad;cmd', '--database', options.database]), /name/);
  assert.throws(() => parseArgs(['--account-id', options.accountId, '--name', options.name, '--database', '../production']), /database/);
  assert.deepEqual(parseArgs(['--account-id', options.accountId, '--name', options.name, '--database', options.database, '--dry-run']), { ...options, dryRun: true, reuseExisting: false, reuseExistingWorker: false });
});

test('named-profile identity uses supported auth token privately and never passes --profile to whoami', async () => {
  const commands = [];
  const identity = await selectedIdentity(async (kind, args, authEnv) => {
    commands.push({ kind, args, authEnv });
    if (args[0] === 'auth') return JSON.stringify({ type: 'oauth', token: 'synthetic-profile-token' });
    assert.equal(args[0], 'whoami'); assert.equal(args.includes('--profile'), false);
    assert.deepEqual(authEnv, { CLOUDFLARE_API_TOKEN: 'synthetic-profile-token' });
    return JSON.stringify({ loggedIn: true, accounts: [{ id: options.accountId }] });
  }, '/owned/wrangler.self-host.jsonc', { ...options, profile: 'mine' });
  assert.equal(identity.accounts[0].id, options.accountId);
  assert.ok(commands[0].args.includes('--profile'));
  assert.equal(JSON.stringify(commands[0].args).includes('synthetic-profile-token'), false);
  await assert.rejects(selectedIdentity(async () => '{"type":"unknown","token":"do-not-use"}', '/owned/config', { ...options, profile: 'mine' }), /unsupported/);
});

test('refuses an existing Worker before D1 mutation unless explicitly authorized; network failure is never absence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'traqiva-host-worker-')); const runner = mockRunner();
  const run = async (kind, args) => args[0] === 'versions' ? '[]' : runner.run(kind, args);
  await assert.rejects(bootstrap(options, { directory, run }), /reuse-existing-worker/);
  assert.equal(runner.commands.some(c => c.args[0] === 'd1' || c.args[0] === 'deploy'), false);
  await bootstrap({ ...options, reuseExistingWorker: true }, { directory, run });
  await bootstrap(options, { directory, run });
  const another = await mkdtemp(join(tmpdir(), 'traqiva-host-network-'));
  await assert.rejects(bootstrap(options, { directory: another, run: async (kind, args) => {
    if (args[0] === 'versions') throw Object.assign(new Error('Network failed'), { stderr: 'HTTP 503' });
    return runner.run(kind, args);
  } }), /Could not determine/);
});
test('generates only the selected account config and runs zero cloud commands in dry-run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'traqiva-host-plan-'));
  const runner = mockRunner();
  const result = await bootstrap({ ...options, dryRun: true }, { directory, run: runner.run });
  assert.equal(result.dry_run, true); assert.equal(runner.commands.length, 0);
  assert.equal(result.config.account_id, options.accountId);
  assert.equal(makeConfig(options).d1_databases[0].database_id, undefined);
  await assert.rejects(readFile(join(directory, 'wrangler.self-host.jsonc')), /ENOENT/);
});
test('creates a fresh database, applies migrations and deploys only an owned config; resume does not create again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'traqiva-host-new-')); const runner = mockRunner();
  const original = '{"production":"untouched"}'; await writeFile(join(directory, 'wrangler.jsonc'), original);
  const result = await bootstrap(options, { directory, run: runner.run });
  assert.equal(result.database_created, true); assert.equal(result.deployed, true);
  assert.equal(await readFile(join(directory, 'wrangler.jsonc'), 'utf8'), original);
  const config = JSON.parse(await readFile(join(directory, 'wrangler.self-host.jsonc'), 'utf8'));
  assert.equal(config.d1_databases[0].database_id, uuid);
  const mutations = runner.commands.filter(c => c.kind === 'wrangler' && c.args[0] !== 'whoami');
  assert.ok(mutations.every(c => c.args.includes('--config') && c.args.some(a => a.endsWith('wrangler.self-host.jsonc'))));
  assert.ok(runner.commands.some(c => c.args.join(' ').includes('migrations apply DB --remote')));
  const again = mockRunner([{ name: options.database, uuid }]);
  await bootstrap(options, { directory, run: again.run });
  assert.equal(again.commands.some(c => c.args.includes('create')), false);
});
test('rejects another account and an existing database unless explicitly opted in', async () => {
  const wrong = await mkdtemp(join(tmpdir(), 'traqiva-host-wrong-'));
  await assert.rejects(bootstrap(options, { directory: wrong, run: async () => JSON.stringify({ loggedIn: true, accounts: [{ id: 'b'.repeat(32) }] }) }), /account/);
  const directory = await mkdtemp(join(tmpdir(), 'traqiva-host-collision-')); const runner = mockRunner([{ name: options.database, uuid }]);
  await assert.rejects(bootstrap(options, { directory, run: runner.run }), /reuse-existing/);
  assert.equal(runner.commands.some(c => c.args.includes('migrations') || c.args[0] === 'deploy'), false);
  const allowed = await bootstrap({ ...options, reuseExisting: true }, { directory, run: runner.run });
  assert.equal(allowed.database_created, false); assert.equal(allowed.deployed, true);
});
test('never overwrites an unrelated self-host config or silently changes resume targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'traqiva-host-foreign-'));
  await writeFile(join(directory, 'wrangler.self-host.jsonc'), 'user config');
  const runner = mockRunner();
  await assert.rejects(bootstrap(options, { directory, run: runner.run }), /owned/);
  assert.equal(await readFile(join(directory, 'wrangler.self-host.jsonc'), 'utf8'), 'user config');
  assert.equal(runner.commands.length, 0);
});
