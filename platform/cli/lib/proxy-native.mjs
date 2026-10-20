import { readFile, writeFile, mkdir, rename, chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configHome, MAX_BYTES } from './client.mjs';
import { fetchBinaryRelease } from './native.mjs';

const execute = promisify(execFile);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const name = () => process.platform === 'win32' ? 'traqiva-proxy.exe' : 'traqiva-proxy';
export const nativeProxyPath = () => join(configHome(), 'bin', name());

export function localProxyEnv(home = configHome(), extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(CAVE_|CAVEMAN_|CAVEMEM_|CODEX_)/.test(key) && key !== 'CODEX_HOME') delete env[key];
  return { ...env, TRAQIVA_HOME: home, CAVEMAN_HOME: home, CAVEMAN_CCR_DB: join(home, 'recovery.db'), CAVEMAN_OFFLINE: '1', CAVEMAN_TELEMETRY: '0', CAVEMAN_CACHE_WARM: 'off', DO_NOT_TRACK: '1', ...extra };
}

export async function nativeProxyStatus() {
  let metadata;
  try { metadata = JSON.parse(await readFile(join(configHome(), 'proxy-install.json'), 'utf8')); }
  catch { return { installed: false, note: 'Run traqiva proxy install --url YOUR_TRAQIVA_ORIGIN explicitly before launching an agent.' }; }
  try {
    const file = await lstat(nativeProxyPath());
    if (!file.isFile() || file.isSymbolicLink() || file.size > 64 * MAX_BYTES || digest(await readFile(nativeProxyPath())) !== metadata.sha256) throw new Error('integrity');
    return { installed: true, version: metadata.version, sha256: metadata.sha256, platform: `${process.platform}-${process.arch}`, cloud_routing: false };
  } catch { return { installed: false, integrity_error: true, note: 'Native proxy is missing or its SHA-256 changed. Install it again explicitly.' }; }
}

export async function installNativeProxy(origin) {
  const { url, manifest, artifact, notices, binary } = await fetchBinaryRelease(origin, 'proxy-manifest.json', 'proxy-notices.json');
  const directory = join(configHome(), 'bin');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `${name()}.${randomUUID()}.tmp`);
  await writeFile(temporary, binary, { mode: 0o700, flag: 'wx' });
  await rename(temporary, nativeProxyPath()); await chmod(nativeProxyPath(), 0o700);
  await writeFile(join(configHome(), 'proxy-NOTICES.json'), notices, { mode: 0o600 });
  await writeFile(join(configHome(), 'proxy-install.json'), JSON.stringify({ version: manifest.version, sha256: artifact.binary_sha256, installed_at: new Date().toISOString(), source: url }, null, 2) + '\n', { mode: 0o600 });
  const { stdout } = await execute(nativeProxyPath(), ['version', '--json'], { env: localProxyEnv(), timeout: 15_000, windowsHide: true, maxBuffer: MAX_BYTES });
  const version = JSON.parse(stdout);
  if (version.version !== manifest.version) throw new Error('Native proxy version probe did not match the manifest.');
  return { ...(await nativeProxyStatus()), installed_from: url, automatic_agent_configuration: false };
}
