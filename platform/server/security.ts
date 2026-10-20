const encoder = new TextEncoder();
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function randomSecret(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function hashSecret(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export type PasswordHash = { hash: string; salt: string; iterations: number };
export async function hashPassword(password: string, salt = randomSecret(16), iterations = 100_000): Promise<PasswordHash> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations }, key, 256);
  return { hash: Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join(''), salt, iterations };
}
export async function verifyPassword(password: string, stored: PasswordHash) {
  const actual = await hashPassword(password, stored.salt, stored.iterations);
  let diff = actual.hash.length ^ stored.hash.length;
  for (let i = 0; i < actual.hash.length; i++) diff |= actual.hash.charCodeAt(i) ^ (stored.hash.charCodeAt(i) || 0);
  return diff === 0;
}
export function sameOriginWrite(request: Request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
export async function readBodyText(request: Pick<Request, 'body' | 'headers'>, maxBytes = 1_048_576): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) throw new ApiError(413, 'Request body is too large.');
  if (!request.body) throw new ApiError(400, 'A JSON body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, 'Request body is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ApiError(400, 'The request body must be valid UTF-8.'); }
}
export async function readJson(request: Request, maxBytes = 1_048_576): Promise<any> {
  const text = await readBodyText(request, maxBytes);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Object required');
    return parsed;
  }
  catch { throw new ApiError(400, 'Invalid JSON.'); }
}
export function redactCredential(value: any, secret: string): any {
  if (typeof value === 'string') return value.split(secret).join('[redacted]');
  if (Array.isArray(value)) return value.map(item => redactCredential(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactCredential(item, secret)]));
  return value;
}
const secretFields = /^(?:authorization|proxy-authorization|x-api-key|x-traqiva-key|api[_-]?key|provider[_-]?key|password|password_hash|password_salt|access_token|refresh_token|id_token|cookie|set-cookie|token|secret)$/i;
export function scrubSecrets(value: any, depth = 0): any {
  if (depth > 30) return '[depth limit]';
  if (Array.isArray(value)) return value.map(item => scrubSecrets(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretFields.test(key) ? '[redacted]' : scrubSecrets(item, depth + 1)]));
  if (typeof value === 'string') return value.replace(/\b(?:sk-|tq_)[A-Za-z0-9_-]{16,}\b/g, '[redacted]');
  return value;
}
// Strip only JSON grammar whitespace outside strings. JSON.stringify would round
// large integer literals and normalize other numeric lexemes, so is not lossless.
export function compactJson(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  try { JSON.parse(text); } catch { return text; }
  let quoted = false, escaped = false, result = '';
  for (const char of text) {
    if (quoted) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; result += char; }
    else if (!/[\t\n\r ]/.test(char)) result += char;
  }
  return result;
}
export function stringField(value: unknown, name: string, max = 200, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new ApiError(400, `${name} is invalid.`);
  return value.trim();
}
