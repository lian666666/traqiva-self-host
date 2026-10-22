import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../server/index';
import { getAiAllowance, reserveAiAllowance } from '../server/ai-allowance';
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
let db: SqliteDatabase, env: Env & { HOSTED_OPENAI_API_KEY?: string; HOSTED_ASK_ENABLED?: string }, pending: Promise<unknown>[];
const secret = 'hosted-private-key';
async function request(path: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ origin: 'https://app.test', ...options.headers });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  return app.fetch(new Request('https://app.test' + path, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }), env, { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException() {}, props: {} });
}
async function account(email = 'hosted-ask@example.invalid', consent = true) {
  const response = await request('/api/auth/register', { method: 'POST', body: { email, name: 'Synthetic Hosted Ask User', password: 'A sufficiently long synthetic test passphrase' } });
  expect(response.status).toBe(201);
  const data = await response.json() as any, cookie = response.headers.get('set-cookie')!.split(';')[0];
  if (consent) expect((await request('/api/consent', { method: 'POST', cookie, body: { version: '2026-10-20.1', accepted: true } })).status).toBe(200);
  return { cookie, project: data.activeProject, user: data.user };
}
type Account = Awaited<ReturnType<typeof account>>;
const ask = (a: Account, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) => request('/api/ask', { method: 'POST', cookie: a.cookie, headers, body: { mode: 'hosted', project_id: a.project.id, question: 'What does this project evidence show?', days: 30, ...body } });
const status = (a: Account) => request('/api/ask/status?project=' + a.project.id, { cookie: a.cookie });
const conversations = (a: Account) => request('/api/ask/conversations?project=' + a.project.id, { cookie: a.cookie });
const responseBody = () => ({ id: 'resp_synthetic_hosted', object: 'response', model: 'gpt-6-luna', service_tier: 'default', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'There are no recorded connected requests in this project window.' }] }], usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100, input_tokens_details: { cached_tokens: 0 } } });
function upstream(response: () => Promise<Response> | Response = () => Response.json(responseBody())) {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    expect(url.startsWith('https://api.openai.com/')).toBe(true);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + secret);
    if (url === 'https://api.openai.com/v1/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 1000 });
    expect(url).toBe('https://api.openai.com/v1/responses');
    return response();
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const completions = (fetch: ReturnType<typeof upstream>) => fetch.mock.calls.filter(([url]) => String(url) === 'https://api.openai.com/v1/responses');
beforeEach(() => { db = new SqliteDatabase(); env = { DB: db, HOSTED_OPENAI_API_KEY: secret, HOSTED_ASK_ENABLED: 'true' }; pending = []; });
afterEach(async () => { await Promise.allSettled(pending); db.raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('hosted Ask uses server-owned OpenAI access and a real user allowance', () => {
  it('reports an untouched one-dollar lifetime allowance without calling a provider', async () => {
    const a = await account(), fetch = upstream(), response = await status(a);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ hosted: { available: true, model: 'gpt-6-luna', label: 'GPT-6 Luna', allowance: { limit_usd: 1, used_usd: 0, reserved_usd: 0, remaining_usd: 1, reset: 'never', accounting: 'provider_usage_with_conservative_reservations' } } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls fixed Responses model with the server secret and charges measured usage', async () => {
    const a = await account(), fetch = upstream(), response = await ask(a), body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ method: 'llm', provider_called: true, model: 'gpt-6-luna', answer: responseBody().output[0].content[0].text, allowance: { limit_usd: 1, used_usd: .00015, reserved_usd: 0, remaining_usd: .99985, reset: 'never' } });
    expect(fetch).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(String(completions(fetch)[0][1]?.body));
    expect(sent).toMatchObject({ model: 'gpt-6-luna', store: false, max_output_tokens: 1600 });
    expect(sent.tools ?? []).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(await getAiAllowance(db, a.user.id)).toMatchObject({ used_nanos: 150_000, reserved_nanos: 0 });
    const trace = db.raw.prepare("SELECT request_json,response_json,cost_basis FROM traces WHERE source='assistant'").get() as any;
    expect(trace.cost_basis).toBe('user_price_estimate');
    expect(JSON.parse(trace.request_json).body_stored).toBe(false);
    expect(JSON.parse(trace.response_json).body_stored).toBe(false);
    expect(JSON.stringify(trace)).not.toContain(body.answer);
  });

  it('persists only a successful exchange and returns tenant-scoped evidence/history', async () => {
    const a = await account(), other = await account('other-hosted@example.invalid'); upstream();
    const result = await ask(a), body = await result.json() as any;
    expect(result.status).toBe(200); expect(typeof body.conversation_id).toBe('string'); expect(typeof body.message_id).toBe('string');
    expect(body.sources.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.sources)).toContain(a.project.id);
    expect(JSON.stringify(body.sources)).not.toContain(other.project.id);
    for (const source of body.sources) { expect(source.href.startsWith('/app/')).toBe(true); expect(new URL(source.href, 'https://app.test').origin).toBe('https://app.test'); }
    const list = await (await conversations(a)).json() as any;
    expect(list.items.some((item: any) => item.id === body.conversation_id)).toBe(true);
    const detail = await request('/api/ask/conversations/' + body.conversation_id + '?project=' + a.project.id, { cookie: a.cookie });
    expect(detail.status).toBe(200);
    const history = await detail.json() as any;
    expect(history.messages).toHaveLength(2);
    expect(history.messages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(history)).not.toContain(secret);
    expect((await request('/api/ask/conversations/' + body.conversation_id + '?project=' + a.project.id, { cookie: other.cookie })).status).toBe(404);
    expect((await request('/api/ask/conversations/' + body.conversation_id + '?project=' + other.project.id, { cookie: other.cookie })).status).toBe(404);
  });

  it('requires an authenticated project member, accepted terms and same-origin writes', async () => {
    const a = await account(), other = await account('nonmember@example.invalid'), pending = await account('unaccepted@example.invalid', false), fetch = upstream();
    expect((await request('/api/ask', { method: 'POST', body: { mode: 'hosted', project_id: a.project.id, question: 'Hello' } })).status).toBe(401);
    expect((await ask(other, { project_id: a.project.id })).status).toBe(404);
    expect((await ask(pending)).status).toBe(428);
    expect((await ask(a, {}, { origin: 'https://attacker.example.invalid' })).status).toBe(403);
    expect((await request('/api/ask/status?project=' + a.project.id)).status).toBe(401);
    expect((await request('/api/ask/status?project=' + a.project.id, { cookie: other.cookie })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends selected-project metadata evidence without raw prompts or another tenant\'s traces', async () => {
    const a = await account(), other = await account('private-other@example.invalid');
    const insert = db.raw.prepare('INSERT INTO traces(id,project_id,model,provider,status,created_at,source,request_json,response_json) VALUES(?,?,?,?,?,?,?,?,?)');
    insert.run('owned-evidence', a.project.id, 'synthetic-owned-model', 'synthetic', 'success', new Date().toISOString(), 'sdk', '{"prompt":"PRIVATE_RAW_REQUEST_DO_NOT_SEND"}', '{"answer":"PRIVATE_RAW_RESPONSE_DO_NOT_SEND"}');
    insert.run('other-evidence', other.project.id, 'PRIVATE_OTHER_TENANT_MODEL', 'synthetic', 'success', new Date().toISOString(), 'sdk', '{}', '{}');
    const fetch = upstream(), response = await ask(a);
    expect(response.status).toBe(200);
    const sent = String(completions(fetch)[0][1]?.body);
    expect(sent).toContain('synthetic-owned-model');
    expect(sent).not.toContain('PRIVATE_RAW_REQUEST_DO_NOT_SEND'); expect(sent).not.toContain('PRIVATE_RAW_RESPONSE_DO_NOT_SEND'); expect(sent).not.toContain('PRIVATE_OTHER_TENANT_MODEL');
  });

  it('rejects a conversation from a different project before any provider call', async () => {
    const a = await account(), fetch = upstream(), original = await (await ask(a)).json() as any;
    const created = await request('/api/projects', { method: 'POST', cookie: a.cookie, body: { name: 'Other conversation scope' } });
    const project = await created.json() as any;
    fetch.mockClear();
    const response = await ask(a, { project_id: project.project?.id ?? project.id, conversation_id: original.conversation_id });
    expect(response.status).toBe(404); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'missing key'])('fails closed when hosted access is %s', async condition => {
    const a = await account(), fetch = upstream();
    if (condition === 'disabled') env.HOSTED_ASK_ENABLED = 'false'; else delete env.HOSTED_OPENAI_API_KEY;
    expect((await ask(a)).status).toBe(503);
    expect(await (await status(a)).json()).toMatchObject({ hosted: { available: false } });
    expect(fetch).not.toHaveBeenCalled();
    expect(await getAiAllowance(db, a.user.id)).toMatchObject({ used_nanos: 0, reserved_nanos: 0 });
  });

  it('never uses a client-supplied model, provider, endpoint, key or billing amount for hosted calls', async () => {
    const a = await account(), fetch = upstream();
    const response = await ask(a, { model: 'arbitrary-expensive-model', provider: 'attacker', endpoint: 'https://attacker.example.invalid/capture', key: 'client-must-not-override-key', cost_usd: -100, remaining_usd: 100 });
    expect([200, 400]).toContain(response.status);
    for (const [, init] of completions(fetch)) {
      const sent = JSON.parse(String(init?.body)); expect(sent.model).toBe('gpt-6-luna');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + secret);
    }
    if (response.status === 400) expect(fetch).not.toHaveBeenCalled();
  });

  it('caps one authenticated user across projects and leaves a different user independent', async () => {
    const a = await account(), other = await account('independent@example.invalid');
    await reserveAiAllowance(db, { userId: a.user.id, projectId: a.project.id, requestId: 'synthetic-cap-reservation', reservationNanos: 1_000_000_000 });
    const created = await request('/api/projects', { method: 'POST', cookie: a.cookie, body: { name: 'Second synthetic project' } });
    expect(created.status).toBe(201); const project = await created.json() as any;
    const secondProjectId = project.project?.id ?? project.id;
    expect(typeof secondProjectId).toBe('string');
    const fetch = upstream(), capped = await ask(a, { project_id: secondProjectId });
    expect(capped.status).toBe(402);
    expect(await capped.json()).toMatchObject({ allowance: { remaining_usd: 0, reserved_usd: 1, reset: 'never' } });
    expect(completions(fetch)).toHaveLength(0);
    expect((await ask(other)).status).toBe(200);
    expect(completions(fetch)).toHaveLength(1);
  });

  it('does not charge for an explicit upstream credential rejection or create a successful chat', async () => {
    const a = await account(); upstream(() => Response.json({ error: { message: 'secret ' + secret } }, { status: 401 }));
    const response = await ask(a), body = await response.json();
    expect(response.status).toBe(503); expect(body).toMatchObject({ upstream_status: 401 });
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(await getAiAllowance(db, a.user.id)).toMatchObject({ used_nanos: 0, reserved_nanos: 0, remaining_nanos: 1_000_000_000 });
    expect((await (await conversations(a)).json() as any).items).toHaveLength(0);
  });

  it('admits only one concurrent paid call when the remaining balance fits one reservation', async () => {
    const a = await account();
    await reserveAiAllowance(db, { userId: a.user.id, projectId: a.project.id, requestId: 'synthetic-near-cap', reservationNanos: 998_000_000 });
    const fetch = upstream(() => Response.json({ error: { message: 'Synthetic uncertainty' } }, { status: 500 }));
    const responses = await Promise.all(Array.from({ length: 10 }, () => ask(a)));
    expect(responses.filter(response => response.status === 502)).toHaveLength(1);
    expect(responses.filter(response => response.status === 402)).toHaveLength(9);
    expect(completions(fetch)).toHaveLength(1);
    expect(await getAiAllowance(db, a.user.id)).toMatchObject({ reserved_nanos: 998_000_000, uncertain_nanos: 1_053_000, remaining_nanos: 947_000 });
  });

  it.each(['server error', 'timeout'])('consumes the full reserved bound on an uncertain %s', async kind => {
    const a = await account(); upstream(() => { if (kind === 'timeout') throw new DOMException('Synthetic upstream timeout', 'TimeoutError'); return Response.json({ error: { message: secret } }, { status: 500 }); });
    const response = await ask(a), body = await response.json();
    expect(response.status).toBe(502); expect(JSON.stringify(body)).not.toContain(secret);
    const row = db.raw.prepare('SELECT state,reservation_nanos,charged_nanos FROM ai_allowance_ledger WHERE user_id = ?').get(a.user.id) as any;
    expect(row.state).toBe('uncertain'); expect(row.charged_nanos).toBe(row.reservation_nanos); expect(row.charged_nanos).toBe(1_053_000);
    expect((await (await conversations(a)).json() as any).items).toHaveLength(0);
  });

  it('returns a real answer but conservatively charges the full bound if provider usage is missing', async () => {
    const a = await account(); upstream(() => { const result = responseBody() as any; delete result.usage; return Response.json(result); });
    const response = await ask(a), body = await response.json() as any;
    expect(response.status).toBe(200); expect(body.provider_called).toBe(true);
    expect(await getAiAllowance(db, a.user.id)).toMatchObject({ used_nanos: 1_053_000, uncertain_nanos: 1_053_000, measured_nanos: 0, reserved_nanos: 0 });
  });

  it('does not charge a rejected token-count preflight or make the paid Responses call', async () => {
    const a = await account(), fetch = vi.fn(async (input: string | URL | Request) => { expect(String(input)).toBe('https://api.openai.com/v1/responses/input_tokens'); return Response.json({ error: { message: secret } }, { status: 401 }); }); vi.stubGlobal('fetch', fetch);
    const response = await ask(a);
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain(secret);
    expect(fetch).toHaveBeenCalledTimes(1); expect(String(fetch.mock.calls[0][0])).toContain('/responses/input_tokens');
    expect(await getAiAllowance(db, a.user.id)).toMatchObject({ used_nanos: 0, reserved_nanos: 0 });
  });

  it('keeps legacy statistics mode free and explicitly marks that no model was called', async () => {
    const a = await account(), fetch = upstream();
    const response = await request('/api/ask', { method: 'POST', cookie: a.cookie, body: { project_id: a.project.id, question: 'How many requests?' } });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ method: 'rules', provider_called: false });
    expect(fetch).not.toHaveBeenCalled(); expect(await getAiAllowance(db, a.user.id)).toMatchObject({ used_nanos: 0, reserved_nanos: 0 });
  });

  it('does not call a paid model when allowance persistence fails', async () => {
    const a = await account(), prepare = db.prepare.bind(db), fetch = upstream();
    vi.spyOn(db, 'prepare').mockImplementation(sql => { if (sql.includes('INSERT INTO ai_allowance_ledger')) throw new Error('Synthetic ledger unavailable'); return prepare(sql); });
    expect((await ask(a)).status).toBeGreaterThanOrEqual(500);
    expect(completions(fetch)).toHaveLength(0);
  });
});
