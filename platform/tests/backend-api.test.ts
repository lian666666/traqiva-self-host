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
  async batch(statements: Statement[]) { this.raw.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.raw.exec('COMMIT'); return results; } catch (error) { this.raw.exec('ROLLBACK'); throw error; } }
}
let db: SqliteDatabase, env: Env, pending: Promise<unknown>[];
async function request(path: string, options: { method?: string; body?: unknown; cookie?: string; key?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ origin: 'https://app.test', ...options.headers });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.key) headers.set('x-traqiva-key', options.key);
  return app.fetch(new Request(`https://app.test${path}`, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }), env, { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException() {}, props: {} });
}
async function register(email = 'one@example.test') {
  const response = await request('/api/auth/register', { method: 'POST', body: { email, name: 'Tester', password: 'A sufficiently long test passphrase' } });
  expect(response.status).toBe(201);
  const body = await response.json() as any;
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  expect((await request('/api/consent', { method: 'POST', cookie, body: { version: '2026-10-20.1', accepted: true } })).status).toBe(200);
  return { cookie, project: body.activeProject, workspace: body.workspace, user: body.user };
}
async function keyFor(cookie: string, projectId: string) {
  const response = await request('/api/keys', { method: 'POST', cookie, body: { project_id: projectId, name: 'Test key' } });
  expect(response.status).toBe(201);
  return response.json() as Promise<any>;
}
beforeEach(() => { db = new SqliteDatabase(); env = { DB: db }; pending = []; });
afterEach(async () => { await Promise.allSettled(pending); db.raw.close(); vi.unstubAllGlobals(); });

