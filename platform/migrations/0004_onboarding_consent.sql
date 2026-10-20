CREATE TABLE user_onboarding (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'goals' CHECK(stage IN ('goals','project','connect','complete')),
  goals_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(goals_json)),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO user_onboarding(user_id,created_at,updated_at) SELECT id,created_at,created_at FROM users;

CREATE TABLE workspace_terms_acceptances (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,version)
);
