import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { saveBlock, getBlock, listBlocks, deleteBlock } from '../lib/blocks.mjs';

async function isolated(t) {
  const home = await mkdtemp(join(tmpdir(), 'traqiva-blocks-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home };
}

test('reusable scripts retain exact bytes and a verified content hash without executing them', async (t) => {
  const options = await isolated(t);
  const content = '#!/bin/sh\r\necho "DO NOT RUN"\r\n';
  const saved = await saveBlock({ name: 'Release checklist', content, language: 'shell', tags: ['release', 'ci'] }, options);
  assert.equal(saved.schema_version, 1);
  assert.equal(saved.sha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(saved.bytes, Buffer.byteLength(content));
  assert.equal(saved.content, undefined, 'save/list metadata avoids repeating the complete script');
  assert.equal((await getBlock(saved.id, options)).content, content);
  assert.deepEqual((await listBlocks({}, options)).blocks.map((block) => block.id), [saved.id]);
  assert.deepEqual(await readdir(options.home), ['blocks']);
});

test('search finds reusable code by name, description, tags and content; records stay independent', async (t) => {
  const options = await isolated(t);
  const first = await saveBlock({ name: 'JSON cleanup', content: 'JSON.stringify(input)', description: 'Normalize whitespace', tags: ['format'] }, options);
  const second = await saveBlock({ name: 'JSON cleanup', content: 'different', tags: ['other'] }, options);
  for (const query of ['normalize', 'FORMAT', 'stringify']) {
    assert.deepEqual((await listBlocks({ query }, options)).blocks.map((block) => block.id), [first.id]);
  }
  assert.equal((await listBlocks({ limit: 1 }, options)).total, 2);
  assert.equal((await getBlock(first.id, options)).content, 'JSON.stringify(input)');
  assert.equal((await getBlock(second.id, options)).content, 'different');
  assert.deepEqual(await deleteBlock(first.id, options), { deleted: true, id: first.id });
  assert.deepEqual(await deleteBlock(first.id, options), { deleted: false, id: first.id });
  assert.equal((await listBlocks({}, options)).total, 1);
});

test('bounded inputs and IDs reject traversal, oversized scripts and unsupported metadata', async (t) => {
  const options = await isolated(t);
  await assert.rejects(saveBlock({ name: 'x', content: 'x'.repeat(262145) }, options), /256 KiB/);
  await assert.rejects(saveBlock({ name: 'x', content: 'x', tags: Array(21).fill('a') }, options), /tags/);
  await assert.rejects(saveBlock({ name: 'x', content: 'x', path: '../secret' }, options), /arguments/);
  await assert.rejects(getBlock('../config', options), /block ID/);
  await assert.rejects(deleteBlock('../config', options), /block ID/);
  await assert.rejects(listBlocks({ limit: 101 }, options), /limit/);
});

test('tampered and unknown-version blocks fail clearly and are never silently overwritten or removed', async (t) => {
  const options = await isolated(t);
  const saved = await saveBlock({ name: 'Safe code', content: 'safe' }, options);
  const file = join(options.home, 'blocks', saved.id + '.json');
  const value = JSON.parse(await readFile(file, 'utf8'));
  value.content = 'tampered';
  await writeFile(file, JSON.stringify(value));
  await assert.rejects(getBlock(saved.id, options), /integrity/);
  await assert.rejects(listBlocks({}, options), /integrity/);
  await assert.rejects(deleteBlock(saved.id, options), /integrity/);
  value.schema_version = 99;
  await writeFile(file, JSON.stringify(value));
  await assert.rejects(getBlock(saved.id, options), /version/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schema_version, 99);
});

test('the maximum accepted escaped script remains readable and malformed Unicode is rejected', async (t) => {
  const options = await isolated(t);
  const content = '\t\n'.repeat(131072);
  const saved = await saveBlock({ name: 'Large generated script', content }, options);
  assert.equal((await getBlock(saved.id, options)).content, content);
  await assert.rejects(saveBlock({ name: 'Malformed', content: '\ud800' }, options), /UTF-8/);
});