describe('real SQL authentication and tenant authorization', () => {
  it('distinguishes unknown cache counts from measured zero and totals only cache-covered input for cache ratios', async () => {
    const account = await register();
    const overview = async () => (await (await request(`/api/overview?project=${account.project.id}`, { cookie: account.cookie })).json() as any).stats;
    expect(await overview()).toMatchObject({ cache_available_requests: 0, cache_covered_input_tokens: 0 });
    const ingest = (records: unknown[]) => request('/api/traces/import', { method: 'POST', cookie: account.cookie, body: { project_id: account.project.id, records } });
    expect((await ingest([{ model: 'cache-unreported', input_tokens: 900, output_tokens: 1 }])).status).toBe(201);
    expect(await overview()).toMatchObject({ requests: 1, input_tokens: 900, cached_tokens: 0, cache_available_requests: 0, cache_covered_input_tokens: 0 });
    expect((await ingest([{ model: 'cache-zero', input_tokens: 100, output_tokens: 1, cached_tokens: 0 }])).status).toBe(201);
    expect(await overview()).toMatchObject({ requests: 2, input_tokens: 1000, cached_tokens: 0, cache_available_requests: 1, cache_covered_input_tokens: 100 });
    expect((await ingest([{ model: 'cache-reported', input_tokens: 200, output_tokens: 1, cached_tokens: 60 }])).status).toBe(201);
    const mixed = await overview();
    expect(mixed).toMatchObject({ requests: 3, input_tokens: 1200, cached_tokens: 60, cache_available_requests: 2, cache_covered_input_tokens: 300 });
    expect(mixed.cached_tokens / mixed.cache_covered_input_tokens).toBe(0.2);
  });
  it('uses the same current-instant window for overview totals, compression, timeline, models and recent requests', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:34:56.000Z'));
    try {
      const account = await register(), from = '2026-10-14T00:00:00.000Z', at = '2026-10-20T12:34:56.000Z';
      const future = ['2026-10-20T12:34:56.001Z', '2026-10-21T00:00:00.000Z'];
      const imported = await request('/api/traces/import', { method: 'POST', cookie: account.cookie, body: { project_id: account.project.id, records: [
        { model: 'measured-zero', created_at: from, input_tokens: 0, output_tokens: 0, cached_tokens: 0, cost_usd: 0, latency_ms: 0 },
        { model: 'unpriced', created_at: at, input_tokens: 10, output_tokens: 2, cached_tokens: 3, latency_ms: 10 },
        ...future.map((created_at, index) => ({ model: `future-${index}`, created_at, status: 'error', input_tokens: 9000, output_tokens: 1000, cached_tokens: 100, cost_usd: 100, latency_ms: 1000, original_tokens: 100, optimized_tokens: 1, compressed: true })),
        { model: 'too-old', created_at: '2026-10-13T23:59:59.999Z', input_tokens: 9000, output_tokens: 1000, cost_usd: 100 },
      ] } });
      expect(imported.status).toBe(201);
      for (const created_at of [from, ...future]) {
        const response = await request('/api/compression-events', { method: 'POST', cookie: account.cookie, body: { project_id: account.project.id, algorithm: 'synthetic-window-fixture', source: 'test', input_bytes: 100, output_bytes: 60, original_tokens_estimate: 25, optimized_tokens_estimate: 15 } });
        expect(response.status).toBe(201);
        const { event } = await response.json() as any;
        db.raw.prepare('UPDATE compression_events SET created_at=? WHERE id=?').run(created_at, event.id);
      }
      const response = await request(`/api/overview?project=${account.project.id}&days=7`, { cookie: account.cookie });
      expect(response.status).toBe(200);
      const overview = await response.json() as any;
      expect(overview.stats).toMatchObject({ requests: 2, input_tokens: 10, output_tokens: 2, cached_tokens: 3, estimated_cost_usd: 0, errors: 0, avg_latency_ms: 5, usage_available_requests: 2, priced_requests: 1, saved_tokens: null, compression_events: 1, compression_estimated_saved_tokens: 10 });
      expect(overview.series).toHaveLength(7);
      expect(overview.series[0]).toEqual({ date: '2026-10-14', requests: 1, tokens: 0, cost: 0 });
      expect(overview.series[6]).toEqual({ date: '2026-10-20', requests: 1, tokens: 12, cost: null });
      expect(overview.series.reduce((sum: number, day: any) => sum + day.requests, 0)).toBe(2);
      expect(overview.models).toEqual(expect.arrayContaining([{ model: 'measured-zero', requests: 1, tokens: 0, cost: 0 }, { model: 'unpriced', requests: 1, tokens: 12, cost: null }]));
      expect(overview.models).toHaveLength(2);
      expect(overview.traces.map((trace: any) => trace.model)).toEqual(['unpriced', 'measured-zero']);
      expect(db.raw.prepare('SELECT COUNT(*) AS count FROM traces').get()).toEqual({ count: 5 });
      expect(db.raw.prepare('SELECT COUNT(*) AS count FROM compression_events').get()).toEqual({ count: 3 });
    } finally { vi.useRealTimers(); }
  });
  it('keeps estimated local compression events separate from real provider requests', async () => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    const response = await request('/api/compression-events', { method: 'POST', key: key.key, body: { algorithm: 'native-log', source: 'native', input_bytes: 4000, output_bytes: 2800, original_tokens_estimate: 1000, optimized_tokens_estimate: 700 } });
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body.event.token_basis).toBe('estimated');
    expect(body.event.estimated_saved_tokens).toBe(300);
    const overview = await (await request(`/api/overview?project=${account.project.id}`, { cookie: account.cookie })).json() as any;
    expect(overview.stats.requests).toBe(0);
    expect(overview.stats.input_tokens).toBe(0);
    expect(overview.stats.compression_events).toBe(1);
    expect(overview.stats.compression_estimated_saved_tokens).toBe(300);
  });
  it('starts with empty analytics and generates suggestions only from actual imported records', async () => {
    const account = await register();
    const empty = await (await request(`/api/overview?project=${account.project.id}`, { cookie: account.cookie })).json() as any;
    expect(empty.stats.requests).toBe(0);
    expect(empty.stats.usage_available_requests).toBe(0);
    expect(empty.stats.estimated_cost_usd).toBeNull();
    expect(empty.stats.saved_tokens).toBeNull();
    expect((await (await request('/api/improvements/analyze', { method: 'POST', cookie: account.cookie, body: { project_id: account.project.id } })).json() as any).items).toEqual([]);
    await request('/api/traces/import', { method: 'POST', cookie: account.cookie, body: { project_id: account.project.id, records: [{ model: 'failing-model', status: 'error' }] } });
    const analysis = await (await request('/api/improvements/analyze', { method: 'POST', cookie: account.cookie, body: { project_id: account.project.id } })).json() as any;
    expect(analysis.items.length).toBe(2);
    const accepted = await (await request(`/api/improvements/${analysis.items[0].id}`, { method: 'PATCH', cookie: account.cookie, body: { status: 'accepted' } })).json() as any;
    expect(accepted.applied).toBe(false);
    const inbox = await (await request(`/api/inbox?project=${account.project.id}`, { cookie: account.cookie })).json() as any;
    expect(inbox.items.length).toBe(2);
    const filtered = await (await request(`/api/traces?project=${account.project.id}&search=failing&status=error`, { cookie: account.cookie })).json() as any;
    expect(filtered.items.length).toBe(1);
    const summary = await (await request('/api/ask', { method: 'POST', cookie: account.cookie, body: { project_id: account.project.id, question: 'Summarize traffic' } })).json() as any;
    expect(summary.answer).toContain('1 request,');
    expect(summary.answer).not.toContain('1 requests');
  });
  it('sets secure session flags, verifies passwords and revokes logout sessions', async () => {
    const response = await request('/api/auth/register', { method: 'POST', body: { name: 'Alice', email: 'alice@example.test', password: 'A sufficiently long test passphrase' } });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(response.headers.get('set-cookie')).toMatch(/Secure/);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=Lax/);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    expect((await request('/api/session', { cookie })).status).toBe(200);
    expect((await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password: 'incorrect' } })).status).toBe(401);
    const login = await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password: 'A sufficiently long test passphrase' } });
    expect(login.status).toBe(200);
    await request('/api/auth/logout', { method: 'POST', cookie });
    expect((await (await request('/api/session', { cookie })).json() as any).user).toBeNull();
    const stored = db.raw.prepare('SELECT password_hash FROM users').get() as any;
    expect(stored.password_hash).not.toContain('passphrase');
  });
  it('isolates project statistics, traces, recovery, keys and evaluations across tenants', async () => {
    const one = await register(), two = await register('two@example.test');
    const keys = await keyFor(one.cookie, one.project.id);
    const imported = await request('/api/ingest', { method: 'POST', key: keys.key, body: { records: [{ model: 'custom', provider: 'openai', status: 'success', token_basis: 'provider', input_tokens: 100, output_tokens: 10, cached_tokens: 30, request: { Authorization: 'Bearer secret' } }] } });
    expect(imported.status).toBe(201);
    const traceId = (await imported.json() as any).ids[0];
    expect((await request(`/api/overview?project=${one.project.id}`, { cookie: two.cookie })).status).toBe(404);
    expect((await request(`/api/traces/${traceId}`, { cookie: two.cookie })).status).toBe(404);
    expect((await request(`/api/keys?project=${one.project.id}`, { cookie: two.cookie })).status).toBe(404);
    expect((await request('/api/keys', { method: 'POST', cookie: two.cookie, body: { project_id: one.project.id, name: 'attack' } })).status).toBe(404);
    const overview = await (await request(`/api/overview?project=${one.project.id}`, { cookie: one.cookie })).json() as any;
    expect(overview.stats.requests).toBe(1);
    expect(overview.stats.input_tokens).toBe(100);
    expect(overview.stats.estimated_cost_usd).toBeNull();
    expect(overview.stats.saved_tokens).toBeNull();
    const trace = await (await request(`/api/traces/${traceId}`, { cookie: one.cookie })).json() as any;
    expect(trace.request.Authorization).toBe('[redacted]');
    const compacted = await (await request('/api/compress', { method: 'POST', key: keys.key, body: { text: '{\n "x": 123\n}' } })).json() as any;
    expect(compacted.changed).toBe(true);
    expect((await request(`/api/recover/${compacted.recovery_handle}`, { cookie: two.cookie })).status).toBe(404);
    expect((await (await request(`/api/recover/${compacted.recovery_handle}`, { cookie: one.cookie })).json() as any).original).toBe('{\n "x": 123\n}');
    const suite = await (await request('/api/evals', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id, name: 'Exact', cases: [{ input: 'a', expected: 'ok', actual: 'ok' }, { input: 'b', expected: 'ok', actual: 'OK' }] } })).json() as any;
    expect((await request(`/api/evals/${suite.suite.id}/run`, { method: 'POST', cookie: two.cookie })).status).toBe(404);
    const run = await (await request(`/api/evals/${suite.suite.id}/run`, { method: 'POST', cookie: one.cookie })).json() as any;
    expect(run.run.passed).toBe(1);
    expect(run.run.total).toBe(2);
    expect(run.run.provider_called).toBe(false);
    const sensitiveSuite = await (await request('/api/evals', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id, name: 'Redacted comparison', cases: [{ input: 'sensitive text', expected: 'sk-aaaaaaaaaaaaaaaaaaaa', actual: 'sk-bbbbbbbbbbbbbbbbbbbb' }] } })).json() as any;
    const sensitiveRun = await (await request(`/api/evals/${sensitiveSuite.suite.id}/run`, { method: 'POST', cookie: one.cookie })).json() as any;
    expect(sensitiveRun.run.passed).toBe(0);
    expect(JSON.stringify(db.raw.prepare('SELECT cases_json FROM eval_suites WHERE id=?').get(sensitiveSuite.suite.id))).not.toContain('sk-aaaaaaaaaaaaaaaaaaaa');
  });
  it('stores only key hashes and immediately rejects a revoked key', async () => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    const stored = db.raw.prepare('SELECT key_hash,prefix FROM project_keys').get() as any;
    expect(stored.key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.key_hash).not.toBe(key.key);
    const listed = await (await request(`/api/keys?project=${account.project.id}`, { cookie: account.cookie })).json() as any;
    expect(JSON.stringify(listed)).not.toContain(key.key);
    expect((await request('/api/connection', { key: key.key })).status).toBe(200);
    expect((await request(`/api/keys/${key.record.id}`, { method: 'DELETE', cookie: account.cookie })).status).toBe(200);
    expect((await request('/api/connection', { key: key.key })).status).toBe(401);
  });
  it('rejects cookie writes from another origin and over-limit bodies', async () => {
    const account = await register();
    expect((await request('/api/projects', { method: 'POST', cookie: account.cookie, headers: { origin: 'https://attacker.test' }, body: { name: 'Bad' } })).status).toBe(403);
    const response = await request('/api/projects', { method: 'POST', cookie: account.cookie, body: { name: 'x'.repeat(1_049_000) } });
    expect(response.status).toBe(413);
  });
  it('rejects an invalid import atomically and does not mark absent usage as provider measured', async () => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    const invalid = await request('/api/ingest', { method: 'POST', key: key.key, body: { records: [{ model: 'valid' }, null] } });
    expect(invalid.status).toBe(400);
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM traces').get() as any).count).toBe(0);
    const partial = await request('/api/ingest', { method: 'POST', key: key.key, body: { records: [{ model: 'metadata-only', token_basis: 'provider' }] } });
    expect(partial.status).toBe(201);
    expect((db.raw.prepare('SELECT token_basis FROM traces').get() as any).token_basis).toBe('unavailable');
  });
  it('normalizes numeric HTTP failures and labels unqualified client counters as estimates', async () => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    expect((await request('/api/ingest', { method: 'POST', key: key.key, body: { records: [{ model: 'reported', status: 429, input_tokens: 10, output_tokens: 0 }] } })).status).toBe(201);
    const trace = db.raw.prepare('SELECT status,http_status,input_tokens,token_basis FROM traces').get() as any;
    expect(trace.status).toBe('error');
    expect(trace.http_status).toBe(429);
    expect(trace.input_tokens).toBe(10);
    expect(trace.token_basis).toBe('estimated');
  });
  it('renames an owned project but rejects a different tenant', async () => {
    const one = await register(), two = await register('two@example.test');
    expect((await request(`/api/projects/${one.project.id}`, { method: 'PATCH', cookie: two.cookie, body: { name: 'stolen' } })).status).toBe(404);
    db.raw.prepare('INSERT INTO members(workspace_id,user_id,role) VALUES(?,?,?)').run(one.workspace.id, two.user.id, 'viewer');
    expect((await request(`/api/projects/${one.project.id}`, { method: 'PATCH', cookie: two.cookie, body: { name: 'viewer edit' } })).status).toBe(403);
    const response = await request(`/api/projects/${one.project.id}`, { method: 'PATCH', cookie: one.cookie, body: { name: 'Renamed project' } });
    expect(response.status).toBe(200);
    expect((await response.json() as any).project.name).toBe('Renamed project');
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM projects WHERE workspace_id=?').get(one.workspace.id) as any).count).toBe(1);
    expect((db.raw.prepare("SELECT action FROM audit_log WHERE action='project.renamed'").get() as any).action).toBe('project.renamed');
  });
});

