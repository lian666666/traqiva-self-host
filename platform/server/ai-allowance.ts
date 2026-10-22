import type { Database } from './types';

/** USD nano-units, never binary floating-point dollar arithmetic. */
export const AI_ALLOWANCE_LIMIT_NANOS = 1_000_000_000;

export type AiAllowance = {
  available: boolean;
  limit_nanos: number;
  used_nanos: number;
  reserved_nanos: number;
  remaining_nanos: number;
  measured_nanos: number;
  uncertain_nanos: number;
  period: 'lifetime';
  resets_at: null;
  accounting_basis: 'provider_usage_with_conservative_reservations';
};

export type AiAllowanceReservation = {
  user_id: string;
  request_id: string;
  project_id: string | null;
  reservation_nanos: number;
  charged_nanos: number;
  state: 'reserved' | 'settled' | 'uncertain' | 'released';
  accounting_basis: 'reserved_upper_bound' | 'provider_usage' | 'conservative_upper_bound' | 'known_not_billed';
  created_at: string;
  settled_at: string | null;
};

export type ReserveAiAllowanceInput = { userId: string; requestId: string; projectId: string; reservationNanos: number };
export type SettleAiAllowanceInput = { userId: string; requestId: string } & (
  { outcome: 'measured'; actualNanos: number } | { outcome: 'uncertain' | 'not_billed' }
);

function identifier(value: string, name: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new TypeError(`A valid ${name} is required.`);
}

function nanos(value: number, minimum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > AI_ALLOWANCE_LIMIT_NANOS) throw new RangeError('Allowance amounts must be integer USD nano-units within the lifetime limit.');
}

export async function getAiAllowance(db: Database, userId: string): Promise<AiAllowance> {
  identifier(userId, 'user ID');
  const totals = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN state = 'reserved' THEN reservation_nanos ELSE 0 END),0) AS reserved_nanos,
    COALESCE(SUM(charged_nanos),0) AS used_nanos,
    COALESCE(SUM(CASE WHEN state = 'settled' THEN charged_nanos ELSE 0 END),0) AS measured_nanos,
    COALESCE(SUM(CASE WHEN state = 'uncertain' THEN charged_nanos ELSE 0 END),0) AS uncertain_nanos
    FROM ai_allowance_ledger WHERE user_id = ?`).bind(userId).first<{ reserved_nanos: number; used_nanos: number; measured_nanos: number; uncertain_nanos: number }>();
  if (!totals) throw new Error('Unable to read the hosted AI allowance.');
  for (const amount of Object.values(totals)) nanos(amount, 0);
  const remaining = AI_ALLOWANCE_LIMIT_NANOS - totals.used_nanos - totals.reserved_nanos;
  if (remaining < 0) throw new Error('Hosted AI allowance accounting is inconsistent.');
  return { available: remaining > 0, limit_nanos: AI_ALLOWANCE_LIMIT_NANOS, ...totals, remaining_nanos: remaining, period: 'lifetime', resets_at: null, accounting_basis: 'provider_usage_with_conservative_reservations' };
}

async function reservation(db: Database, userId: string, requestId: string) {
  return db.prepare('SELECT * FROM ai_allowance_ledger WHERE user_id = ? AND request_id = ?').bind(userId, requestId).first<AiAllowanceReservation>();
}

/**
 * Only `admitted: true` authorizes ONE upstream attempt. A duplicate is never a
 * fresh authorization, including duplicates of released or uncertain requests.
 * The budget predicate and insertion are one SQLite write statement: no stale
 * read-then-write window and no Worker-local lock. D1 serializes database writes.
 * See https://developers.cloudflare.com/d1/reference/faq/ .
 */
export async function reserveAiAllowance(db: Database, input: ReserveAiAllowanceInput) {
  identifier(input.userId, 'user ID'); identifier(input.requestId, 'request ID'); identifier(input.projectId, 'project ID'); nanos(input.reservationNanos, 1);
  const inserted = await db.prepare(`INSERT INTO ai_allowance_ledger
    (user_id,request_id,project_id,reservation_nanos,charged_nanos,state,accounting_basis,created_at)
    SELECT ?,?,?,?,0,'reserved','reserved_upper_bound',?
    WHERE ? <= ? - COALESCE((SELECT SUM(CASE WHEN state = 'reserved' THEN reservation_nanos ELSE charged_nanos END)
      FROM ai_allowance_ledger WHERE user_id = ?),0)
    ON CONFLICT(user_id,request_id) DO NOTHING
    RETURNING *`).bind(input.userId, input.requestId, input.projectId, input.reservationNanos, new Date().toISOString(), input.reservationNanos, AI_ALLOWANCE_LIMIT_NANOS, input.userId).first<AiAllowanceReservation>();
  const existing = inserted ?? await reservation(db, input.userId, input.requestId);
  return { admitted: inserted !== null, duplicate: inserted === null && existing !== null, reservation: existing, allowance: await getAiAllowance(db, input.userId) };
}

/**
 * Provider-measured amounts may release the unused bound. Unknown usage,
 * timeouts, malformed responses and interrupted calls must use `uncertain` (or
 * leave the reservation held), never `not_billed`. There is no expiry or reset.
 * A terminal outcome is immutable, so retries cannot double-charge or refund.
 */
export async function settleAiAllowance(db: Database, input: SettleAiAllowanceInput) {
  identifier(input.userId, 'user ID'); identifier(input.requestId, 'request ID');
  if (input.outcome !== 'measured' && input.outcome !== 'uncertain' && input.outcome !== 'not_billed') throw new TypeError('A supported allowance outcome is required.');
  if (input.outcome === 'measured') nanos(input.actualNanos, 0);
  const state = input.outcome === 'measured' ? 'settled' : input.outcome === 'uncertain' ? 'uncertain' : 'released';
  const basis = input.outcome === 'measured' ? 'provider_usage' : input.outcome === 'uncertain' ? 'conservative_upper_bound' : 'known_not_billed';
  const actual = input.outcome === 'measured' ? input.actualNanos : 0;
  const updated = await db.prepare(`UPDATE ai_allowance_ledger
    SET state = ?, accounting_basis = ?, charged_nanos = CASE WHEN ? = 'uncertain' THEN reservation_nanos ELSE ? END, settled_at = ?
    WHERE user_id = ? AND request_id = ? AND state = 'reserved' AND ? <= reservation_nanos
    RETURNING *`).bind(state, basis, state, actual, new Date().toISOString(), input.userId, input.requestId, actual).first<AiAllowanceReservation>();
  const existing = updated ?? await reservation(db, input.userId, input.requestId);
  if (!existing) throw new Error('Hosted AI allowance reservation was not found.');
  if (existing.state === 'reserved') throw new RangeError('Measured cost exceeds the hosted AI reservation.');
  return { changed: updated !== null, reservation: existing, allowance: await getAiAllowance(db, input.userId) };
}
