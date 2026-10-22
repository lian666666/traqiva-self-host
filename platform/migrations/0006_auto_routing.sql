CREATE TABLE IF NOT EXISTS project_auto_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE traces ADD COLUMN routing_json TEXT;