describe('optional BYOK project assistant, using mock providers only', () => {
  it.each(['openai', 'anthropic'])('rejects %s redirects using the Workers-supported manual mode without forwarding secrets', async provider => {
    const account = await register();
    const network = vi.fn(async (_url: unknown, options: RequestInit) => {
      if (options.redirect === 'error') throw new TypeError('Invalid redirect value in Workers');
      return new Response('sensitive-upstream-body', { status: 302, headers: { location: 'https://untrusted.example.test/capture' } });
    });
    vi.stubGlobal('fetch', network);
    const response = await request('/api/ask', { method: 'POST', cookie: account.cookie, headers: { authorization: 'Bearer private-provider-secret' }, body: { project_id: account.project.id, provider, model: 'selected', question: 'Analyze' } });
    expect(network).toHaveBeenCalledTimes(1); expect(network.mock.calls[0][1].redirect).toBe('manual');
    expect(response.status).toBe(502); expect(response.headers.get('location')).toBeNull();
    const result = await response.json() as any;
    expect(result.upstream_status).toBe(302); expect(result.answer).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('sensitive-upstream-body');
    expect(JSON.stringify(result)).not.toContain('private-provider-secret');
  });
  it('grounds an OpenAI response in this project metadata and keeps provider secrets out of context and storage', async () => {
    const one = await register(), two = await register('two@example.test');
    await request('/api/traces/import', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id, records: [{ model: 'owned-model', input_tokens: 100, output_tokens: 10, request: { private: 'PRIVATE_PROMPT_NEVER_SEND' }, response: { private: 'PRIVATE_RESPONSE_NEVER_SEND' } }] } });
    await request('/api/traces/import', { method: 'POST', cookie: two.cookie, body: { project_id: two.project.id, records: [{ model: 'OTHER_TENANT_NEVER_SEND' }] } });
    const network = vi.fn(async (url: string, options: any) => {
      if (options.redirect === 'error') throw new TypeError('Invalid redirect value in Workers');
      expect(options.redirect).toBe('manual');
      expect(url).toBe('https://api.openai.com/v1/responses');
      expect(options.headers.get('authorization')).toBe('Bearer ask-upstream-private');
      const payload = JSON.parse(options.body);
      expect(payload.model).toBe('user-selected-model');
      expect(payload.store).toBe(false);
      expect(options.body).toContain('owned-model');
      expect(options.body).not.toContain('PRIVATE_PROMPT_NEVER_SEND');
      expect(options.body).not.toContain('PRIVATE_RESPONSE_NEVER_SEND');
      expect(options.body).not.toContain('OTHER_TENANT_NEVER_SEND');
      expect(options.body).not.toContain('ask-upstream-private');
      expect(JSON.parse(payload.input).project_context.stats.requests).toBe(1);
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'There is one request.' }, { type: 'output_text', text: ' Pricing is unavailable.' }] }], usage: { input_tokens: 50, output_tokens: 10, input_tokens_details: { cached_tokens: 20 } } }), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', network);
    const response = await request('/api/ask', { method: 'POST', cookie: one.cookie, headers: { authorization: 'Bearer ask-upstream-private' }, body: { project_id: one.project.id, provider: 'openai', model: 'user-selected-model', question: 'Analyze traffic.' } });
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.method).toBe('llm');
    expect(result.provider_called).toBe(true);
    expect(result.answer).toBe('There is one request. Pricing is unavailable.');
    expect(result.sources.some((source: any) => source.project_id === one.project.id)).toBe(true);
    const assistant = db.raw.prepare("SELECT * FROM traces WHERE source='assistant'").get() as any;
    expect(assistant.project_id).toBe(one.project.id);
    expect(assistant.input_tokens).toBe(50);
    expect(assistant.token_basis).toBe('provider');
    expect(assistant.cost_usd).toBeNull();
    expect(JSON.stringify(assistant)).not.toContain('ask-upstream-private');
    expect(JSON.stringify(db.raw.prepare('SELECT details_json FROM audit_log').all())).not.toContain('ask-upstream-private');
  });
  it('uses the Anthropic Messages endpoint and extracts text blocks with real usage', async () => {
    const account = await register();
    vi.stubGlobal('fetch', async (url: string, options: any) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(options.headers.get('x-api-key')).toBe('anthropic-private');
      expect(options.headers.get('anthropic-version')).toBe('2023-06-01');
      const payload = JSON.parse(options.body);
      expect(payload.model).toBe('exact-user-model');
      expect(payload.max_tokens).toBeGreaterThan(0);
      expect(payload.system).toContain('project');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'No traffic yet.' }], usage: { input_tokens: 25, output_tokens: 5, cache_read_input_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
    });
    const response = await request('/api/ask', { method: 'POST', cookie: account.cookie, headers: { authorization: 'Bearer anthropic-private' }, body: { project_id: account.project.id, provider: 'anthropic', model: 'exact-user-model', question: 'What can you see?' } });
    expect(response.status).toBe(200);
    expect((await response.json() as any).answer).toBe('No traffic yet.');
    const trace = db.raw.prepare("SELECT * FROM traces WHERE source='assistant'").get() as any;
    expect(trace.input_tokens).toBe(35);
    expect(trace.output_tokens).toBe(5);
    expect(trace.cost_usd).toBeNull();
  });
  it('requires cookie ownership, same-origin, an allowed provider and an explicit model before calling', async () => {
    const one = await register(), two = await register('two@example.test');
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const body = { project_id: one.project.id, question: 'Analyze', provider: 'openai', model: 'chosen' };
    expect((await request('/api/ask', { method: 'POST', cookie: two.cookie, headers: { authorization: 'Bearer private' }, body })).status).toBe(404);
    expect((await request('/api/ask', { method: 'POST', cookie: one.cookie, headers: { authorization: 'Bearer private', origin: 'https://evil.test' }, body })).status).toBe(403);
    expect((await request('/api/ask', { method: 'POST', cookie: one.cookie, headers: { authorization: 'Bearer private' }, body: { ...body, model: '' } })).status).toBe(400);
    expect((await request('/api/ask', { method: 'POST', cookie: one.cookie, headers: { authorization: 'Bearer private' }, body: { ...body, provider: 'custom-host' } })).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
    const rules = await (await request('/api/ask', { method: 'POST', cookie: one.cookie, body: { project_id: one.project.id, question: 'How many requests?' } })).json() as any;
    expect(rules.method).toBe('rules');
    expect(rules.provider_called).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
  it.each([[401, 401], [429, 429], [400, 502], [500, 502]])('returns provider HTTP %i as an explicit %i rather than a fabricated answer', async (upstreamStatus, expectedStatus) => {
    const account = await register();
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"Echoed private-provider-secret"}}', { status: upstreamStatus, headers: { 'content-type': 'application/json' } }));
    const response = await request('/api/ask', { method: 'POST', cookie: account.cookie, headers: { authorization: 'Bearer private-provider-secret' }, body: { project_id: account.project.id, provider: 'openai', model: 'selected', question: 'Analyze' } });
    expect(response.status).toBe(expectedStatus);
    const result = await response.json() as any;
    expect(result.error).toBeTruthy();
    expect(result.answer).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private-provider-secret');
    expect(JSON.stringify(db.raw.prepare("SELECT * FROM traces WHERE source='assistant'").all())).not.toContain('private-provider-secret');
  });
  it('returns an explicit error on network failure without leaking exception text', async () => {
    const account = await register();
    vi.stubGlobal('fetch', async () => { throw new Error('transport exception private-provider-secret'); });
    const response = await request('/api/ask', { method: 'POST', cookie: account.cookie, headers: { authorization: 'Bearer private-provider-secret' }, body: { project_id: account.project.id, provider: 'openai', model: 'selected', question: 'Analyze' } });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private-provider-secret');
  });
  it('does not turn a successful HTTP response with no answer into an AI success', async () => {
    const account = await register();
    vi.stubGlobal('fetch', async () => new Response('{"status":"completed","output":[{"type":"reasoning","summary":[]}]}', { headers: { 'content-type': 'application/json' } }));
    const response = await request('/api/ask', { method: 'POST', cookie: account.cookie, headers: { authorization: 'Bearer private-provider-secret' }, body: { project_id: account.project.id, provider: 'openai', model: 'selected', question: 'Analyze' } });
    expect(response.status).toBe(502);
    expect((await response.json() as any).answer).toBeUndefined();
  });
});

