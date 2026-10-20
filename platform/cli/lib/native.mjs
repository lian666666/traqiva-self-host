import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { configHome, normalizeOrigin, MAX_BYTES } from './client.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const binaryName = () => process.platform === 'win32' ? 'traqiva-engine.exe' : 'traqiva-engine';
export const enginePath = () => join(configHome(), 'bin', binaryName());

export async function engineStatus() {
  let metadata;
  try { metadata = JSON.parse(await readFile(join(configHome(), 'engine.json'), 'utf8')); }
  catch { return { installed: false, platform: `${process.platform}-${process.arch}`, note: 'Native engine is not installed. Use traqiva engine install --url YOUR_TRAQIVA_ORIGIN explicitly.' }; }
  try {
    const file = await lstat(enginePath());
    if (!file.isFile() || file.isSymbolicLink() || file.size > 64 * MAX_BYTES) throw new Error('Unexpected executable file.');
    const sha256 = digest(await readFile(enginePath()));
    if (sha256 !== metadata.sha256) throw new Error('Native engine checksum does not match its installation receipt.');
    return { installed: true, version: metadata.version, sha256, platform: `${process.platform}-${process.arch}`, runtime: 'native', evidence_basis: 'inferred' };
  } catch { return { installed: false, platform: `${process.platform}-${process.arch}`, integrity_error: true, note: 'Native installation is missing or failed its checksum check. Install it again explicitly.' }; }
}

async function download(url, limit) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Engine download failed (HTTP ${response.status}).`);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Engine download exceeds its size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function fetchBinaryRelease(origin, manifestFile = 'engine-manifest.json', noticesFile = 'engine-notices.json') {
  const url = normalizeOrigin(origin);
  const manifest = JSON.parse((await download(url + '/downloads/' + manifestFile, MAX_BYTES)).toString('utf8'));
  const artifact = manifest?.schema_version === 1 && manifest.artifacts?.[`${process.platform}-${process.arch}`];
  if (!artifact) throw new Error('No native build is published for this operating system and architecture. Cloud lossless JSON mode remains available.');
  if (!/^[a-zA-Z0-9._-]+\.gz$/.test(artifact.file) || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !/^[a-f0-9]{64}$/.test(artifact.binary_sha256)) throw new Error('Engine manifest contains an invalid file name or SHA-256.');
  if (manifest.notices?.file !== noticesFile || !/^[a-f0-9]{64}$/.test(manifest.notices.sha256)) throw new Error('Engine manifest does not contain its required license notices.');
  const notices = await download(url + '/downloads/' + noticesFile, MAX_BYTES);
  if (digest(notices) !== manifest.notices.sha256) throw new Error('Engine notices failed SHA-256 verification; nothing was installed.');
  const archive = await download(url + '/downloads/' + artifact.file, 25 * MAX_BYTES);
  if (digest(archive) !== artifact.sha256) throw new Error('Downloaded engine archive failed SHA-256 verification; nothing was installed.');
  let binary;
  try { binary = gunzipSync(archive, { maxOutputLength: 64 * MAX_BYTES }); }
  catch { throw new Error('Engine archive could not be decompressed safely.'); }
  if (digest(binary) !== artifact.binary_sha256) throw new Error('Engine executable failed SHA-256 verification; nothing was installed.');
  return { url, manifest, artifact, notices, binary };
}

export async function installEngine(origin) {
  const { url, manifest, artifact, notices, binary } = await fetchBinaryRelease(origin);
  const directory = join(configHome(), 'bin');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `${binaryName()}.${randomUUID()}.tmp`);
  await writeFile(temporary, binary, { mode: 0o700, flag: 'wx' });
  await rename(temporary, enginePath());
  await chmod(enginePath(), 0o700);
  await writeFile(join(configHome(), 'engine-NOTICES.json'), notices, { mode: 0o600 });
  await writeFile(join(configHome(), 'engine.json'), JSON.stringify({ version: manifest.version, sha256: artifact.binary_sha256, source: url, installed_at: new Date().toISOString(), source_revision: manifest.source_revision }, null, 2) + '\n', { mode: 0o600 });
  const versionInfo = await runEngine(['version']);
  if (versionInfo.schema !== 'traqiva.engine.v1' || versionInfo.version !== manifest.version) throw new Error('The downloaded native executable did not pass its version probe.');
  return { ...(await engineStatus()), installed_from: url, automatic_agent_configuration: false, runtime_info: versionInfo };
}

async function runEngine(args, input = '') {
  const state = await engineStatus();
  if (!state.installed) throw new Error(state.note);
  const env = { ...process.env, TRAQIVA_HOME: configHome() };
  for (const key of Object.keys(env)) if (/^(CAVEMAN_|CAVE_|CAVEMEM_)/.test(key)) delete env[key];
  try {
    return await new Promise((done, reject) => {
      const child = execFile(enginePath(), args, { env, timeout: 60_000, maxBuffer: 4 * MAX_BYTES, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
        if (error) { reject(error); return; }
        try { done(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  } catch (error) {
    // execFile does not include a payload in argv; do not print raw child output.
    throw new Error(error.killed ? 'Traqiva native operation timed out.' : 'Traqiva native operation failed. The original input was not sent to a model or published as compressed.');
  }
}

export async function nativeCompress(text, contentType) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Native input must be UTF-8 text of at most 1 MiB.');
  const args = ['compress', ...(contentType ? ['--type', contentType] : [])];
  const result = await runEngine(args, text);
  if (typeof result.compressedText !== 'string' || result.evidence_basis !== 'inferred' || result.runtime !== 'native') throw new Error('Native engine returned an invalid receipt.');
  if (result.changed) {
    const recovery = await nativeRecover(result.recovery_handle);
    if (recovery.original !== text) throw new Error('Native exact-recovery verification failed; compressed output was withheld.');
  } else if (result.compressedText !== text) throw new Error('Native pass-through receipt did not preserve the original.');
  return result;
}

export async function nativeRecover(handle) {
  if (typeof handle !== 'string' || handle.length > 512) throw new Error('Use a local recovery handle returned by the native engine.');
  const bare = handle.replace(/^local:/, '').replace(/^ccr:\/\//, '');
  if (!/^ccr_[a-f0-9]+$/.test(bare)) throw new Error('Use a local recovery handle returned by the native engine.');
  handle = 'local:' + bare;
  const result = await runEngine(['retrieve', handle]);
  if (typeof result.original !== 'string') throw new Error('Native recovery returned no original.');
  return { ...result, recovery_handle: handle };
}

export async function nativeStats() { return await runEngine(['stats']); }
