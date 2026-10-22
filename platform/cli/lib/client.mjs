import { readFile, writeFile, mkdir, rename, chmod, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';

export const MAX_BYTES = 1024 * 1024;
export const VERSION = '0.1.1';
export const configHome = () => resolve(process.env.TRAQIVA_HOME || join(homedir(), '.traqiva'));

export function publicError(error, secrets = []) {
  let message = error instanceof Error ? error.message : 'Operation failed';
  for (const secret of secrets) if (typeof secret === 'string' && secret) message = message.split(secret).join('[redacted]');
  return message.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 800);
}

export function normalizeOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Use a valid HTTPS Traqiva origin.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Traqiva URL must be an HTTPS origin, or loopback HTTP, without credentials, path, query or fragment.');
  }
  return url.origin;
}

export async function loadConfig() {
  let config;
  try { config = JSON.parse(await readFile(join(configHome(), 'config.json'), 'utf8')); }
  catch { throw new Error('Not connected. Run traqiva connect --url ORIGIN --project PROJECT_ID --key PROJECT_KEY.'); }
  config.url = normalizeOrigin(config.url);
  if (typeof config.project !== 'string' || !config.project || typeof config.key !== 'string' || config.key.length < 8 || /[\r\n]/.test(config.key)) {
    throw new Error('Invalid local connection file. Connect again.');
  }
  return config;
}

export async function saveConfig(config) {
  const home = configHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temporary = join(home, `config.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, join(home, 'config.json'));
  await chmod(join(home, 'config.json'), 0o600);
}

export async function readBoundedFile(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Input must be a regular file of at most 1 MiB.');
  const value = await readFile(path);
  if (value.byteLength > MAX_BYTES) throw new Error('Input exceeds 1 MiB.');
  if (!isUtf8(value)) throw new Error('Input must contain valid UTF-8 text. Binary files are not supported.');
  return value.toString('utf8');
}

async function responseJson(response) {
  const reader = response.body?.getReader();
  const chunks = []; let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES * 2) { await reader.cancel(); throw new Error('Traqiva response exceeds the 2 MiB limit.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error(`Traqiva returned invalid JSON (HTTP ${response.status}).`); }
}

export async function api(config, path, body) {
  let response;
  try {
    response = await fetch(config.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-traqiva-key': config.key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Traqiva could not be reached. Check the configured origin and network.'); }
  const value = await responseJson(response);
  if (!response.ok) {
    const detail = typeof value?.error === 'string' ? value.error : typeof value?.error?.message === 'string' ? value.error.message : 'Request failed';
    throw new Error(publicError(new Error(`HTTP ${response.status}: ${detail}`), [config.key]));
  }
  return value;
}

export async function identity(config) {
  const result = await api(config, '/api/connection');
  if (result?.connected !== true || result.project?.id !== config.project) throw new Error('The project key does not match the selected project. Nothing was connected.');
  return {
    connected: true,
    project: { id: result.project.id, name: result.project.name },
    workspace: result.workspace ? { id: result.workspace.id, name: result.workspace.name, mode: result.workspace.mode } : null,
    url: config.url,
  };
}

export async function compress(config, text, contentType) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Compression input must be a string of at most 1 MiB.');
  const result = await api(config, '/api/compress', { project_id: config.project, text, ...(contentType ? { content_type: contentType } : {}) });
  if (typeof result?.compressedText !== 'string' || typeof result.recovery_handle !== 'string' || !result.recovery_handle || result.token_basis !== 'estimated' || ![result.original_tokens_estimate, result.optimized_tokens_estimate].every((count) => Number.isFinite(count) && count >= 0)) throw new Error('Traqiva returned an incomplete compression receipt. No savings can be claimed.');
  const verification = await recover(config, result.recovery_handle);
  if (verification.original !== text) throw new Error('Recovery verification did not reproduce the original. No compression result was published.');
  return { ...result, evidence_basis: 'inferred', recovery_verified: true };
}

export async function recover(config, handle) {
  if (typeof handle !== 'string' || !handle || handle.length > 512) throw new Error('A recovery handle of 1–512 characters is required.');
  const result = await api(config, '/api/recover/' + encodeURIComponent(handle));
  if (typeof result?.original !== 'string' || result.project_id !== config.project) throw new Error('Recovery result did not match the connected project.');
  return result;
}

export function containsCredentials(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => /^(authorization|proxy.authorization|x.api.key|x.traqiva.key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret|cookie|set.cookie)$/i.test(key) || containsCredentials(child));
}
