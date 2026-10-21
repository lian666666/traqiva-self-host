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
const at = '2026-10-21T12:34:56.000Z';
async function request(path: string, cookie = '', body?: unknown) {
  return app.fetch(new Request('https://app.test' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}
async function register(email = 'sessions@example.test', accepted = true) {
  const response = await request('/api/auth/register', '', { email, name: 'Sessions Tester', password: 'A sufficiently long synthetic password' });
  expect(response.status).toBe(201);
  const cookie = response.headers.get('set-cookie')!.split(';')[0], data = await response.json() as any;
  if (accepted) expect((await request('/api/consent', cookie, { version: '2026-10-20.1', accepted: true })).status).toBe(200);
  return { cookie, project: data.activeProject };
}
function trace(projectId: string, options: { id?: string; request?: unknown; raw?: string; source?: string; created_at?: string; model?: string; input?: number | null; output?: number | null; cached?: number | null; cost?: number | null; basis?: string } = {}) {
  const id = options.id ?? randomUUID(), input = options.input ?? null, output = options.output ?? null;
  db.raw.prepare('INSERT INTO traces(id,project_id,model,provider,status,created_at,source,token_basis,input_tokens,output_tokens,cached_tokens,cost_usd,request_json,response_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, projectId, options.model ?? 'model-a', 'openai', 'success', options.created_at ?? at, options.source ?? 'sdk', options.basis ?? (input === null || output === null ? 'unavailable' : 'provider'), input, output, options.cached ?? null, options.cost ?? null, options.raw ?? JSON.stringify(options.request ?? {}), '{"private_response":"never-return-this"}');
  return id;
}
const sessions = (projectId: string, cookie: string, suffix = '') => request('/api/developer-sessions?project=' + projectId + suffix, cookie);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at)); db = new SqliteDatabase(); env = { DB: db }; });
afterEach(() => { db.raw.close(); vi.useRealTimers(); });

