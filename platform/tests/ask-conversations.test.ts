import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendAskExchange, askConversationHistory, registerAskConversations, validateAskConversation } from '../server/ask-conversations';
import { ApiError } from '../server/security';
import type { Database, Env, Principal, Row, Statement } from '../server/types';

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
  async batch(statements: Statement[]) { this.raw.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); this.raw.exec('COMMIT'); return result; } catch (error) { this.raw.exec('ROLLBACK'); throw error; } }
}
let db: SqliteDatabase, env: Env;
const a: Principal = { project: { id: 'project-a' }, workspace: { id: 'workspace-a' }, userId: 'user-a' };
const b: Principal = { project: { id: 'project-a' }, workspace: { id: 'workspace-a' }, userId: 'user-b' };
const otherProject: Principal = { ...a, project: { id: 'project-b' } };
const at = '2026-10-22T12:34:56.000Z';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at)); db = new SqliteDatabase(); env = { DB: db };
  for (const user of ['user-a', 'user-b']) db.raw.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?,?,?)').run(user, 'Synthetic user', user + '@example.invalid', 'not-a-real-hash', 'synthetic', 1, at);
  db.raw.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run('workspace-a', 'Synthetic workspace', at);
  for (const project of ['project-a', 'project-b']) db.raw.prepare('INSERT INTO projects(id,workspace_id,name,created_at) VALUES(?,?,?,?)').run(project, 'workspace-a', 'Synthetic project', at);
});
afterEach(() => { db.raw.close(); vi.useRealTimers(); });
const save = (principal = a, conversationId?: string, question = 'How is my project doing?', answer = 'No recorded traces.') => appendAskExchange(env, principal, { conversationId, question, answer, method: 'rules', sources: [{ type: 'project_statistics', project_id: principal.project.id, days: 30, title: 'Activity', href: '/app/analytics?project=' + principal.project.id }] });
function api() {
  const app = new Hono<{ Bindings: Env; Variables: { user: Row } }>();
  app.onError((error, c) => error instanceof ApiError ? c.json({ error: error.message }, error.status as any) : c.json({ error: 'failed' }, 500));
  registerAskConversations(app, { userProject: async (c, projectId) => {
    if (!c.req.header('x-test-user')) throw new ApiError(401, 'Sign in.');
    if (projectId !== 'project-a') throw new ApiError(404, 'Project not found.');
    return c.req.header('x-test-user') === 'user-a' ? a : b;
  } });
  return app;
}

