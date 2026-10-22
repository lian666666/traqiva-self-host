import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_ALLOWANCE_LIMIT_NANOS, getAiAllowance, reserveAiAllowance, settleAiAllowance } from '../server/ai-allowance';
import type { Database, Statement } from '../server/types';

class SqliteStatement implements Statement {
  values: unknown[] = [];
  constructor(public owner: SqliteDatabase, public sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { await Promise.resolve(); return (this.owner.raw.prepare(this.sql).get(...this.values as never[]) ?? null) as T | null; }
  async all<T>() { return { results: this.owner.raw.prepare(this.sql).all(...this.values as never[]) as T[] }; }
  async run() { return this.owner.raw.prepare(this.sql).run(...this.values as never[]); }
}
class SqliteDatabase implements Database {
  raw = new DatabaseSync(':memory:');
  constructor() {
    const root = new URL('../migrations/', import.meta.url);
    for (const name of readdirSync(root).filter(name => name.endsWith('.sql')).sort()) this.raw.exec(readFileSync(new URL(name, root), 'utf8'));
    for (const user of ['user-one', 'user-two']) this.raw.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?,?,?)').run(user, 'Synthetic allowance user', user + '@example.invalid', 'unused', 'unused', 1, '2026-10-22T00:00:00Z');
    this.raw.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run('workspace-one', 'Synthetic workspace', '2026-10-22T00:00:00Z');
    for (const project of ['project-one', 'project-two']) this.raw.prepare('INSERT INTO projects(id,workspace_id,name,created_at) VALUES(?,?,?,?)').run(project, 'workspace-one', 'Synthetic project', '2026-10-22T00:00:00Z');
  }
  prepare(sql: string) { return new SqliteStatement(this, sql); }
  async batch(statements: Statement[]) { this.raw.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.raw.exec('COMMIT'); return results; } catch (error) { this.raw.exec('ROLLBACK'); throw error; } }
}
let db: SqliteDatabase;
const reserve = (requestId: string, reservationNanos: number, options: { userId?: string; projectId?: string } = {}) => reserveAiAllowance(db, { userId: options.userId ?? 'user-one', projectId: options.projectId ?? 'project-one', requestId, reservationNanos });
beforeEach(() => { db = new SqliteDatabase(); });
afterEach(() => { db.raw.close(); vi.restoreAllMocks(); });

