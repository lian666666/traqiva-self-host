import { describe, expect, it } from 'vitest';
import { hashSecret, hashPassword, verifyPassword, sameOriginWrite, scrubSecrets, compactJson } from '../server/security';

describe('backend credential and recovery boundaries', () => {
  it('salts password hashes and rejects an incorrect password', async () => {
    const first = await hashPassword('A sufficiently long passphrase');
    const second = await hashPassword('A sufficiently long passphrase');
    expect(first.hash).not.toBe(second.hash);
    expect(await verifyPassword('A sufficiently long passphrase', first)).toBe(true);
    expect(await verifyPassword('incorrect password', first)).toBe(false);
  });
  it('stores a one-way digest rather than the project key', async () => {
    const digest = await hashSecret('tq_test_secret');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('tq_test_secret');
  });
  it('rejects cross-origin and unproven cookie writes', () => {
    expect(sameOriginWrite(new Request('https://app.test/api/projects', { method: 'POST', headers: { origin: 'https://evil.test' } }))).toBe(false);
    expect(sameOriginWrite(new Request('https://app.test/api/projects', { method: 'POST' }))).toBe(false);
    expect(sameOriginWrite(new Request('https://app.test/api/projects', { method: 'POST', headers: { origin: 'https://app.test' } }))).toBe(true);
  });
  it('redacts nested provider credentials without changing normal content', () => {
    expect(scrubSecrets({ headers: { Authorization: 'Bearer private', 'x-api-key': 'private' }, message: 'normal output', nested: [{ api_key: 'private' }] })).toEqual({ headers: { Authorization: '[redacted]', 'x-api-key': '[redacted]' }, message: 'normal output', nested: [{ api_key: '[redacted]' }] });
  });
  it('minifies JSON without changing strings or numeric representations', () => {
    const original = '{\n "n": 9007199254740993, "text": "keep  two spaces", "n2": 1e10\n}';
    const result = compactJson(original);
    expect(result).toBe('{"n":9007199254740993,"text":"keep  two spaces","n2":1e10}');
    expect(compactJson('  an arbitrary log\nwith spacing')).toBe('  an arbitrary log\nwith spacing');
    expect(compactJson('{invalid json}')).toBe('{invalid json}');
  });
});
