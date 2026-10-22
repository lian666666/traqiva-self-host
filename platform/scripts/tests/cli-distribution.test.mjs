import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../pack-cli.mjs', import.meta.url));
const npmCli = process.env.npm_execpath;
let directory;

before(async () => {
  assert.ok(npmCli, 'Run distribution tests with npm run test:self-host.');
  directory = await mkdtemp(join(tmpdir(), 'traqiva-distribution-'));
  await mkdir(join(directory, 'scripts'), { recursive: true });
  await mkdir(join(directory, 'cli/bin'), { recursive: true });
  await mkdir(join(directory, 'cli/lib'), { recursive: true });
  await mkdir(join(directory, 'public/downloads'), { recursive: true });
  await copyFile(script, join(directory, 'scripts/pack-cli.mjs'));
  await writeFile(join(directory, 'cli/package.json'), JSON.stringify({
    name: 'traqiva-cli-local', version: '9.8.7', type: 'module',
    bin: { traqiva: 'bin/traqiva.mjs' }, files: ['bin', 'lib', 'README.md'],
  }));
  await writeFile(join(directory, 'cli/bin/traqiva.mjs'), '#!/usr/bin/env node\nimport { help } from "../lib/quickstart.mjs";\nconsole.log(help);\n');
  await writeFile(join(directory, 'cli/lib/quickstart.mjs'), 'export const help = "Traqiva distribution fixture — init wizard";\n');
  await writeFile(join(directory, 'cli/README.md'), 'Public setup instructions.\n');
  await writeFile(join(directory, 'cli/.env.local'), 'SECRET_FIXTURE_MUST_NOT_SHIP=private\n');
  await writeFile(join(directory, 'cli/private-session.json'), '{"private":"fixture-not-for-publication"}');
  await writeFile(join(directory, 'public/downloads/traqiva-cli-0.1.0.tgz'), 'existing legacy download');
  await execute(process.execPath, [join(directory, 'scripts/pack-cli.mjs')], {
    cwd: directory, env: { ...process.env, npm_execpath: npmCli }, windowsHide: true,
  });
});

after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function exists(path) { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function tarEntries(archive) {
  const tar = gunzipSync(archive), entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0;
    entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test('publishes the package version and byte-identical stable alias without replacing older downloads', async () => {
  const versioned = join(directory, 'public/downloads/traqiva-cli-9.8.7.tgz');
  const alias = join(directory, 'public/cli.tgz');
  assert.equal(await exists(versioned), true, 'The package version must determine the versioned URL.');
  assert.equal(await exists(alias), true, 'The short npx URL must contain an actual package archive.');
  assert.deepEqual(await readFile(alias), await readFile(versioned));
  assert.equal(await readFile(join(directory, 'public/downloads/traqiva-cli-0.1.0.tgz'), 'utf8'), 'existing legacy download');
});

test('the downloadable archive includes the init module and sole executable, with private fixture files excluded', async () => {
  const alias = join(directory, 'public/cli.tgz');
  assert.equal(await exists(alias), true, 'The public alias is required.');
  const entries = tarEntries(await readFile(alias));
  const pkg = JSON.parse(entries.get('package/package.json').toString());
  assert.deepEqual(pkg.bin, { traqiva: 'bin/traqiva.mjs' });
  assert.ok(entries.has('package/lib/quickstart.mjs'));
  assert.ok(entries.has('package/bin/traqiva.mjs'));
  assert.equal([...entries.keys()].some(name => name.includes('.env') || name.includes('private-session')), false);
  assert.equal([...entries.values()].some(bytes => bytes.includes('SECRET_FIXTURE_MUST_NOT_SHIP')), false);
});

test('npx resolves the sole executable from a remote tarball with an isolated fresh cache', { timeout: 60000 }, async () => {
  const alias = join(directory, 'public/cli.tgz');
  assert.equal(await exists(alias), true, 'The public alias is required.');
  const archive = await readFile(alias);
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/cli.tgz') response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(archive);
    else response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/cli.tgz`;
    const config = join(directory, 'empty-npmrc'), globalConfig = join(directory, 'empty-global-npmrc');
    await writeFile(config, ''); await writeFile(globalConfig, '');
    const result = await execute(process.execPath, [join(dirname(npmCli), 'npx-cli.js'), '--yes', url, '--help'], {
      cwd: directory, windowsHide: true, timeout: 45000,
      env: { ...process.env, npm_config_cache: join(directory, 'fresh-npm-cache'), npm_config_userconfig: config, npm_config_globalconfig: globalConfig, npm_config_registry: `http://127.0.0.1:${server.address().port}`, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' },
    });
    assert.match(result.stdout, /Traqiva distribution fixture — init wizard/);
    assert.ok(requests.includes('/cli.tgz'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
