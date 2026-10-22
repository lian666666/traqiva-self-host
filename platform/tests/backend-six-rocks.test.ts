import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, scheduled } from '../server/index';
import type { Database, Env, Statement } from '../server/types';

class SqliteStatement implements Statement {
  values: unknown[] = [];
  constructor(public owner: SqliteDatabase, public sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.owner.raw.prepare(this.sql).get(...this.values as never[]) ?? null) as T | null; }
  async all<T>() { return { results: this.owner.raw.prepare(this.sql).all(...this.values as never[]) as T[] }; }
  async run() { return this.owner.raw.prepare(this.sql).run(...this.values as never[]); }
}
class SqliteDatabase implements Database {
  raw = new DatabaseSync(':memory:');
  constructor() { const root = new URL('../migrations/', import.meta.url); for (const name of readdirSync(root).filter(name => name.endsWith('.sql')).sort()) this.raw.exec(readFileSync(new URL(name, root), 'utf8')); }
  prepare(sql: string) { return new SqliteStatement(this, sql); }
  async batch(statements: Statement[]) { const result = []; for (const statement of statements) result.push(await statement.run()); return result; }
}
let db: SqliteDatabase, env: Env, pending: Promise<unknown>[];
async function request(path: string, options: { method?: string; body?: unknown; cookie?: string; key?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ origin: 'https://app.test', ...options.headers });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.key) headers.set('x-traqiva-key', options.key);
  return app.fetch(new Request(`https://app.test${path}`, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }), env, { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException() {}, props: {} });
}
async function account(email = 'one@example.test') {
  const response = await request('/api/auth/register', { method: 'POST', body: { email, name: 'Tester', password: 'A sufficiently long test passphrase' } });
  expect(response.status).toBe(201);
  const body = await response.json() as any, cookie = response.headers.get('set-cookie')!.split(';')[0];
  await request('/api/consent', { method: 'POST', cookie, body: { version: '2026-10-20.1', accepted: true } });
  const key = await (await request('/api/keys', { method: 'POST', cookie, body: { project_id: body.activeProject.id, name: 'Test' } })).json() as any;
  return { cookie, project: body.activeProject, user: body.user, key: key.key };
}
const policy = { enabled: true, provider: 'openai', tiers: { small: { model: 'test-small', reasoning_effort: 'low' }, balanced: { model: 'test-balanced', reasoning_effort: 'medium' }, reasoning: { model: 'test-reasoning', reasoning_effort: 'high' } }, small_max_chars: 1200, balanced_max_chars: 6000 };
const upstream = () => vi.fn(async () => new Response(JSON.stringify({ output: [], usage: { input_tokens: 20, output_tokens: 3 } }), { headers: { 'content-type': 'application/json' } }));
beforeEach(() => { db = new SqliteDatabase(); env = { DB: db }; pending = []; });
afterEach(async () => { await Promise.allSettled(pending); db.raw.close(); vi.unstubAllGlobals(); });