describe('lifetime user-scoped hosted AI allowance ledger', () => {
  it('starts at exactly one USD and makes a reserved upper bound unavailable', async () => {
    expect(AI_ALLOWANCE_LIMIT_NANOS).toBe(1_000_000_000);
    expect(await getAiAllowance(db, 'user-one')).toEqual({ available: true, limit_nanos: 1_000_000_000, used_nanos: 0, reserved_nanos: 0, remaining_nanos: 1_000_000_000, measured_nanos: 0, uncertain_nanos: 0, period: 'lifetime', resets_at: null, accounting_basis: 'provider_usage_with_conservative_reservations' });
    const result = await reserve('request-one', 200_000_000);
    expect(result).toMatchObject({ admitted: true, duplicate: false, reservation: { user_id: 'user-one', project_id: 'project-one', state: 'reserved', reservation_nanos: 200_000_000, charged_nanos: 0, accounting_basis: 'reserved_upper_bound' }, allowance: { used_nanos: 0, reserved_nanos: 200_000_000, remaining_nanos: 800_000_000 } });
  });

  it('admits no more than the cap even when calls arrive together', async () => {
    const results = await Promise.all(Array.from({ length: 40 }, (_, index) => reserve('concurrent-' + index, 100_000_000)));
    expect(results.filter(result => result.admitted)).toHaveLength(10);
    expect(results.filter(result => !result.admitted && !result.duplicate)).toHaveLength(30);
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ available: false, used_nanos: 0, reserved_nanos: 1_000_000_000, remaining_nanos: 0 });
  });

  it('shares the allowance across projects but isolates authenticated users', async () => {
    await reserve('project-one-request', 750_000_000);
    expect(await reserve('project-two-request', 300_000_000, { projectId: 'project-two' })).toMatchObject({ admitted: false, duplicate: false, reservation: null });
    expect(await reserve('project-two-request', 250_000_000, { projectId: 'project-two' })).toMatchObject({ admitted: true });
    expect(await reserve('project-one-request', 1_000_000_000, { userId: 'user-two' })).toMatchObject({ admitted: true });
  });

  it('authorizes one upstream attempt for simultaneous duplicate request IDs', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve('same-request', 600_000_000)));
    expect(results.filter(result => result.admitted)).toHaveLength(1);
    expect(results.filter(result => result.duplicate && !result.admitted)).toHaveLength(9);
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ reserved_nanos: 600_000_000, remaining_nanos: 400_000_000 });
  });

  it('settles provider-measured cost once and releases the unused reservation', async () => {
    await reserve('measured', 600_000_000);
    const result = await settleAiAllowance(db, { userId: 'user-one', requestId: 'measured', outcome: 'measured', actualNanos: 120_000_000 });
    expect(result).toMatchObject({ changed: true, reservation: { state: 'settled', charged_nanos: 120_000_000, accounting_basis: 'provider_usage' }, allowance: { used_nanos: 120_000_000, measured_nanos: 120_000_000, reserved_nanos: 0, remaining_nanos: 880_000_000 } });
    expect(await settleAiAllowance(db, { userId: 'user-one', requestId: 'measured', outcome: 'measured', actualNanos: 90_000_000 })).toMatchObject({ changed: false, reservation: { charged_nanos: 120_000_000 } });
    expect(await settleAiAllowance(db, { userId: 'user-one', requestId: 'measured', outcome: 'not_billed' })).toMatchObject({ changed: false, reservation: { state: 'settled', charged_nanos: 120_000_000 } });
  });

  it('accepts one terminal settlement when duplicate responses arrive together', async () => {
    await reserve('settlement-race', 300_000_000);
    const results = await Promise.all(Array.from({ length: 20 }, () => settleAiAllowance(db, { userId: 'user-one', requestId: 'settlement-race', outcome: 'measured', actualNanos: 120_000_000 })));
    expect(results.filter(result => result.changed)).toHaveLength(1);
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ used_nanos: 120_000_000, reserved_nanos: 0, remaining_nanos: 880_000_000 });
  });

  it('accounts unknown usage or timeout at the full bound without expiry or a later automatic refund', async () => {
    await reserve('timeout', 700_000_000);
    const result = await settleAiAllowance(db, { userId: 'user-one', requestId: 'timeout', outcome: 'uncertain' });
    expect(result).toMatchObject({ changed: true, reservation: { state: 'uncertain', charged_nanos: 700_000_000, accounting_basis: 'conservative_upper_bound' }, allowance: { used_nanos: 700_000_000, uncertain_nanos: 700_000_000, reserved_nanos: 0, remaining_nanos: 300_000_000 } });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      expect(await getAiAllowance(db, 'user-one')).toMatchObject({ remaining_nanos: 300_000_000, resets_at: null });
      expect(await settleAiAllowance(db, { userId: 'user-one', requestId: 'timeout', outcome: 'not_billed' })).toMatchObject({ changed: false, reservation: { state: 'uncertain' } });
    } finally { vi.useRealTimers(); }
  });

  it('keeps an interrupted reservation held indefinitely and does not refund it by deleting its project', async () => {
    await reserve('interrupted', 1_000_000_000);
    db.raw.prepare('DELETE FROM projects WHERE id = ?').run('project-one');
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ available: false, reserved_nanos: 1_000_000_000, remaining_nanos: 0 });
    expect(await reserve('interrupted', 1, { projectId: 'project-two' })).toMatchObject({ admitted: false, duplicate: true, reservation: { project_id: null } });
  });

  it('releases only a known-not-billed attempt and never admits that ID again', async () => {
    await reserve('rejected', 1_000_000_000);
    expect(await settleAiAllowance(db, { userId: 'user-one', requestId: 'rejected', outcome: 'not_billed' })).toMatchObject({ changed: true, reservation: { state: 'released', charged_nanos: 0 }, allowance: { remaining_nanos: 1_000_000_000 } });
    expect(await reserve('rejected', 1_000_000_000)).toMatchObject({ admitted: false, duplicate: true, reservation: { state: 'released' } });
    expect(await reserve('new-attempt', 1_000_000_000)).toMatchObject({ admitted: true });
  });

  it('rejects fractional, unsafe, zero and negative reservations before making any write', async () => {
    for (const value of [0, -1, .5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, 1_000_000_001]) await expect(reserve('bad-' + value, value)).rejects.toThrow();
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ reserved_nanos: 0, used_nanos: 0 });
  });

  it('does not release a reservation for missing, negative, fractional or above-bound actual cost', async () => {
    await reserve('bad-usage', 100);
    for (const actualNanos of [undefined, -1, .5, Number.NaN, 101]) await expect(settleAiAllowance(db, { userId: 'user-one', requestId: 'bad-usage', outcome: 'measured', actualNanos } as never)).rejects.toThrow();
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ reserved_nanos: 100, remaining_nanos: 999_999_900 });
  });

  it('settles only that user and request and rejects nonexistent reservations', async () => {
    await reserve('isolated', 100);
    await expect(settleAiAllowance(db, { userId: 'user-two', requestId: 'isolated', outcome: 'not_billed' })).rejects.toThrow('reservation');
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ reserved_nanos: 100 });
  });

  it('fails closed before an external call if admission or its result cannot be persisted/read', async () => {
    const upstream = vi.fn();
    const broken: Database = { prepare: () => { throw new Error('Synthetic D1 failure'); }, batch: async () => { throw new Error('Synthetic D1 failure'); } };
    await expect((async () => {
      const result = await reserveAiAllowance(broken, { userId: 'user-one', projectId: 'project-one', requestId: 'db-failure', reservationNanos: 100 });
      if (result.admitted) upstream();
    })()).rejects.toThrow('Synthetic D1 failure');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('retains the hold and does not authorize upstream if the follow-up status read fails', async () => {
    const upstream = vi.fn();
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (sql.includes('AS reserved_nanos')) throw new Error('Synthetic status-read failure');
      return prepare(sql);
    });
    await expect((async () => {
      const result = await reserve('status-failure', 100_000_000);
      if (result.admitted) upstream();
    })()).rejects.toThrow('Synthetic status-read failure');
    expect(upstream).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ reserved_nanos: 100_000_000 });
    expect(await reserve('status-failure', 100_000_000)).toMatchObject({ admitted: false, duplicate: true });
  });

  it('prevents direct invalid final states at the database constraint boundary', async () => {
    await reserve('constraint', 100);
    expect(() => db.raw.prepare("UPDATE ai_allowance_ledger SET state = 'uncertain', charged_nanos = 1, accounting_basis = 'conservative_upper_bound', settled_at = ? WHERE request_id = ?").run('2026-10-22T00:00:00Z', 'constraint')).toThrow();
    expect(await getAiAllowance(db, 'user-one')).toMatchObject({ reserved_nanos: 100 });
  });
});