describe('explicit developer sessions from bounded project request metadata', () => {
  it('returns an empty authenticated result without inventing sessions or counts', async () => {
    const account = await register(), response = await sessions(account.project.id, account.cookie);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ items: [], range: { from: '2026-09-22T00:00:00.000Z', to: at }, truncated: false });
  });
  it('requires membership and current workspace terms before reading request metadata', async () => {
    const a = await register(), b = await register('other@example.test'), pending = await register('pending@example.test', false);
    expect((await sessions(a.project.id, '')).status).toBe(401);
    expect((await sessions(a.project.id, b.cookie)).status).toBe(404);
    expect((await sessions(pending.project.id, pending.cookie)).status).toBe(428);
    expect((await request('/api/developer-sessions', a.cookie)).status).toBe(400);
  });
  it('reads explicit metadata supplied through existing SDK ingestion without requiring new storage or changes to trace import', async () => {
    const a = await register();
    const response = await request('/api/ingest', a.cookie, { project_id: a.project.id, records: [{ model: 'sdk-model', token_basis: 'provider', input_tokens: 12, output_tokens: 2, cached_tokens: 0, request: { metadata: { traqiva_session_id: 'sdk-session', repository: 'example/sdk' }, messages: [{ role: 'user', content: 'private-only-fixture-content' }] } }] });
    expect(response.status).toBe(201);
    const result = await (await sessions(a.project.id, a.cookie)).json() as any;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'sdk-session', repository: 'example/sdk', models: ['sdk-model'], requests: 1, input_tokens: 12, output_tokens: 2, cached_tokens: 0 });
    expect(JSON.stringify(result)).not.toContain('private-only-fixture-content');
  });
  it('groups explicit IDs across supported paths with real models, times, complete token totals and priced coverage', async () => {
    const a = await register();
    const oldest = trace(a.project.id, { request: { session_id: 'session-a', metadata: { repository: 'example/radar' }, messages: [{ content: 'private-prompt-never-return-this' }] }, created_at: '2026-10-20T11:00:00.000Z', model: 'model-b', input: 100, output: 10, cached: 20, cost: 0.01 });
    const newest = trace(a.project.id, { request: { metadata: { traqiva_session_id: 'session-a', repository: 'example/radar' } }, source: 'gateway', model: 'model-a', input: 50, output: 5, cached: 0, cost: 0 });
    trace(a.project.id, { request: { metadata: { session_id: 'session-b' } }, source: 'native_proxy', created_at: '2026-10-20T09:00:00.000Z', input: 0, output: 0, cached: 0, cost: 0 });
    const result = await (await sessions(a.project.id, a.cookie)).json() as any;
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: 'session-a', repository: 'example/radar', models: ['model-a', 'model-b'], started_at: '2026-10-20T11:00:00.000Z', last_at: at, requests: 2, input_tokens: 150, output_tokens: 15, cached_tokens: 20, priced_cost_usd: 0.01, priced_requests: 2, trace_ids: [newest, oldest] });
    expect(result.items[1]).toMatchObject({ id: 'session-b', repository: null, requests: 1, input_tokens: 0, output_tokens: 0, cached_tokens: 0, priced_cost_usd: 0, priced_requests: 1 });
    expect(JSON.stringify(result)).not.toContain('private-prompt'); expect(JSON.stringify(result)).not.toContain('private_response');
    expect(result.items[0]).not.toHaveProperty('request_json'); expect(result.items[0]).not.toHaveProperty('response_json');
  });
  it('does not convert unknown measurements to zero or complete totals; cost remains an explicitly covered subtotal', async () => {
    const a = await register();
    trace(a.project.id, { request: { session_id: 'partial' }, input: 100, output: 5, cached: 2, cost: 0.05 });
    trace(a.project.id, { request: { session_id: 'partial' }, input: null, output: null, cached: null, cost: null });
    trace(a.project.id, { request: { session_id: 'no-cache' }, input: 20, output: 3 });
    const result = await (await sessions(a.project.id, a.cookie)).json() as any;
    expect(result.items.find((item: any) => item.id === 'partial')).toMatchObject({ requests: 2, input_tokens: null, output_tokens: null, cached_tokens: null, priced_cost_usd: 0.05, priced_requests: 1 });
    expect(result.items.find((item: any) => item.id === 'no-cache')).toMatchObject({ input_tokens: 20, output_tokens: 3, cached_tokens: null, priced_cost_usd: null, priced_requests: 0 });
  });
  it('does not present estimated-only or mixed estimated/provider session tokens as provider measurements', async () => {
    const a = await register();
    trace(a.project.id, { request: { session_id: 'mixed' }, basis: 'provider', input: 100, output: 10, cached: 50 });
    trace(a.project.id, { request: { session_id: 'mixed' }, basis: 'estimated', input: 200, output: 20, cached: 100 });
    trace(a.project.id, { request: { session_id: 'estimated-only' }, basis: 'estimated', input: 40, output: 4, cached: 0 });
    const ingested = await request('/api/ingest', a.cookie, { project_id: a.project.id, records: [{ model: 'sdk-model', input_tokens: 12, output_tokens: 2, cached_tokens: 0, request: { session_id: 'sdk-default-estimate' } }] });
    expect(ingested.status).toBe(201);
    const result = await (await sessions(a.project.id, a.cookie)).json() as any;
    expect(result.items.find((item: any) => item.id === 'mixed')).toMatchObject({ requests: 2, input_tokens: null, output_tokens: null, cached_tokens: null });
    expect(result.items.find((item: any) => item.id === 'estimated-only')).toMatchObject({ requests: 1, input_tokens: null, output_tokens: null, cached_tokens: null });
    expect(result.items.find((item: any) => item.id === 'sdk-default-estimate')).toMatchObject({ requests: 1, input_tokens: null, output_tokens: null, cached_tokens: null });
  });
  it('ignores absent/unsafe IDs, malformed JSON, manual imports and assistant events instead of inventing sessions', async () => {
    const a = await register();
    for (const request of [{}, { session_id: '' }, { session_id: 123 }, { session_id: 'a'.repeat(129) }, { session_id: 'bad\nvalue' }, { session_id: 'tq_' + 'a'.repeat(32) }, [], null]) trace(a.project.id, { request });
    trace(a.project.id, { raw: '{not-json' });
    trace(a.project.id, { source: 'import', request: { session_id: 'manual' } });
    trace(a.project.id, { source: 'assistant', request: { session_id: 'assistant' } });
    expect((await request('/api/compression-events', a.cookie, { project_id: a.project.id, algorithm: 'synthetic', source: 'native', input_bytes: 100, output_bytes: 50, original_tokens_estimate: 25, optimized_tokens_estimate: 10 })).status).toBe(201);
    expect((await (await sessions(a.project.id, a.cookie)).json() as any).items).toEqual([]);
  });
  it('uses only explicit repository labels, reports conflicting/credential/path values as unknown and prioritizes explicit IDs', async () => {
    const a = await register();
    trace(a.project.id, { request: { session_id: 'primary', metadata: { traqiva_session_id: 'not-primary', session_id: 'also-not-primary', repository: 'one/repo' } } });
    trace(a.project.id, { request: { session_id: 'primary', repository: 'other/repo' } });
    trace(a.project.id, { request: { session_id: 'no-private-path', metadata: { repository: 'C:\\Users\\somebody\\private' } } });
    const result = await (await sessions(a.project.id, a.cookie)).json() as any;
    expect(result.items.map((item: any) => item.id).sort()).toEqual(['no-private-path', 'primary']);
    expect(result.items.every((item: any) => item.repository === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('somebody');
  });
  it('applies exact supported UTC windows and excludes future, out-of-window and malformed timestamps', async () => {
    const a = await register();
    trace(a.project.id, { request: { session_id: 'this-week' }, created_at: '2026-10-15T00:00:00.000Z' });
    trace(a.project.id, { request: { session_id: 'this-month' }, created_at: '2026-10-10T00:00:00.000Z' });
    trace(a.project.id, { request: { session_id: 'older' }, created_at: '2026-08-01T00:00:00.000Z' });
    for (const created_at of ['2026-10-21T12:34:56.001Z', '2026-10-22T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-10-20-not-a-date']) trace(a.project.id, { request: { session_id: 'excluded-' + randomUUID() }, created_at });
    const seven = await (await sessions(a.project.id, a.cookie, '&days=7')).json() as any;
    expect(seven.range).toEqual({ from: '2026-10-15T00:00:00.000Z', to: at }); expect(seven.items.map((item: any) => item.id)).toEqual(['this-week']);
    expect((await (await sessions(a.project.id, a.cookie)).json() as any).items.map((item: any) => item.id)).toEqual(['this-week', 'this-month']);
    expect((await (await sessions(a.project.id, a.cookie, '&days=90')).json() as any).items.map((item: any) => item.id)).toEqual(['this-week', 'this-month', 'older']);
    expect((await sessions(a.project.id, a.cookie, '&days=8')).status).toBe(400);
  });
  it('bounds aggregation to the latest 200 candidate requests and reports a partial window without counting other tenants', async () => {
    const a = await register(), b = await register('unrelated@example.test');
    for (let index = 0; index < 201; index++) trace(a.project.id, { id: 'bulk-' + index, request: { session_id: 'bulk' }, created_at: new Date(Date.parse('2026-10-21T10:00:00.000Z') + index).toISOString(), input: 1, output: 0, cached: 0 });
    trace(b.project.id, { request: { session_id: 'unrelated' } });
    const body = await (await sessions(a.project.id, a.cookie)).json() as any;
    expect(body.truncated).toBe(true); expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ requests: 200, input_tokens: 200, output_tokens: 0, cached_tokens: 0 });
    expect(body.items[0].trace_ids).toHaveLength(200); expect(body.items[0].trace_ids).not.toContain('bulk-0');
    db.raw.prepare("DELETE FROM traces WHERE id='bulk-0'").run();
    expect((await (await sessions(a.project.id, a.cookie)).json() as any).truncated).toBe(false);
  });
});
