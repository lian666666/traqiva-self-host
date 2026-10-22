import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, analyzeProject } from '../server/index';
import { reserveAiAllowance, settleAiAllowance } from '../server/ai-allowance';
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
async function register(email = 'workspace-usage@example.invalid', accepted = true) {
  const response = await request('/api/auth/register', '', { email, name: 'Usage Tester', password: 'A sufficiently long synthetic password' });
  expect(response.status).toBe(201);
  const cookie = response.headers.get('set-cookie')!.split(';')[0], data = await response.json() as any;
  if (accepted) expect((await request('/api/consent', cookie, { version: '2026-10-20.1', accepted: true })).status).toBe(200);
  return { cookie, project: data.activeProject, user: data.user };
}
function trace(projectId: string, source: string, options: { date?: string; cost?: number; status?: 'success' | 'error'; input?: number; model?: string; routing?: unknown; routingRaw?: string; request?: unknown } = {}) {
  const id = randomUUID();
  db.raw.prepare('INSERT INTO traces(id,project_id,model,provider,status,created_at,source,token_basis,input_tokens,output_tokens,cached_tokens,cost_usd,cost_basis,latency_ms,request_json,routing_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, projectId, options.model ?? source + '-model', 'openai', options.status ?? 'success', options.date ?? at, source, 'provider', options.input ?? 100, 20, 10, options.cost ?? .01, 'client_reported', 60_000, JSON.stringify(options.request ?? {}), options.routingRaw ?? (options.routing === undefined ? null : JSON.stringify(options.routing)));
  return id;
}
const usage = (projectId: string, cookie: string) => request('/api/workspace/usage?project=' + projectId, cookie);
const decision = { requested_model: 'traqiva-auto', selected_model: 'test-small', tier: 'small', reasoning_effort: 'low', reason: 'short_request', method: 'rules_v1', quality_verified: false };
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at)); db = new SqliteDatabase(); env = { DB: db }; });
afterEach(() => { db.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('project traffic is independent from Traqiva AI accounting', () => {
  it('excludes hosted and BYOK assistant audits from all project traffic aggregates, traces and evidence', async () => {
    const a = await register();
    const external = ['sdk', 'gateway', 'native_proxy', 'import'].map(source => trace(a.project.id, source));
    const assistant = trace(a.project.id, 'assistant', { cost: 50, input: 90000, status: 'error', model: 'private-assistant-model' });
    const result = await (await request('/api/overview?project=' + a.project.id, a.cookie)).json() as any;
    expect(result.stats).toMatchObject({ requests: 4, input_tokens: 400, output_tokens: 80, cached_tokens: 40, errors: 0, priced_requests: 4, estimated_cost_usd: .04 });
    expect(result.series.reduce((n: number, row: any) => n + row.requests, 0)).toBe(4);
    expect(result.models.map((row: any) => row.model)).not.toContain('private-assistant-model');
    expect(result.traces.map((row: any) => row.id).sort()).toEqual(external.sort());
    const list = await (await request('/api/traces?project=' + a.project.id, a.cookie)).json() as any;
    expect(list.items.map((row: any) => row.id).sort()).toEqual(external.sort());
    expect((await request('/api/traces?project=' + a.project.id + '&search=private-assistant-model', a.cookie)).status).toBe(200);
    const answer = await (await request('/api/ask', a.cookie, { mode: 'statistics', project_id: a.project.id, question: 'How many requests?', days: 30 })).json() as any;
    expect(answer.answer).toContain('4 requests');
    expect(JSON.stringify(answer.sources)).not.toContain(assistant);
    expect(db.raw.prepare('SELECT count(*) AS n FROM traces WHERE id=?').get(assistant)).toEqual({ n: 1 });
  });
  it('keeps an assistant-only project empty and does not infer agent connection or waste from Ask calls', async () => {
    const a = await register();
    for (let index = 0; index < 5; index++) trace(a.project.id, 'assistant', { status: 'error', input: 90000, request: { input: 'same lengthy prefix '.repeat(500) } });
    db.raw.prepare("UPDATE traces SET cost_usd=NULL WHERE source='assistant'").run();
    const data = await (await request('/api/overview?project=' + a.project.id, a.cookie)).json() as any;
    expect(data.stats).toMatchObject({ requests: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: null, errors: 0, priced_requests: 0 });
    expect(data.models).toEqual([]); expect(data.traces).toEqual([]);
    expect((await (await request('/api/traces?project=' + a.project.id, a.cookie)).json() as any).items).toEqual([]);
    expect(await analyzeProject(env, a.project.id)).toEqual([]);
    const answer = await (await request('/api/ask', a.cookie, { mode: 'statistics', project_id: a.project.id, question: 'How much spend?', days: 30 })).json() as any;
    expect(answer.answer).toContain('no recorded requests');
    expect(db.raw.prepare('SELECT count(*) AS n FROM traces').get()).toEqual({ n: 5 });
  });
  it('removes obsolete pending automatic findings after re-analysis but preserves reviewed findings', async () => {
    const a = await register();
    const external = trace(a.project.id, 'sdk', { status: 'error', input: 90000 });
    db.raw.prepare('UPDATE traces SET cost_usd=NULL WHERE id=?').run(external);
    expect((await analyzeProject(env, a.project.id)).map(row => row.kind).sort()).toEqual(['errors', 'large-context', 'pricing']);
    db.raw.prepare("UPDATE improvements SET status='accepted' WHERE project_id=? AND kind='errors'").run(a.project.id);
    db.raw.prepare("UPDATE traces SET source='assistant' WHERE id=?").run(external);
    const findings = await analyzeProject(env, a.project.id);
    expect(findings).toHaveLength(1); expect(findings[0]).toMatchObject({ kind: 'errors', status: 'accepted' });
  });
});

describe('workspace sidebar usage', () => {
  it('enforces authentication, project membership and terms without any provider calls', async () => {
    const a = await register(), b = await register('unrelated@example.invalid'), pending = await register('pending@example.invalid', false);
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    expect((await usage(a.project.id, '')).status).toBe(401);
    expect((await usage(a.project.id, b.cookie)).status).toBe(404);
    expect((await usage(pending.project.id, pending.cookie)).status).toBe(428);
    expect((await request('/api/workspace/usage', a.cookie)).status).toBe(400);
    const response = await usage(a.project.id, a.cookie);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ai: { available: false, allowance: { limit_usd: 1, used_usd: 0, reserved_usd: 0, remaining_usd: 1, reset: 'never' } }, observability: { events: 0, limit: 100000, enforced: false }, agent_runs: { minutes: null, limit: 600, enforced: false }, routing: { decisions: 0, limit: 25000, enforced: false }, range: { from: '2026-10-01T00:00:00.000Z', to: at }, plan_enforced: false });
    expect(network).not.toHaveBeenCalled();
  });
  it('counts persisted external records across this workspace in the current UTC calendar month only', async () => {
    const a = await register(), b = await register('other-workspace@example.invalid');
    const secondResponse = await request('/api/projects', a.cookie, { name: 'Second synthetic project' });
    const second = (await secondResponse.json() as any).project;
    for (const source of ['sdk', 'gateway', 'native_proxy', 'import']) trace(a.project.id, source, { date: '2026-10-01T00:00:00.000Z' });
    trace(second.id, 'sdk'); trace(a.project.id, 'assistant'); trace(b.project.id, 'gateway', { routing: decision });
    trace(a.project.id, 'sdk', { date: '2026-09-30T23:59:59.999Z' });
    trace(a.project.id, 'sdk', { date: '2026-10-22T12:34:56.001Z' });
    trace(a.project.id, 'sdk', { date: '2026-10-21-invalid-date' });
    const result = await (await usage(a.project.id, a.cookie)).json() as any;
    expect(result.observability).toEqual({ events: 5, limit: 100000, enforced: false });
    expect(result.agent_runs.minutes).toBeNull();
    expect((await (await usage(second.id, a.cookie)).json() as any).observability.events).toBe(5);
  });
  it('counts only valid server gateway Auto decision evidence, never raw requests or imported routing claims', async () => {
    const a = await register();
    trace(a.project.id, 'gateway', { routing: decision });
    trace(a.project.id, 'gateway', { routing: { ...decision, tier: 'reasoning', reason: 'tools_present', reasoning_effort: null } });
    trace(a.project.id, 'sdk', { routing: decision }); trace(a.project.id, 'assistant', { routing: decision }); trace(a.project.id, 'import', { routing: decision });
    for (const routing of [{}, [], true, { ...decision, method: 'random' }, { ...decision, requested_model: 'provider-model' }, { ...decision, selected_model: '' }, { ...decision, tier: 'other' }, { ...decision, quality_verified: true }, { ...decision, reason: '' }]) trace(a.project.id, 'gateway', { routing });
    trace(a.project.id, 'gateway', { routingRaw: '{invalid-json' });
    const result = await (await usage(a.project.id, a.cookie)).json() as any;
    expect(result.routing).toEqual({ decisions: 2, limit: 25000, enforced: false });
    expect(JSON.stringify(result)).not.toContain('routing_json');
  });
  it('uses the authenticated user lifetime allowance across projects while keeping other members balances private', async () => {
    const a = await register(), b = await register('member@example.invalid');
    const second = (await (await request('/api/projects', a.cookie, { name: 'Second project' })).json() as any).project;
    await reserveAiAllowance(db, { userId: a.user.id, requestId: 'measured', projectId: second.id, reservationNanos: 250_000_000 });
    await settleAiAllowance(db, { userId: a.user.id, requestId: 'measured', outcome: 'measured', actualNanos: 200_000_000 });
    await reserveAiAllowance(db, { userId: a.user.id, requestId: 'pending', projectId: a.project.id, reservationNanos: 100_000_000 });
    db.raw.prepare('INSERT INTO members(workspace_id,user_id,role) VALUES(?,?,?)').run(a.project.workspace_id, b.user.id, 'member');
    env.HOSTED_ASK_ENABLED = 'true'; env.HOSTED_OPENAI_API_KEY = 'synthetic-secret-never-return';
    const owner = await (await usage(second.id, a.cookie)).json() as any;
    expect(owner.ai).toMatchObject({ available: true, allowance: { used_usd: .2, reserved_usd: .1, remaining_usd: .7, reset: 'never' } });
    const member = await (await usage(a.project.id, b.cookie)).json() as any;
    expect(member.ai.allowance).toMatchObject({ used_usd: 0, reserved_usd: 0, remaining_usd: 1 });
    expect(JSON.stringify(owner)).not.toContain('synthetic-secret-never-return');
    db.raw.prepare("UPDATE sessions SET expires_at='2026-11-02T00:00:00.000Z'").run();
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
    const nextMonth = await (await usage(a.project.id, a.cookie)).json() as any;
    expect(nextMonth.ai.allowance.used_usd).toBe(.2); expect(nextMonth.range.from).toBe('2026-11-01T00:00:00.000Z');
  });
});
