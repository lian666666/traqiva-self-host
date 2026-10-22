-- One lifetime allowance per authenticated user, shared across all projects.
-- Project deletion must not erase spending or release an in-flight request.
CREATE TABLE IF NOT EXISTS ai_allowance_ledger (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  reservation_nanos INTEGER NOT NULL CHECK(typeof(reservation_nanos) = 'integer' AND reservation_nanos BETWEEN 1 AND 1000000000),
  charged_nanos INTEGER NOT NULL DEFAULT 0 CHECK(typeof(charged_nanos) = 'integer' AND charged_nanos BETWEEN 0 AND reservation_nanos),
  state TEXT NOT NULL CHECK(state IN ('reserved','settled','uncertain','released')),
  accounting_basis TEXT NOT NULL CHECK(accounting_basis IN ('reserved_upper_bound','provider_usage','conservative_upper_bound','known_not_billed')),
  created_at TEXT NOT NULL,
  settled_at TEXT,
  PRIMARY KEY(user_id,request_id),
  CHECK(
    (state = 'reserved' AND charged_nanos = 0 AND accounting_basis = 'reserved_upper_bound' AND settled_at IS NULL)
    OR (state = 'settled' AND accounting_basis = 'provider_usage' AND settled_at IS NOT NULL)
    OR (state = 'uncertain' AND charged_nanos = reservation_nanos AND accounting_basis = 'conservative_upper_bound' AND settled_at IS NOT NULL)
    OR (state = 'released' AND charged_nanos = 0 AND accounting_basis = 'known_not_billed' AND settled_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ai_allowance_user_state ON ai_allowance_ledger(user_id,state);
