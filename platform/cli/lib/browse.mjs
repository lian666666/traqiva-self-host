// Independently implemented, static public-web reader. No JavaScript, cookies,
// browser profile, provider call, shell command or private-network access.
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { configHome, MAX_BYTES } from './client.mjs';
import { compressArtifact } from './operations.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const recoveryPattern = /^browse:([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const redirects = new Set([301, 302, 303, 307, 308]);

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    if (address === '168.63.129.16') return false; // Azure platform virtual address.
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    if (address.includes('%')) return false;
    const normalized = new URL('http://[' + address + ']/').hostname.slice(1, -1);
    // Accept only ordinary global unicast. Special-use, mapped, NAT64, ULA,
    // link-local, multicast, Teredo, documentation and 6to4 are all excluded.
    const first = parseInt(normalized.split(':')[0], 16);
    const second = parseInt(normalized.split(':')[1] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) && first !== 0x2002 && first !== 0x3fff;
  }
  return false;
}

function validateUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Use a public HTTP(S) URL of at most 4,096 characters.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Use a valid public HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Browse accepts only public HTTP(S) URLs.');
  if (url.username || url.password) throw new Error('Browse URLs cannot contain credentials.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Browse permits only standard public web ports 80 and 443.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.') && !isIP(host) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host) || (isIP(host) && !isPublicAddress(host))) throw new Error('Browse requires a public internet host; local, private and special-use addresses are blocked.');
  url.hash = '';
  return url;
}

async function resolvePublic(url, resolver) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await resolver(hostname);
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => !item || !isPublicAddress(item.address) || isIP(item.address) !== item.family)) throw new Error('Browse DNS lookup did not resolve exclusively to public internet addresses.');
  return addresses[0];
}

function productionRequest(url, address, { signal }) {
  return new Promise((done, reject) => {
    const request = (url.protocol === 'https:' ? requestHttps : requestHttp)(url, {
      method: 'GET', signal, agent: false, maxHeaderSize: 16 * 1024,
      headers: { 'user-agent': 'Traqiva/0.1 public-web-reader', accept: 'text/html, application/xhtml+xml, text/plain', 'accept-encoding': 'identity' },
      // Pin the already validated DNS answer. A later DNS rebinding answer is
      // never consulted by the HTTP/TLS connection; TLS still checks hostname.
      lookup: (_hostname, options, callback) => callback(null, options?.all ? [address] : address.address, address.family),
    }, done);
    request.on('error', reject);
    request.end();
  });
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£', copy: '©', reg: '®', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match;
    const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '�';
  });
}

