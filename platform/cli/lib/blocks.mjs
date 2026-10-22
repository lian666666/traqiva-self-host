// Independently implemented local reusable-code store. Never executes saved code.
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { configHome } from './client.mjs';

const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_RECORD_BYTES = 3 * MAX_CONTENT_BYTES;
const MAX_RECORDS = 1000;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const directory = (options) => join(resolve(options?.home || configHome()), 'blocks');

function validateId(id) {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Use a block ID returned by Traqiva.');
  return id;
}

function boundedText(value, name, maximum, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`Block ${name} must be text of ${optional ? '0' : '1'}–${maximum} characters.`);
  return value;
}

function metadata(record) {
  const { content: _content, ...result } = record;
  return { ...result, tags: [...result.tags] };
}

async function blockFiles(options) {
  let entries;
  try { entries = await readdir(directory(options), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = entries.filter((entry) => entry.name.endsWith('.json'));
  if (files.length > MAX_RECORDS) throw new Error('Local Blocks store exceeds the 1,000-record limit. Preserve and archive existing records before adding more.');
  for (const entry of files) if (!entry.isFile() || !idPattern.test(entry.name.slice(0, -5))) throw new Error('Local Blocks store contains an unsupported record. Existing data was preserved.');
  return files.map((entry) => entry.name.slice(0, -5));
}

export async function saveBlock(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['name', 'content', 'language', 'description', 'tags'].includes(key))) throw new Error('Invalid block arguments.');
  const name = boundedText(input.name, 'name', 120);
  const language = boundedText(input.language, 'language', 40, true);
  const description = boundedText(input.description, 'description', 1000, true);
  if (typeof input.content !== 'string' || !input.content || !input.content.isWellFormed() || Buffer.byteLength(input.content) > MAX_CONTENT_BYTES || input.content.includes('\u0000')) throw new Error('Block content must be non-empty UTF-8 text of at most 256 KiB.');
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40 || /[\u0000-\u001f\u007f]/.test(tag)))) throw new Error('Block tags must contain at most 20 labels of 1–40 characters.');
  const tags = [...new Set(input.tags || [])];
  if ((await blockFiles(options)).length >= MAX_RECORDS) throw new Error('Local Blocks store has reached its 1,000-record limit. Existing records were preserved.');
  const now = new Date().toISOString();
  const record = { schema_version: 1, id: randomUUID(), name, language, description, tags, sha256: digest(input.content), bytes: Buffer.byteLength(input.content), created_at: now, updated_at: now, content: input.content };
  await mkdir(directory(options), { recursive: true, mode: 0o700 });
  // A new UUID plus exclusive creation never replaces an existing record.
  await writeFile(join(directory(options), record.id + '.json'), JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' });
  return metadata(record);
}

export async function getBlock(id, options = {}) {
  validateId(id);
  const file = join(directory(options), id + '.json');
  let info;
  try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') throw new Error('Block not found.'); throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD_BYTES) throw new Error('Block integrity check failed: unsupported file. Existing data was preserved.');
  let record;
  try { record = JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('Block integrity check failed: invalid record. Existing data was preserved.'); }
  if (record.schema_version !== 1) throw new Error('Unsupported Blocks storage version. Existing data was preserved.');
  if (record.id !== id || typeof record.content !== 'string' || Buffer.byteLength(record.content) > MAX_CONTENT_BYTES || record.sha256 !== digest(record.content) || record.bytes !== Buffer.byteLength(record.content) || typeof record.name !== 'string' || typeof record.description !== 'string' || typeof record.language !== 'string' || !Array.isArray(record.tags) || !record.tags.every((tag) => typeof tag === 'string') || typeof record.created_at !== 'string' || typeof record.updated_at !== 'string') throw new Error('Block integrity check failed. Existing data was preserved.');
  return record;
}

export async function listBlocks(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['query', 'limit'].includes(key))) throw new Error('Invalid block search arguments.');
  const query = input.query === undefined ? '' : boundedText(input.query, 'query', 200, true).toLowerCase().trim();
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Block list limit must be 1–100.');
  const matches = [];
  // Sequential bounded reads avoid loading up to 256 MiB of script content at once.
  for (const id of await blockFiles(options)) {
    const record = await getBlock(id, options);
    if (!query || [record.name, record.description, record.language, ...record.tags, record.content].some((value) => value.toLowerCase().includes(query))) matches.push(metadata(record));
  }
  matches.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  return { schema_version: 1, blocks: matches.slice(0, limit), total: matches.length, limit, ...(query ? { query } : {}) };
}

export async function deleteBlock(id, options = {}) {
  validateId(id);
  try { await getBlock(id, options); }
  catch (error) { if (error.message === 'Block not found.') return { deleted: false, id }; throw error; }
  await unlink(join(directory(options), id + '.json'));
  return { deleted: true, id };
}
