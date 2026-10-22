import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../server/index';
import { ONBOARDING_FLOW_VERSION } from '../src/features/agentBuilder';
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
const password = 'A sufficiently long test password';
const consentVersion = '2026-10-20.1';
async function request(path: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return app.fetch(new Request(`https://app.test${path}`, { method, headers: { origin: 'https://app.test', 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}
async function register() {
  const response = await request('/api/auth/register', '', { name: 'Tester', email: 'flow@example.test', password });
  expect(response.status).toBe(201);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0], data: await response.json() as any };
}
async function session(cookie: string) { return (await (await request('/api/session', cookie)).json()) as any; }
function storeSetup(userId: string, stage: string, goals: string[], projectId: string, version: number) {
  db.raw.prepare('UPDATE user_onboarding SET stage=?,goals_json=?,project_id=?,flow_version=? WHERE user_id=?').run(stage, JSON.stringify(goals), projectId, version, userId);
}
beforeEach(() => { db = new SqliteDatabase(); env = { DB: db }; });
afterEach(() => { db.raw.close(); });

describe('coding-agent-only onboarding release', () => {
  it('adds a legacy flow version without rewriting the existing onboarding record', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      const root = new URL('../migrations/', import.meta.url);
      for (const name of readdirSync(root).filter(name => name.endsWith('.sql') && name < '0007').sort()) legacy.exec(readFileSync(new URL(name, root), 'utf8'));
      legacy.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?,?,?)').run('legacy-user', 'Legacy', 'legacy@example.test', 'synthetic-hash', 'synthetic-salt', 100000, '2026-10-01T00:00:00.000Z');
      legacy.prepare('INSERT INTO user_onboarding(user_id,stage,goals_json,created_at,updated_at) VALUES(?,?,?,?,?)').run('legacy-user', 'project', '["observe"]', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
      legacy.exec(readFileSync(new URL('0007_onboarding_flow.sql', root), 'utf8'));
      expect(legacy.prepare('SELECT user_id,stage,goals_json,flow_version FROM user_onboarding').get()).toEqual({ user_id: 'legacy-user', stage: 'project', goals_json: '["observe"]', flow_version: 1 });
    } finally { legacy.close(); }
  });

  it('starts a new email registration and its first login at step one of the current flow', async () => {
    const { data } = await register();
    expect(data.setup).toEqual({ stage: 'goals', goals: [], project_id: null });
    expect((db.raw.prepare('SELECT * FROM user_onboarding').get() as any).flow_version).toBe(ONBOARDING_FLOW_VERSION);
    const response = await request('/api/auth/login', '', { email: 'flow@example.test', password });
    expect(response.status).toBe(200);
    expect((await response.json() as any).setup).toEqual(data.setup);
  });

  it.each(['goals', 'project', 'connect'])('returns an incomplete legacy %s setup to step one once without deleting its project, traffic or consent', async stage => {
    const { cookie, data } = await register();
    await request('/api/consent', cookie, { version: consentVersion, accepted: true });
    await request('/api/traces/import', cookie, { project_id: data.activeProject.id, records: [{ model: 'synthetic-model', input_tokens: 21 }] });
    storeSetup(data.user.id, stage, ['coding'], data.activeProject.id, 1);
    const first = await session(cookie);
    expect(first.setup).toEqual({ stage: 'goals', goals: [], project_id: data.activeProject.id });
    expect(first.terms.accepted).toBe(true);
    expect(db.raw.prepare('SELECT count(*) AS n FROM traces').get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT count(*) AS n FROM projects').get()).toEqual({ n: 1 });
    expect((db.raw.prepare('SELECT * FROM user_onboarding').get() as any).flow_version).toBe(ONBOARDING_FLOW_VERSION);
    expect((await request('/api/onboarding/goals', cookie, { goals: ['coding'] })).status).toBe(200);
    expect((await session(cookie)).setup.stage).toBe('project');
    expect((await session(cookie)).setup.stage).toBe('project');
  });

  it.each([['observe'], ['coding', 'observe']].map(goals => ({ goals })))('requires step one for stored disabled goals $goals even with a current flow version', async ({ goals }) => {
    const { cookie, data } = await register();
    storeSetup(data.user.id, 'connect', goals, data.activeProject.id, ONBOARDING_FLOW_VERSION);
    expect((await session(cookie)).setup).toEqual({ stage: 'goals', goals: [], project_id: data.activeProject.id });
  });

  it('preserves a completed legacy workspace while removing its disabled goal', async () => {
    const { cookie, data } = await register();
    await request('/api/consent', cookie, { version: consentVersion, accepted: true });
    storeSetup(data.user.id, 'complete', ['observe'], data.activeProject.id, 1);
    expect((await session(cookie)).setup).toEqual({ stage: 'complete', goals: ['coding'], project_id: data.activeProject.id });
    expect((await session(cookie)).terms.accepted).toBe(true);
  });

  it.each([['observe'], ['coding', 'observe']].map(goals => ({ goals })))('rejects disabled goals $goals instead of advancing the setup', async ({ goals }) => {
    const { cookie } = await register();
    expect((await request('/api/onboarding/goals', cookie, { goals })).status).toBe(400);
    expect((await session(cookie)).setup.stage).toBe('goals');
  });

  it('does not allow old stored goals to bypass an explicit current step-one confirmation', async () => {
    const { cookie, data } = await register();
    storeSetup(data.user.id, 'goals', ['coding'], data.activeProject.id, ONBOARDING_FLOW_VERSION);
    expect((await request('/api/onboarding/project', cookie, { name: 'Skipped first step' })).status).toBe(409);
    expect((await session(cookie)).setup.stage).toBe('goals');
  });

  it('keeps current coding progress at steps two and three across new login sessions', async () => {
    const { cookie } = await register();
    await request('/api/onboarding/goals', cookie, { goals: ['coding'] });
    const response = await request('/api/auth/login', '', { email: 'flow@example.test', password });
    expect((await response.json() as any).setup.stage).toBe('project');
    await request('/api/onboarding/project', cookie, { name: 'Coding project' });
    expect((await session(cookie)).setup.stage).toBe('connect');
  });
});

describe('deferred agent-builder API capability', () => {
  it('hides evaluation endpoints without hiding common coding-agent APIs', async () => {
    const { cookie, data } = await register();
    await request('/api/consent', cookie, { version: consentVersion, accepted: true });
    const list = await request(`/api/evals?project=${data.activeProject.id}`, cookie);
    const create = await request('/api/evals', cookie, { project_id: data.activeProject.id, name: 'Deferred', cases: [{ input: 'a', expected: 'b', actual: 'b' }] });
    const run = await request('/api/evals/synthetic-suite/run', cookie, {});
    expect([list.status, create.status, run.status]).toEqual([404, 404, 404]);
    expect(db.raw.prepare('SELECT count(*) AS n FROM eval_suites').get()).toEqual({ n: 0 });
    expect((await request(`/api/auto?project=${data.activeProject.id}`, cookie)).status).toBe(200);
    expect((await request(`/api/keys?project=${data.activeProject.id}`, cookie)).status).toBe(200);
    expect((await request(`/api/overview?project=${data.activeProject.id}`, cookie)).status).toBe(200);
  });
});
