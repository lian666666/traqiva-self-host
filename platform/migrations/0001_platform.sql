PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 365),
  mode TEXT NOT NULL DEFAULT 'observe' CHECK(mode IN ('observe','optimize')),
  autopilot TEXT NOT NULL DEFAULT 'off' CHECK(autopilot IN ('off','suggest')),
  monthly_budget REAL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner', PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_workspace ON projects(workspace_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_keys (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
  created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('success','error')),
  http_status INTEGER, input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER,
  latency_ms REAL NOT NULL DEFAULT 0, cost_usd REAL, cost_basis TEXT NOT NULL DEFAULT 'unavailable',
  input_bytes INTEGER NOT NULL DEFAULT 0, output_bytes INTEGER NOT NULL DEFAULT 0,
  original_tokens INTEGER, optimized_tokens INTEGER,
  token_basis TEXT NOT NULL DEFAULT 'unavailable' CHECK(token_basis IN ('provider','estimated','unavailable')),
  saved_tokens INTEGER, created_at TEXT NOT NULL, source TEXT NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 0, algorithm TEXT, request_json TEXT, response_json TEXT
);
CREATE INDEX IF NOT EXISTS traces_project_date ON traces(project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS traces_project_model ON traces(project_id,model);
CREATE TABLE IF NOT EXISTS improvements (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','dismissed')),
  evidence_json TEXT NOT NULL, estimated_savings_tokens INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id,kind)
);
CREATE TABLE IF NOT EXISTS eval_suites (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, cases_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY, suite_id TEXT NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL, passed INTEGER NOT NULL, total INTEGER NOT NULL,
  results_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recoveries (
  handle TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recoveries_project ON recoveries(project_id);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT,
  action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
