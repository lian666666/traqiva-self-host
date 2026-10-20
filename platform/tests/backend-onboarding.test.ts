import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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
const version = '2026-10-20.1';
async function request(path: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST', key?: string) {
  return app.fetch(new Request(`https://app.test${path}`, { method, headers: { origin: 'https://app.test', 'content-type': 'application/json', cookie, ...(key ? { 'x-traqiva-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}
async function register(email = 'one@example.test') {
  const response = await request('/api/auth/register', '', { name: 'Tester', email, password: 'A sufficiently long password' });
  expect(response.status).toBe(201);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0], data: await response.json() as any };
}
const consent = (cookie: string) => request('/api/consent', cookie, { version, accepted: true });
async function chooseProject(cookie: string, name = 'Connected project') {
  expect((await request('/api/onboarding/goals', cookie, { goals: ['coding'] })).status).toBe(200);
  const response = await request('/api/onboarding/project', cookie, { name });
  expect(response.status).toBe(200); return response.json() as Promise<any>;
}
beforeEach(() => { db = new SqliteDatabase(); env = { DB: db }; });
afterEach(() => { db.raw.close(); vi.unstubAllGlobals(); });

describe('durable onboarding, versioned workspace consent and real connection evidence', () => {
  it('migrates an existing account to goals without inventing prior consent or completed onboarding', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      const root = new URL('../migrations/', import.meta.url);
      for (const name of ['0001_platform.sql', '0002_compression_events.sql', '0003_google_oidc.sql']) legacy.exec(readFileSync(new URL(name, root), 'utf8'));
      legacy.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?,?,?)').run('existing-user', 'Existing', 'existing@example.test', 'synthetic-test-hash', 'test-salt', 100000, '2026-10-01T00:00:00.000Z');
      legacy.exec(readFileSync(new URL('0004_onboarding_consent.sql', root), 'utf8'));
      expect(legacy.prepare('SELECT user_id,stage,goals_json,project_id FROM user_onboarding').get()).toEqual({ user_id: 'existing-user', stage: 'goals', goals_json: '[]', project_id: null });
      expect(legacy.prepare('SELECT count(*) AS n FROM workspace_terms_acceptances').get()).toEqual({ n: 0 });
    } finally { legacy.close(); }
  });
  it('starts at goals, persists stages across session reads and completes only with explicit skip or real evidence', async () => {
    const { cookie, data } = await register();
    expect(data.setup).toEqual({ stage: 'goals', goals: [], project_id: null });
    expect(data.terms).toEqual({ version, accepted: false, accepted_at: null });
    expect((await request('/api/onboarding/complete', cookie, { skip_connection: true })).status).toBe(428);
    await consent(cookie);
    expect((await request('/api/onboarding/complete', cookie, { skip_connection: true })).status).toBe(409);
    const selected = await chooseProject(cookie);
    expect(selected.setup).toEqual({ stage: 'connect', goals: ['coding'], project_id: data.activeProject.id });
    expect((await (await request('/api/session', cookie)).json() as any).setup).toEqual(selected.setup);
    expect((await request('/api/onboarding/complete', cookie, { skip_connection: false })).status).toBe(409);
    const complete = await request('/api/onboarding/complete', cookie, { skip_connection: true });
    expect((await complete.json() as any).setup.stage).toBe('complete');
    await request('/api/onboarding/goals', cookie, { goals: ['observe'] });
    await request('/api/onboarding/project', cookie, { name: 'Renamed' });
    expect((await (await request('/api/session', cookie)).json() as any).setup.stage).toBe('complete');
    const restart = await (await request('/api/onboarding/restart', cookie, {})).json() as any;
    expect(restart.setup).toEqual({ stage: 'goals', goals: ['observe'], project_id: data.activeProject.id });
    expect(db.raw.prepare('SELECT count(*) AS n FROM projects').get()).toEqual({ n: 1 });
  });
  it.each([[], ['coding', 'coding'], ['unknown'], ['observe', 'coding', 'observe'], 'coding'].map(goals => ({ goals })))('rejects invalid goals $goals', async ({ goals }) => {
    const account = await register(); expect((await request('/api/onboarding/goals', account.cookie, { goals })).status).toBe(400);
    expect((await (await request('/api/session', account.cookie)).json() as any).setup.stage).toBe('goals');
  });
  it('reuses and renames the same default project on retries without changing another tenant', async () => {
    const one = await register(), two = await register('two@example.test');
    const a = await chooseProject(one.cookie, 'Real project'), b = await request('/api/onboarding/project', one.cookie, { name: 'Real project' });
    expect((await b.json() as any).project.id).toBe(a.project.id);
    expect(db.raw.prepare('SELECT count(*) AS n FROM projects WHERE workspace_id=?').get(one.data.workspace.id)).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT name FROM projects WHERE id=?').get(two.data.activeProject.id)).toEqual({ name: 'My project' });
    expect((await (await request('/api/session', one.cookie)).json() as any).activeProject.id).toBe(a.project.id);
  });
  it('requires an affirmative current-version owner consent, stores actor/time and audits it', async () => {
    const one = await register();
    expect((await request('/api/consent', one.cookie, { version: 'old', accepted: true })).status).toBe(400);
    expect((await request('/api/consent', one.cookie, { version, accepted: false })).status).toBe(400);
    db.raw.prepare("UPDATE members SET role='member' WHERE user_id=?").run(one.data.user.id);
    expect((await consent(one.cookie)).status).toBe(403);
    db.raw.prepare("UPDATE members SET role='owner' WHERE user_id=?").run(one.data.user.id);
    const accepted = await consent(one.cookie); expect(accepted.status).toBe(200);
    const terms = (await accepted.json() as any).terms;
    expect(terms.accepted).toBe(true); expect(Date.parse(terms.accepted_at)).toBeGreaterThan(0);
    expect((await (await request('/api/session', one.cookie)).json() as any).terms).toEqual(terms);
    await consent(one.cookie);
    expect(db.raw.prepare('SELECT count(*) AS n FROM workspace_terms_acceptances').get()).toEqual({ n: 1 });
    expect(db.raw.prepare("SELECT count(*) AS n FROM audit_log WHERE action='terms.accepted'").get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT accepted_by FROM workspace_terms_acceptances').get()).toEqual({ accepted_by: one.data.user.id });
    expect(db.raw.prepare("SELECT action FROM audit_log WHERE action='terms.accepted' LIMIT 1").get()).toEqual({ action: 'terms.accepted' });
  });
  it('blocks cookie and project-key business API bypass until this workspace accepts this exact version', async () => {
    const one = await register(), two = await register('two@example.test'); await consent(two.cookie);
    expect((await request(`/api/overview?project=${one.data.activeProject.id}`, one.cookie)).status).toBe(428);
    expect((await request('/api/projects', one.cookie, { name: 'Bypass' })).status).toBe(428);
    expect((await request('/api/workspace', one.cookie, { name: 'Bypass' }, 'PATCH')).status).toBe(428);
    expect((await request('/api/keys', one.cookie, { project_id: one.data.activeProject.id, name: 'Bypass' })).status).toBe(428);
    expect((await request('/api/session', one.cookie)).status).toBe(200);
    await consent(one.cookie);
    const key = await (await request('/api/keys', one.cookie, { project_id: one.data.activeProject.id, name: 'Real key' })).json() as any;
    db.raw.prepare('DELETE FROM workspace_terms_acceptances WHERE workspace_id=?').run(one.data.workspace.id);
    expect((await request('/api/connection', '', undefined, 'GET', key.key)).status).toBe(428);
    expect((await request('/v1/responses', '', { model: 'unused' }, 'POST', key.key)).status).toBe(428);
    expect((db.raw.prepare('SELECT last_used_at FROM project_keys WHERE id=?').get(key.record.id) as any).last_used_at).toBeNull();
    expect((await request(`/api/overview?project=${two.data.activeProject.id}`, two.cookie)).status).toBe(200);
    expect((await request(`/api/overview?project=${two.data.activeProject.id}`, one.cookie)).status).toBe(404);
  });
  it('does not invent a connection when generating keys or polling; records real key use and scopes it to the selected project', async () => {
    const one = await register(), two = await register('two@example.test'); await consent(one.cookie); await consent(two.cookie);
    await chooseProject(one.cookie); await chooseProject(two.cookie);
    const empty = { connected: false, method: null, last_activity_at: null };
    expect(await (await request('/api/onboarding/status', one.cookie)).json()).toEqual(empty);
    const key = await (await request('/api/keys', one.cookie, { project_id: one.data.activeProject.id, name: 'Local connection' })).json() as any;
    expect(await (await request('/api/onboarding/status', one.cookie)).json()).toEqual(empty);
    expect(await (await request('/api/onboarding/status', one.cookie)).json()).toEqual(empty);
    expect((await request('/api/connection', '', undefined, 'GET', key.key)).status).toBe(200);
    const status = await (await request('/api/onboarding/status', one.cookie)).json() as any;
    expect(status.connected).toBe(true); expect(status.method).toBe('project_key'); expect(Date.parse(status.last_activity_at)).toBeGreaterThan(0);
    expect(await (await request('/api/onboarding/status', two.cookie)).json()).toEqual(empty);
    expect((await request('/api/onboarding/complete', one.cookie, { skip_connection: false })).status).toBe(200);
  });
  it('uses recorded traffic or compression evidence without treating imported traces as agent connection', async () => {
    const one = await register(); await consent(one.cookie); await chooseProject(one.cookie);
    await request('/api/traces/import', one.cookie, { project_id: one.data.activeProject.id, records: [{ model: 'imported', input_tokens: 1 }] });
    expect((await (await request('/api/onboarding/status', one.cookie)).json() as any).connected).toBe(false);
    db.raw.prepare("UPDATE traces SET source='gateway'").run();
    expect((await (await request('/api/onboarding/status', one.cookie)).json() as any).method).toBe('traffic');
    db.raw.prepare('DELETE FROM traces').run();
    await request('/api/compress', one.cookie, { project_id: one.data.activeProject.id, text: '{ "actual": true }' });
    expect((await (await request('/api/onboarding/status', one.cookie)).json() as any).method).toBe('compression');
  });
  it('checks consent before mutating existing keys or improvements and before reading trace payloads or running evals', async () => {
    const one = await register(); await consent(one.cookie);
    const key = await (await request('/api/keys', one.cookie, { project_id: one.data.activeProject.id, name: 'Existing key' })).json() as any;
    await request('/api/traces/import', one.cookie, { project_id: one.data.activeProject.id, records: [{ model: 'unknown-price', status: 'error', request: { private: 'payload' } }] });
    const trace = db.raw.prepare('SELECT id FROM traces').get() as any;
    const analyzed = await (await request('/api/improvements/analyze', one.cookie, { project_id: one.data.activeProject.id })).json() as any;
    const suite = await (await request('/api/evals', one.cookie, { project_id: one.data.activeProject.id, name: 'Exact', cases: [{ input: 'a', expected: 'b', actual: 'b' }] })).json() as any;
    db.raw.prepare('DELETE FROM workspace_terms_acceptances').run();
    expect((await request(`/api/keys/${key.record.id}`, one.cookie, undefined, 'DELETE')).status).toBe(428);
    expect((await request(`/api/improvements/${analyzed.items[0].id}`, one.cookie, { status: 'accepted' }, 'PATCH')).status).toBe(428);
    expect((await request(`/api/traces/${trace.id}`, one.cookie)).status).toBe(428);
    expect((await request(`/api/evals/${suite.suite.id}/run`, one.cookie, {})).status).toBe(428);
    expect(db.raw.prepare('SELECT revoked_at FROM project_keys').get()).toEqual({ revoked_at: null });
    expect(db.raw.prepare('SELECT DISTINCT status FROM improvements').all()).toEqual([{ status: 'pending' }]);
    expect(db.raw.prepare('SELECT count(*) AS n FROM eval_runs').get()).toEqual({ n: 0 });
  });
});
