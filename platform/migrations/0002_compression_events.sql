CREATE TABLE IF NOT EXISTS compression_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL,
  source TEXT NOT NULL,
  input_bytes INTEGER NOT NULL,
  output_bytes INTEGER NOT NULL,
  original_tokens_estimate INTEGER NOT NULL,
  optimized_tokens_estimate INTEGER NOT NULL,
  estimated_saved_tokens INTEGER NOT NULL,
  token_basis TEXT NOT NULL DEFAULT 'estimated' CHECK(token_basis='estimated'),
  recovery_handle TEXT,
  recovery_location TEXT NOT NULL CHECK(recovery_location IN ('server','client')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS compression_events_project_date ON compression_events(project_id,created_at DESC);