function readableHtml(html) {
  const title = decodeEntities((html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 500);
  let text = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const element of ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'head', 'nav', 'footer', 'header', 'aside']) {
    text = text.replace(new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?<\\/${element}\\s*>`, 'gi'), ' ');
  }
  const main = text.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)\s*>/i);
  if (main) text = main[1];
  text = text.replace(/<(?:br|hr)\b[^>]*\/?\s*>|<\/(?:p|div|li|section|article|main|h[1-6]|tr|blockquote|pre)\s*>/gi, '\n').replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text).replace(/[\t\f\v \r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}

async function boundedResponse(response, maxBytes) {
  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) { response.destroy(); throw new Error('Browse response exceeds its size limit.'); }
  const chunks = []; let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > maxBytes) { response.destroy(); throw new Error('Browse response exceeds its size limit.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function boundedOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => !['home', 'maxBytes', 'timeoutMs'].includes(key))) throw new Error('Invalid Browse options.');
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error('Browse size limit must be 1 byte–1 MiB.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('Browse timeout must be 1–30,000ms.');
  return { maxBytes, timeoutMs };
}

async function persistSource(record, options) {
  const directory = join(resolve(options.home || configHome()), 'browse');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = await readdir(directory, { withFileTypes: true });
  if (files.length >= 1000) throw new Error('Browse recovery store has reached 1,000 sources. Archive existing sources before reading more.');
  let storedBytes = 0;
  for (const file of files) {
    if (!file.isFile() || !recoveryPattern.test('browse:' + file.name.replace(/\.json$/, ''))) throw new Error('Browse recovery store contains an unsupported record. Existing data was preserved.');
    storedBytes += (await lstat(join(directory, file.name))).size;
  }
  const serialized = JSON.stringify(record) + '\n';
  if (storedBytes + Buffer.byteLength(serialized) > 128 * MAX_BYTES) throw new Error('Browse recovery store has reached its 128 MiB limit. Archive existing sources before reading more.');
  const id = randomUUID();
  await writeFile(join(directory, id + '.json'), serialized, { flag: 'wx', mode: 0o600 });
  return 'browse:' + id;
}

/** Dependency injection is for isolated network tests, never a CLI/MCP option. */
export function createBrowser(dependencies = {}) {
  const resolver = dependencies.resolve || ((hostname) => lookup(hostname, { all: true, verbatim: true }));
  const request = dependencies.request || productionRequest;
  const compress = dependencies.compress || compressArtifact;
  return async function browse(config, inputUrl, options = {}) {
    const { maxBytes, timeoutMs } = boundedOptions(options);
    let current = validateUrl(inputUrl);
    const originalUrl = current.href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Browse request timed out.')), timeoutMs);
    let response, body, contentType;
    try {
      for (let redirectsFollowed = 0; ; redirectsFollowed++) {
        const address = await Promise.race([resolvePublic(current, resolver), new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Browse request timed out.')), { once: true }))]);
        controller.signal.throwIfAborted();
        response = await request(current, address, { signal: controller.signal });
        if (redirects.has(response.statusCode)) {
          const target = response.headers.location;
          response.destroy();
          if (redirectsFollowed >= 5 || typeof target !== 'string') throw new Error('Browse redirect limit exceeded or redirect is missing a destination.');
          current = validateUrl(new URL(target, current).href);
          continue;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); throw new Error(`Browse failed (HTTP ${response.statusCode}).`); }
        contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType)) { response.destroy(); throw new Error('Browse accepts only HTML or plain-text content types.'); }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); throw new Error('Browse refuses encoded bodies; the server must honor identity content encoding.'); }
        body = await boundedResponse(response, maxBytes);
        break;
      }
    } catch (error) {
      response?.destroy();
      if (controller.signal.aborted || error.name === 'AbortError') throw new Error('Browse request timed out.');
      throw error;
    } finally { clearTimeout(timer); }
    const encoding = String(response.headers['content-type']).match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] || 'utf-8';
    let original;
    try { original = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(body); } catch { throw new Error('Browse could not decode the declared text charset safely.'); }
    const extracted = contentType === 'text/plain' ? { title: '', text: original.trim() } : readableHtml(original);
    if (!extracted.text) throw new Error('The page contains no readable static text. JavaScript-only pages are not executed.');
    const receipt = await compress(config, extracted.text, 'text');
    if (typeof receipt?.compressedText !== 'string') throw new Error('Browse compression returned no usable text.');
    const source = { content_type: contentType, charset: encoding, bytes: body.length, sha256: digest(body), decoded_sha256: digest(original), readable_sha256: digest(extracted.text), retrieved_at: new Date().toISOString() };
    const browse_recovery_handle = await persistSource({ schema_version: 1, original_url: originalUrl, final_url: current.href, title: extracted.title, source, original, original_base64: body.toString('base64'), readable_text: extracted.text }, options);
    return { ...receipt, original_url: originalUrl, final_url: current.href, title: extracted.title, source, browse_recovery_handle, automatic_script_execution: false, extraction: 'static_html_text', source_content: 'untrusted_web_data' };
  };
}

export const browsePage = createBrowser();

export async function recoverBrowse(handle, options = {}) {
  const id = typeof handle === 'string' && recoveryPattern.exec(handle)?.[1];
  if (!id) throw new Error('Use a Browse recovery handle returned by Traqiva.');
  const file = join(resolve(options.home || configHome()), 'browse', id + '.json');
  let info;
  try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') throw new Error('Browse source not found.'); throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * MAX_BYTES) throw new Error('Browse source integrity check failed: unsupported file.');
  let record;
  try { record = JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('Browse source integrity check failed: invalid record.'); }
  if (record.schema_version !== 1 || typeof record.original !== 'string' || typeof record.original_base64 !== 'string' || typeof record.readable_text !== 'string' || record.source?.decoded_sha256 !== digest(record.original) || record.source?.readable_sha256 !== digest(record.readable_text)) throw new Error('Browse source integrity check failed. Existing data was preserved.');
  const bytes = Buffer.from(record.original_base64, 'base64');
  if (bytes.length > MAX_BYTES || bytes.toString('base64') !== record.original_base64 || record.source.sha256 !== digest(bytes) || record.source.bytes !== bytes.length) throw new Error('Browse source integrity check failed. Existing data was preserved.');
  return { ...record, browse_recovery_handle: handle, recovery_verified: true };
}