describe('scheduled retention', () => {
  it('uses each workspace retention window rather than deleting another tenant records', async () => {
    const one = await register(), two = await register('two@example.test');
    await request('/api/workspace', { method: 'PATCH', cookie: two.cookie, body: { retention_days: 90 } });
    const old = new Date(Date.now() - 60 * 86400_000).toISOString();
    for (const account of [one, two]) await request('/api/traces/import', { method: 'POST', cookie: account.cookie, body: { project_id: account.project.id, records: [{ model: 'old', created_at: old }] } });
    await scheduled({}, env, { waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM traces WHERE project_id=?').get(one.project.id) as any).count).toBe(0);
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM traces WHERE project_id=?').get(two.project.id) as any).count).toBe(1);
  });
});

describe('gateway flow with a synthetic upstream, without real provider charges', () => {
  it.each(['/v1/responses', '/v1/chat/completions', '/v1/messages'])('blocks redirects from %s without following or returning Location or error-body secrets', async path => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    const network = vi.fn(async (_url: unknown, options: RequestInit) => {
      if (options.redirect === 'error') throw new TypeError('Invalid redirect value in Workers');
      return new Response('private-provider-secret', { status: 307, headers: { location: 'https://untrusted.example.test/capture' } });
    });
    vi.stubGlobal('fetch', network);
    const response = await request(path, { method: 'POST', key: key.key, headers: { authorization: 'Bearer private-provider-secret' }, body: { model: 'selected', input: 'test' } });
    expect(network).toHaveBeenCalledTimes(1); expect(network.mock.calls[0][1].redirect).toBe('manual');
    expect(response.status).toBe(502); expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).not.toContain('private-provider-secret');
    const trace = db.raw.prepare("SELECT * FROM traces WHERE source='gateway'").get() as any;
    expect(trace.status).toBe('error'); expect(trace.http_status).toBe(307); expect(trace.token_basis).toBe('unavailable');
    expect(JSON.stringify(trace)).not.toContain('private-provider-secret'); expect(JSON.stringify(trace)).not.toContain('untrusted.example.test');
  });
  it('rejects provider credentials in a model name before forwarding or storing trace metadata', async () => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    const network = vi.fn(async () => new Response('{"error":{"message":"Invalid model"}}', { status: 400, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', network);
    for (const path of ['/v1/responses', '/v1/chat/completions', '/v1/messages']) {
      const response = await request(path, { method: 'POST', key: key.key, headers: { authorization: 'Bearer provider-private-dummy' }, body: { model: 'prefix-provider-private-dummy', input: 'test' } });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('provider-private-dummy');
    }
    expect(network).not.toHaveBeenCalled();
    expect((db.raw.prepare('SELECT COUNT(*) AS count FROM traces').get() as any).count).toBe(0);
  });
  it('preserves SSE response bytes, meters provider usage and never persists provider credentials', async () => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    const sse = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":40}}}\n\ndata: [DONE]\n\n';
    const network = vi.fn(async (url: string, options: any) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options.headers.get('authorization')).toBe('Bearer upstream-private');
      expect(options.headers.has('x-traqiva-key')).toBe(false);
      expect(options.headers.has('cookie')).toBe(false);
      return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', network);
    const response = await request('/v1/chat/completions', { method: 'POST', key: key.key, headers: { authorization: 'Bearer upstream-private', 'x-traqiva-price-input': '1', 'x-traqiva-price-output': '2', 'x-traqiva-price-cached': '0.5' }, body: { model: 'unknown-model', stream: true, messages: [{ role: 'user', content: 'Hi' }] } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(sse);
    await Promise.all(pending);
    const trace = db.raw.prepare('SELECT * FROM traces').get() as any;
    expect(trace.input_tokens).toBe(100);
    expect(trace.output_tokens).toBe(8);
    expect(trace.cached_tokens).toBe(40);
    expect(trace.token_basis).toBe('provider');
    expect(trace.id).toBe(response.headers.get('x-traqiva-request-id'));
    expect(trace.cost_usd).toBeCloseTo(0.000096);
    expect(trace.saved_tokens).toBeNull();
    expect(JSON.stringify(trace)).not.toContain('upstream-private');
  });
  it('keeps request JSON numeric lexemes unchanged and redacts an echoed provider secret only from telemetry', async () => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    const raw = '{ "model":"unknown", "input":[9007199254740993,1e10] }';
    vi.stubGlobal('fetch', async (_url: string, options: any) => {
      expect(options.body).toBe(raw);
      return new Response('{"error":{"message":"Bearer upstream-private"}}', { status: 400, headers: { 'content-type': 'application/json' } });
    });
    const response = await app.fetch(new Request('https://app.test/v1/responses', { method: 'POST', headers: { authorization: 'Bearer upstream-private', 'x-traqiva-key': key.key, 'content-type': 'application/json' }, body: raw }), env, { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException() {}, props: {} });
    expect(await response.text()).toContain('upstream-private');
    await Promise.all(pending);
    expect(JSON.stringify(db.raw.prepare('SELECT * FROM traces').get())).not.toContain('upstream-private');
  });
  it('records upstream error status without inventing token usage or prices', async () => {
    const account = await register(), key = await keyFor(account.cookie, account.project.id);
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"Invalid key"}}', { status: 401, headers: { 'content-type': 'application/json' } }));
    const response = await request('/v1/responses', { method: 'POST', key: key.key, headers: { authorization: 'Bearer bad-key' }, body: { model: 'unknown', input: 'hello' } });
    expect(response.status).toBe(401);
    expect((await response.json() as any).error.message).toBe('Invalid key');
    await Promise.all(pending);
    const trace = db.raw.prepare('SELECT * FROM traces').get() as any;
    expect(trace.status).toBe('error');
    expect(trace.http_status).toBe(401);
    expect(trace.input_tokens).toBeNull();
    expect(trace.cost_usd).toBeNull();
    expect(trace.token_basis).toBe('unavailable');
  });
});