describe('private persisted Ask conversations', () => {
  it('creates a successful paired exchange and appends to the same stable title', async () => {
    const first = await save();
    expect(db.raw.prepare('SELECT role FROM ask_messages WHERE id=?').get(first.message_id)?.role).toBe('assistant');
    expect(db.raw.prepare('SELECT role FROM ask_messages WHERE id=?').get(first.user_message_id)?.role).toBe('user');
    vi.setSystemTime(new Date(Date.parse(at) + 1000));
    const second = await save(a, first.id, 'What about cache?', 'Cache measurement is unavailable.');
    expect(second).toMatchObject({ id: first.id, title: first.title, created_at: at, updated_at: '2026-10-22T12:34:57.000Z' });
    const messages = db.raw.prepare('SELECT role,content,sequence FROM ask_messages ORDER BY sequence').all();
    expect(messages).toHaveLength(4); expect(messages.map(row => row.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages.map(row => row.sequence)).toEqual([1, 2, 3, 4]);
  });
  it('requires a signed in user and restricts conversation ownership even within a shared workspace', async () => {
    const conversation = await save();
    for (const principal of [b, otherProject, { ...a, workspace: { id: 'wrong' } }]) {
      await expect(validateAskConversation(env, principal, conversation.id)).rejects.toMatchObject({ status: 404 });
      await expect(save(principal, conversation.id)).rejects.toMatchObject({ status: 404 });
    }
    await expect(save({ ...a, userId: undefined })).rejects.toMatchObject({ status: 401 });
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM ask_messages').get()?.count).toBe(2);
  });
  it('validates before writes, stores no pending message, and rolls back both halves on a DB error', async () => {
    await expect(save(a, 'missing')).rejects.toMatchObject({ status: 404 });
    await validateAskConversation(env, a); await askConversationHistory(env, a);
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM ask_conversations').get()?.count).toBe(0);
    db.raw.exec("CREATE TRIGGER fail_assistant BEFORE INSERT ON ask_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    await expect(save()).rejects.toThrow('synthetic failure');
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM ask_conversations').get()?.count).toBe(0);
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM ask_messages').get()?.count).toBe(0);
  });
  it('bounds followup history and explicitly reports clipping without returning source bodies', async () => {
    const conversation = await save();
    for (let index = 0; index < 8; index++) await save(a, conversation.id, `Question ${index}`, 'a'.repeat(5000));
    const history = await askConversationHistory(env, a, conversation.id);
    expect(history.truncated).toBe(true); expect(history.messages.length).toBeLessThanOrEqual(10);
    expect(history.messages.reduce((size, message) => size + message.content.length, 0)).toBeLessThanOrEqual(12000);
    expect(history.messages[0].role).toBe('user'); expect(history.messages.at(-1)?.role).toBe('assistant');
    expect(history.messages.at(-1)?.content).toContain('[Message truncated]');
  });
  it('redacts credential-shaped text and rejects unbounded content before persistence', async () => {
    const conversation = await save(a, undefined, 'Check sk-a-synthetic-long-token-123456789', 'Answer tq_a-synthetic-long-token-123456789');
    expect(conversation.title).toBe('Check [redacted]');
    const history = await askConversationHistory(env, a, conversation.id);
    expect(JSON.stringify(history)).not.toContain('synthetic-long-token');
    await expect(save(a, conversation.id, 'x'.repeat(2001))).rejects.toMatchObject({ status: 400 });
    await expect(save(a, conversation.id, 'Question', 'x'.repeat(12001))).rejects.toMatchObject({ status: 400 });
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM ask_messages').get()?.count).toBe(2);
  });
  it('returns scoped lists and details with safe evidence links and bounded display history', async () => {
    const own = await save(), theirs = await save(b), app = api();
    for (let index = 0; index < 26; index++) await save(a, own.id, `Question ${index}`, `Answer ${index}`);
    const request = (path: string, user = 'user-a') => app.fetch(new Request('https://app.test' + path, { headers: user ? { 'x-test-user': user } : {} }), env);
    expect((await request('/api/ask/conversations?project=project-a', '')).status).toBe(401);
    const list = await (await request('/api/ask/conversations?project=project-a')).json() as any;
    expect(list.items.map((row: Row) => row.id)).toEqual([own.id]); expect(list.has_more).toBe(false);
    expect((await request(`/api/ask/conversations/${theirs.id}?project=project-a`)).status).toBe(404);
    expect((await request(`/api/ask/conversations/${own.id}?project=project-other`)).status).toBe(404);
    const detail = await (await request(`/api/ask/conversations/${own.id}?project=project-a`)).json() as any;
    expect(detail.messages).toHaveLength(50); expect(detail.has_more).toBe(true); expect(detail.conversation.id).toBe(own.id);
    expect(detail.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Answer 25', method: 'rules', model: null, sources: [{ href: '/app/analytics?project=project-a' }] });
    expect(JSON.stringify(detail)).not.toContain('user_id'); expect(JSON.stringify(detail)).not.toContain('workspace_id');
  });
  it('does not persist unsafe external links or sources from a different project', async () => {
    const conversation = await appendAskExchange(env, a, { question: 'Question', answer: 'Answer', method: 'llm', model: 'test-model', sources: [
      { type: 'project_statistics', project_id: a.project.id, days: 30, title: 'Unsafe', href: '//bad.invalid/app/analytics' },
      { type: 'project_statistics', project_id: 'other-project', days: 30, title: 'Other', href: '/app/analytics' },
      { type: 'trace_metadata', project_id: a.project.id, days: 30, title: 'Evidence', href: '/app/traces?project=project-a', trace_ids: ['valid'] },
    ] });
    const row = db.raw.prepare("SELECT sources_json FROM ask_messages WHERE conversation_id=? AND role='assistant'").get(conversation.id);
    expect(JSON.parse(row?.sources_json as string)).toEqual([{ type: 'trace_metadata', project_id: 'project-a', days: 30, title: 'Evidence', href: '/app/traces?project=project-a', trace_ids: ['valid'] }]);
  });
});
