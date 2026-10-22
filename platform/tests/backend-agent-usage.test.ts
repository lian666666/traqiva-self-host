import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../server/index';
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
let db: SqliteDatabase, env: Env;
const at = '2026-10-22T12:34:56.000Z';
async function request(path: string, cookie = '', body?: unknown) {
  return app.fetch(new Request('https://app.test' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}
async function register(email = 'usage@example.test', accepted = true) {
  const response = await request('/api/auth/register', '', { email, name: 'Usage Tester', password: 'A sufficiently long synthetic password' });
  expect(response.status).toBe(201);
  const cookie = response.headers.get('set-cookie')!.split(';')[0], data = await response.json() as any;
  if (accepted) expect((await request('/api/consent', cookie, { version: '2026-10-20.1', accepted: true })).status).toBe(200);
  return { cookie, project: data.activeProject };
}
function trace(projectId: string, options: { id?: string; request?: unknown; raw?: string; source?: string; created_at?: string; input?: number | null; output?: number | null; cached?: number | null; cost?: number | null; basis?: string; costBasis?: string } = {}) {
  const input = options.input ?? null, output = options.output ?? null;
  db.raw.prepare('INSERT INTO traces(id,project_id,model,provider,status,created_at,source,token_basis,input_tokens,output_tokens,cached_tokens,cost_usd,cost_basis,request_json,response_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(options.id ?? randomUUID(), projectId, 'codex-provider-model-is-not-agent-evidence', 'anthropic', 'success', options.created_at ?? at, options.source ?? 'sdk', options.basis ?? (input === null || output === null ? 'unavailable' : 'provider'), input, output, options.cached ?? null, options.cost ?? null, options.costBasis ?? 'client_reported', options.raw ?? JSON.stringify(options.request ?? {}), '{"private_response":"never-return-this"}');
}
const usage = (projectId: string, cookie: string, suffix = '') => request('/api/developers/usage?project=' + projectId + suffix, cookie);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at)); db = new SqliteDatabase(); env = { DB: db }; });
afterEach(() => { db.raw.close(); vi.useRealTimers(); });

