CREATE TABLE IF NOT EXISTS ask_conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,project_id,workspace_id,user_id)
);
CREATE INDEX IF NOT EXISTS ask_conversations_owner ON ask_conversations(project_id,workspace_id,user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS ask_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 12000),
  sources_json TEXT,
  model TEXT,
  method TEXT CHECK(method IS NULL OR method IN ('llm','rules')),
  created_at TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  FOREIGN KEY(conversation_id,project_id,workspace_id,user_id) REFERENCES ask_conversations(id,project_id,workspace_id,user_id) ON DELETE CASCADE,
  UNIQUE(conversation_id,sequence)
);
CREATE INDEX IF NOT EXISTS ask_messages_conversation ON ask_messages(conversation_id,sequence DESC);