describe('opt-in project Auto routing with synthetic upstream only', () => {
  it('defaults off, enforces tenant and owner access, validates compatibility policy and audits changes', async () => {
    const one = await account(), two = await account('two@example.test');
    expect((await request(`/api/auto?project=${one.project.id}`)).status).toBe(401);
    expect((await request(`/api/auto?project=${one.project.id}`, { cookie: two.cookie })).status).toBe(404);
    const defaults = await (await request(`/api/auto?project=${one.project.id}`, { cookie: one.cookie })).json() as any;
    expect(defaults).toMatchObject({ settings: { enabled: false, provider: 'openai', updated_at: null }, sentinel: 'traqiva-auto', method: 'rules_v1' });
    const save = (body: any) => request('/api/auto', { method: 'PATCH', cookie: one.cookie, body: { project_id: one.project.id, ...body } });
    expect((await save({ enabled: true })).status).toBe(400);
    expect((await save({ ...policy, provider: 'anthropic' })).status).toBe(400);
    expect((await save({ ...policy, small_max_chars: 10000 })).status).toBe(400);
    expect((await save({ ...policy, tiers: { ...policy.tiers, small: { model: 'sk-private-credential' } } })).status).toBe(400);
    expect((await save(policy)).status).toBe(200);
    expect(db.raw.prepare("SELECT action FROM audit_log WHERE action='auto.configured'").get()).toEqual({ action: 'auto.configured' });
    expect((await save({ enabled: false })).status).toBe(200);
    const disabled = await (await request(`/api/auto?project=${one.project.id}`, { cookie: one.cookie })).json() as any;
    expect(disabled.settings.tiers.small.model).toBe('test-small');
    db.raw.prepare("UPDATE members SET role='member' WHERE user_id=?").run(one.user.id);
    expect((await save(policy)).status).toBe(403);
  });

  it('never forwards the Auto sentinel when disabled or to an unsupported provider', async () => {
    const one = await account(), network = upstream(); vi.stubGlobal('fetch', network);
    const call = (path = '/v1/responses') => request(path, { method: 'POST', key: one.key, headers: { authorization: 'Bearer dummy-upstream-key' }, body: { model: 'traqiva-auto', input: 'Hello' } });
    expect((await call()).status).toBe(400);
    await request('/api/auto', { method: 'PATCH', cookie: one.cookie, body: { project_id: one.project.id, ...policy } });
    expect((await call('/v1/messages')).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    ['/v1/responses', { input: 'Translate hello into Spanish.' }, 'small', 'low'],
    ['/v1/chat/completions', { messages: [{ role: 'user', content: 'Summarize this. '.repeat(120) }] }, 'balanced', 'medium'],
    ['/v1/responses', { input: 'Review the architecture and security tradeoffs.' }, 'reasoning', 'high'],
    ['/v1/responses', { input: 'Short task', tools: [{ type: 'function', name: 'example', parameters: {} }] }, 'reasoning', 'high'],
  ])('routes %s by a documented heuristic and persists trace decision (%s)', async (path, input, tier, effort) => {
    const one = await account();
    await request('/api/auto', { method: 'PATCH', cookie: one.cookie, body: { project_id: one.project.id, ...policy } });
    const network = upstream(); vi.stubGlobal('fetch', network);
    const response = await request(path, { method: 'POST', key: one.key, headers: { authorization: 'Bearer dummy-upstream-key', 'x-traqiva-price-input': '100', 'x-traqiva-price-output': '100' }, body: { model: 'traqiva-auto', ...input } });
    await response.text(); await Promise.all(pending);
    expect(response.status).toBe(200);
    const sent = JSON.parse((network.mock.calls[0] as any)[1].body);
    expect(sent.model).toBe(`test-${tier}`);
    expect(path === '/v1/responses' ? sent.reasoning.effort : sent.reasoning_effort).toBe(effort);
    expect(response.headers.get('x-traqiva-routing-tier')).toBe(tier);
    const trace = await (await request(`/api/traces?project=${one.project.id}`, { cookie: one.cookie })).json() as any;
    expect(trace.items[0]).toMatchObject({ model: `test-${tier}`, cost_usd: null, routing: { requested_model: 'traqiva-auto', selected_model: `test-${tier}`, tier, method: 'rules_v1', reasoning_effort: effort } });
    expect(JSON.stringify(trace)).not.toContain('dummy-upstream-key');
  });

  it('preserves explicit model bodies byte-for-byte and preserves explicit effort for Auto', async () => {
    const one = await account(); await request('/api/auto', { method: 'PATCH', cookie: one.cookie, body: { project_id: one.project.id, ...policy } });
    const network = upstream(); vi.stubGlobal('fetch', network);
    const raw = '{ "model":"explicit-model", "input":[9007199254740993,1e10], "reasoning":{"effort":"high"} }';
    const response = await app.fetch(new Request('https://app.test/v1/responses', { method: 'POST', headers: { 'x-traqiva-key': one.key, authorization: 'Bearer dummy-key' }, body: raw }), env);
    await response.text(); expect((network.mock.calls[0] as any)[1].body).toBe(raw);
    const routed = await request('/v1/responses', { method: 'POST', key: one.key, headers: { authorization: 'Bearer dummy-key' }, body: { model: 'traqiva-auto', input: 'Hello', reasoning: { effort: 'medium', summary: 'auto' } } });
    await routed.text();
    expect(JSON.parse((network.mock.calls[1] as any)[1].body).reasoning).toEqual({ effort: 'medium', summary: 'auto' });
  });

  it('preserves Auto request numeric lexemes, escaped strings, tool schemas and explicit reasoning values', async () => {
    const one = await account(); await request('/api/auto', { method: 'PATCH', cookie: one.cookie, body: { project_id: one.project.id, ...policy } });
    const network = upstream(); vi.stubGlobal('fetch', network);
    const quoted = JSON.stringify('Keep "model": and } inside text');
    const raw = '{ "model":"traqiva-auto", "input":' + quoted + ', "tools":[{"type":"function","name":"pick","parameters":{"type":"integer","enum":[9007199254740993,1e10,1.00]}}], "reasoning":{"summary":"auto"} }';
    const routed = await app.fetch(new Request('https://app.test/v1/responses', { method: 'POST', headers: { 'x-traqiva-key': one.key, authorization: 'Bearer dummy-key' }, body: raw }), env);
    await routed.text();
    const sent = (network.mock.calls[0] as any)[1].body as string;
    expect(sent).toContain('9007199254740993,1e10,1.00');
    expect(sent).toContain(quoted);
    expect(JSON.parse(sent)).toMatchObject({ model: 'test-reasoning', reasoning: { summary: 'auto', effort: 'high' } });
    for (const reasoning of [{ effort: null }, { effort: 'low' }, null]) {
      const response = await request('/v1/responses', { method: 'POST', key: one.key, headers: { authorization: 'Bearer dummy-key' }, body: { model: 'traqiva-auto', input: 'Hi', reasoning } });
      await response.text();
      expect(JSON.parse((network.mock.calls.at(-1) as any)[1].body).reasoning).toEqual(reasoning);
    }
  });
});

describe('evidence-backed waste fixes from retained trace samples', () => {
  it('independently disables manual and scheduled waste analysis while preserving prior findings', async () => {
    const one = await account();
    const imported = () => request('/api/traces/import', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id, records: [{ model: 'test', status: 'error' }] } });
    await imported();
    await request('/api/improvements/analyze', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id } });
    const initial = db.raw.prepare('SELECT COUNT(*) AS count FROM improvements').get();
    expect(initial).toEqual({ count: 2 });
    expect((await request('/api/auto', { method: 'PATCH', cookie: one.cookie, body: { project_id: one.project.id, waste_checks_enabled: false } })).status).toBe(200);
    const blocked = await request('/api/improvements/analyze', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id } });
    expect(blocked.status).toBe(409);
    expect((await blocked.json() as any).error).toContain('disabled');
    const readable = await (await request(`/api/improvements?project=${one.project.id}`, { cookie: one.cookie })).json() as any;
    expect(readable.items).toHaveLength(2);
    db.raw.prepare("UPDATE improvements SET description='Kept finding'").run();
    db.raw.prepare("UPDATE workspaces SET autopilot='suggest'").run();
    await imported();
    await scheduled({}, env, { waitUntil: task => pending.push(task) }); await Promise.all(pending);
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM improvements WHERE description='Kept finding'").get()).toEqual({ count: 2 });
    expect((await request('/api/auto', { method: 'PATCH', cookie: one.cookie, body: { project_id: one.project.id, waste_checks_enabled: true } })).status).toBe(200);
    expect((await request('/api/improvements/analyze', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id } })).status).toBe(200);
  });
  it('finds repeated leading context and missing cache use without claiming savings or including prompt text', async () => {
    const one = await account(), prefix = 'PRIVATE_PROMPT_CONTENT_'.repeat(60);
    const response = await request('/api/traces/import', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id, records: Array.from({ length: 4 }, (_, index) => ({ model: 'test', provider: 'openai', status: 'success', input_tokens: 2400, output_tokens: 20, cached_tokens: 0, token_basis: 'provider', request: { model: 'test', messages: [{ role: 'system', content: prefix }, { role: 'user', content: `Task ${index}` }] } })) } });
    expect(response.status).toBe(201);
    const analysis = await (await request('/api/improvements/analyze', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id } })).json() as any;
    const prefixRule = analysis.items.find((item: any) => item.kind === 'repeated-prefix');
    expect(prefixRule).toBeDefined();
    const evidence = JSON.parse(prefixRule.evidence_json);
    expect(evidence).toMatchObject({ method: 'leading_context_sample_v1', sampled_requests: 4, matching_requests: 4, window_days: 7, sample_limit: 200, savings_verified: false });
    expect(evidence.trace_ids).toHaveLength(4);
    expect(evidence.prefix_tokens_estimate).toBeGreaterThan(0);
    expect(JSON.stringify(analysis)).not.toContain('PRIVATE_PROMPT_CONTENT_');
    const cacheRule = analysis.items.find((item: any) => item.kind === 'cache-coverage');
    expect(JSON.parse(cacheRule.evidence_json)).toMatchObject({ measured_requests: 4, cached_input_ratio: 0, savings_verified: false });
  });

  it('ignores future, stale, other-project and unmeasured cache traces; expires obsolete machine suggestions', async () => {
    const one = await account(), two = await account('two@example.test');
    const prefix = 'Long fixed instructions '.repeat(80), current = new Date().toISOString();
    const records = [current, current, current].map(created_at => ({ created_at, model: 'test', request: { instructions: prefix, input: 'Hi' }, input_tokens: 2400, output_tokens: 1 }));
    await request('/api/traces/import', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id, records } });
    const analyze = async () => (await (await request('/api/improvements/analyze', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id } })).json() as any).items;
    expect((await analyze()).some((item: any) => item.kind === 'repeated-prefix')).toBe(true);
    expect((await analyze()).some((item: any) => item.kind === 'cache-coverage')).toBe(false);
    db.raw.prepare("UPDATE traces SET created_at='2000-01-01T00:00:00.000Z' WHERE project_id=?").run(one.project.id);
    await request('/api/traces/import', { method: 'POST', cookie: two.cookie, body: { project_id: two.project.id, records } });
    await request('/api/traces/import', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id, records: records.map(row => ({ ...row, created_at: '2999-01-01T00:00:00.000Z' })) } });
    expect((await analyze()).some((item: any) => ['repeated-prefix', 'cache-coverage'].includes(item.kind))).toBe(false);
  });
});
