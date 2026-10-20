import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const execute = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, 'upstream');
const downloads = resolve(root, '../public/downloads');
const build = join(root, 'build');
const go = process.env.TRAQIVA_GO || (process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'TraqivaToolchain', 'go', 'bin', 'go.exe') : 'go');
const env = { ...process.env, CGO_ENABLED: '0', GOTOOLCHAIN: 'local' };
if (process.env.LOCALAPPDATA) {
  env.GOMODCACHE ||= join(process.env.LOCALAPPDATA, 'TraqivaToolchain', 'gomodcache');
  env.GOCACHE ||= join(process.env.LOCALAPPDATA, 'TraqivaToolchain', 'gocache');
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (args, extraEnv = {}) => execute(go, args, { cwd: source, env: { ...env, ...extraEnv }, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });

await mkdir(downloads, { recursive: true });
await mkdir(build, { recursive: true });
const { stdout: goVersion } = await run(['version']);
process.stdout.write(goVersion);
const tests = await run(['test', './cmd/traqiva-engine']);
process.stdout.write(tests.stdout);

const licenses = [];
async function addLicense(path, target) { licenses.push({ path: target, text: await readFile(path, 'utf8') }); }
for (const file of ['LICENSE', 'LICENSE-MIT', 'NOTICE', 'LICENSING.md', 'TRADEMARKS.md']) await addLicense(join(source, file), 'upstream/' + file);
const goroot = (await run(['env', 'GOROOT'])).stdout.trim();
await addLicense(join(goroot, 'LICENSE'), 'go/LICENSE');
const modules = new Map();
const list = (await run(['list', '-deps', '-f', '{{if .Module}}{{.Module.Path}}|{{.Module.Version}}|{{.Module.Dir}}{{end}}', './cmd/traqiva-engine'])).stdout;
for (const line of list.trim().split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [path, version, directory] = line.split('|');
  if (path && directory && path !== 'github.com/JuliusBrussee/caveman') modules.set(path, { version, directory });
}
for (const [name, module] of modules) {
  for (const entry of await readdir(module.directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE)(\.|$|-)/i.test(entry.name)) await addLicense(join(module.directory, entry.name), `modules/${name}@${module.version}/${entry.name}`);
  }
}
const notices = { schema_version: 1, name: 'Traqiva Engine license notices', upstream: { repository: 'https://github.com/JuliusBrussee/caveman', tag: 'v4.0.1', revision: 'd0be14f2dc92a99d12e717465d6908723ab9bfdb' }, modifications: ['Independent Traqiva entry point; local state is TRAQIVA_HOME; rebranded output markers are re-counted; exact recovery checked before release'], files: licenses };
const noticesBytes = Buffer.from(JSON.stringify(notices, null, 2) + '\n');
await writeFile(join(downloads, 'engine-notices.json'), noticesBytes);
const manifest = { schema_version: 1, version: '0.1.0', source_revision: notices.upstream.revision, wrapper_sha256: sha(await readFile(join(source, 'cmd/traqiva-engine/main.go'))), go_version: goVersion.trim(), cgo: false, code_languages: ['Go'], evidence_basis: 'inferred', notices: { file: 'engine-notices.json', sha256: sha(noticesBytes) }, artifacts: {} };
for (const target of [{ os: 'windows', arch: 'amd64', key: 'win32-x64', extension: '.exe' }, { os: 'linux', arch: 'amd64', key: 'linux-x64', extension: '' }, { os: 'darwin', arch: 'arm64', key: 'darwin-arm64', extension: '' }]) {
  const name = `traqiva-engine-0.1.0-${target.os}-${target.arch}${target.extension}`;
  const path = join(build, name);
  await run(['build', '-trimpath', '-buildvcs=false', '-ldflags', '-s -w -X main.version=0.1.0', '-o', path, './cmd/traqiva-engine'], { GOOS: target.os, GOARCH: target.arch });
  const binary = await readFile(path);
  const archive = gzipSync(binary, { level: 9 });
  if (archive.byteLength >= 25 * 1024 * 1024) throw new Error(`Asset is too large for the distribution target: ${name}`);
  await writeFile(join(downloads, name + '.gz'), archive);
  manifest.artifacts[target.key] = { file: name + '.gz', sha256: sha(archive), binary_sha256: sha(binary), size: archive.byteLength, binary_size: binary.byteLength, executed_on_build_host: target.key === `${process.platform}-${process.arch}` };
  process.stdout.write(`${target.key}: ${binary.byteLength} binary bytes / ${archive.byteLength} download bytes\n`);
}
await writeFile(join(downloads, 'engine-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`Manifest and ${licenses.length} license texts: ${downloads}\n`);