describe('Agent usage from explicit project request metadata', () => {
  it('returns an empty authenticated window with unknown price and token metrics', async () => {
    const a = await register(), response = await usage(a.project.id, a.cookie);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ agents: [], work_types: [], summary: { requests: 0, coding_agents: 0, unattributed_requests: 0, input_tokens: null, output_tokens: null, cached_tokens: null, priced_cost_usd: null, cost_per_request_usd: null }, range: { from: '2026-09-23T00:00:00.000Z', to: at }, truncated: false, limit: 200 });
  });
  it('enforces sign-in, project membership, terms, project input and supported days', async () => {
    const a = await register(), b = await register('other@example.test'), pending = await register('pending@example.test', false);
    expect((await usage(a.project.id, '')).status).toBe(401);
    expect((await usage(a.project.id, b.cookie)).status).toBe(404);
    expect((await usage(pending.project.id, pending.cookie)).status).toBe(428);
    expect((await request('/api/developers/usage', a.cookie)).status).toBe(400);
    expect((await usage(a.project.id, a.cookie, '&days=8')).status).toBe(400);
  });
  it('groups only explicit client reports and never infers agent or work type from a model or provider', async () => {
    const a = await register();
    trace(a.project.id, { request: { metadata: { traqiva_agent: 'codex', traqiva_work_type: 'review' }, messages: [{ content: 'private-prompt-never-return' }] }, input: 100, output: 20, cached: 25, cost: .1 });
    trace(a.project.id, { request: { coding_agent: 'Codex', work_type: 'review' }, source: 'gateway', input: 50, output: 10, cached: 0, cost: 0 });
    trace(a.project.id, { request: { metadata: { coding_agent: 'Claude Code', work_type: 'coding' } }, source: 'native_proxy', input: 20, output: 5, cached: 10, cost: .2, costBasis: 'user_price_estimate' });
    trace(a.project.id, { request: { user_agent: 'Cursor', agent: 'Windsurf' }, input: 10, output: 1, cached: 0 });
    const result = await (await usage(a.project.id, a.cookie)).json() as any;
    expect(result.summary).toMatchObject({ requests: 4, coding_agents: 2, attributed_requests: 3, unattributed_requests: 1, provider_requests: 4, input_tokens: 180, output_tokens: 36, cached_tokens: 35, priced_requests: 3, estimated_price_requests: 1, reported_price_requests: 2, cost_per_request_usd: null });
    expect(result.summary.priced_cost_usd).toBeCloseTo(.3);
    expect(result.agents.find((group: any) => group.agent === 'Codex')).toMatchObject({ requests: 2, input_tokens: 150, output_tokens: 30, cached_tokens: 25, priced_cost_usd: .1, cost_per_request_usd: .05 });
    expect(result.agents.find((group: any) => group.agent === null)).toMatchObject({ requests: 1 });
    expect(result.work_types.find((group: any) => group.work_type === 'review')).toMatchObject({ requests: 2, cache_requests: 2, cache_input_tokens: 150, cached_tokens: 25 });
    expect(result.work_types.find((group: any) => group.work_type === 'review').cache_read_percent).toBeCloseTo(100 / 6);
    const serialized = JSON.stringify(result);
    for (const privateValue of ['private-prompt', 'private_response', 'request_json', 'response_json', 'codex-provider-model-is-not-agent-evidence', 'anthropic', 'Cursor', 'Windsurf']) expect(serialized).not.toContain(privateValue);
  });
  it('accepts the explicit contract through real SDK ingestion', async () => {
    const a = await register();
    expect((await request('/api/ingest', a.cookie, { project_id: a.project.id, records: [{ model: 'synthetic-model', token_basis: 'provider', input_tokens: 12, output_tokens: 2, cached_tokens: 0, request: { metadata: { traqiva_agent: 'Cursor', traqiva_work_type: 'edit' } } }] })).status).toBe(201);
    const result = await (await usage(a.project.id, a.cookie)).json() as any;
    expect(result.agents).toHaveLength(1); expect(result.agents[0]).toMatchObject({ agent: 'Cursor', requests: 1, input_tokens: 12 });
  });
  it('treats object property names as client labels rather than inherited alias values', async () => {
    const a = await register();
    trace(a.project.id, { request: { coding_agent: 'constructor' } });
    const response = await usage(a.project.id, a.cookie);
    expect(response.status).toBe(200);
    expect((await response.json() as any).agents[0]).toMatchObject({ agent: 'constructor', requests: 1 });
  });
  it('counts estimated and unavailable traffic without representing it as provider-measured tokens or missing cache as zero', async () => {
    const a = await register();
    trace(a.project.id, { request: { coding_agent: 'Codex' }, input: 100, output: 10, cached: 50 });
    trace(a.project.id, { request: { coding_agent: 'Codex' }, input: 200, output: 20, cached: 100, basis: 'estimated' });
    trace(a.project.id, { request: { coding_agent: 'Codex' } });
    trace(a.project.id, { request: { coding_agent: 'Codex' }, input: 30, output: 3 });
    const result = await (await usage(a.project.id, a.cookie)).json() as any;
    expect(result.summary).toMatchObject({ requests: 4, provider_requests: 2, estimated_requests: 1, unavailable_requests: 1, input_tokens: 130, output_tokens: 13, cached_tokens: 50, cache_requests: 1, cache_input_tokens: 100, cache_read_percent: 50, priced_cost_usd: null, cost_per_request_usd: null });
  });
  it('keeps malformed, unsafe and conflicting labels unattributed and excludes manual/assistant/compression events', async () => {
    const a = await register();
    for (const request of [{}, { coding_agent: 3 }, { coding_agent: 'sk-private-token' }, { coding_agent: 'a'.repeat(65) }, { coding_agent: 'bad\nlabel' }, { coding_agent: 'C:\\Users\\private' }, { coding_agent: 'Codex', metadata: { traqiva_agent: 'Cursor' } }, { coding_agent: 'Unattributed' }, null, []]) trace(a.project.id, { request });
    trace(a.project.id, { raw: '{malformed' });
    trace(a.project.id, { source: 'import', request: { coding_agent: 'manual' } });
    trace(a.project.id, { source: 'assistant', request: { coding_agent: 'assistant' } });
    const result = await (await usage(a.project.id, a.cookie)).json() as any;
    expect(result.summary).toMatchObject({ requests: 11, coding_agents: 0, unattributed_requests: 11 });
    expect(result.agents).toHaveLength(1); expect(result.agents[0].agent).toBeNull();
  });
  it('applies UTC windows, excludes future/invalid timestamps, and keeps a maximum of 200 requests explicit', async () => {
    const a = await register(), b = await register('unrelated@example.test');
    trace(a.project.id, { created_at: '2026-10-16T00:00:00.000Z', request: { coding_agent: 'boundary' } });
    trace(a.project.id, { created_at: '2026-10-01T00:00:00.000Z', request: { coding_agent: 'month' } });
    trace(a.project.id, { created_at: '2026-08-01T00:00:00.000Z', request: { coding_agent: 'quarter' } });
    for (const created_at of ['2026-10-22T12:34:56.001Z', '2026-10-21-not-a-date']) trace(a.project.id, { created_at });
    expect((await (await usage(a.project.id, a.cookie, '&days=7')).json() as any).summary.requests).toBe(1);
    expect((await (await usage(a.project.id, a.cookie, '&days=30')).json() as any).summary.requests).toBe(2);
    expect((await (await usage(a.project.id, a.cookie, '&days=90')).json() as any).summary.requests).toBe(3);
    for (let index = 0; index < 201; index++) trace(a.project.id, { id: 'bulk-' + index, created_at: new Date(Date.parse(at) - index).toISOString(), request: { coding_agent: 'Codex' }, input: 1, output: 0, cached: 0, cost: 0 });
    trace(b.project.id, { request: { coding_agent: 'Other tenant' } });
    const result = await (await usage(a.project.id, a.cookie, '&days=7')).json() as any;
    expect(result).toMatchObject({ limit: 200, truncated: true, summary: { requests: 200, input_tokens: 200, output_tokens: 0, cached_tokens: 0, priced_cost_usd: 0, cost_per_request_usd: 0 } });
    expect(result.agents).toHaveLength(1); expect(result.agents[0].agent).toBe('Codex');
  });
});
