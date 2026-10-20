ALTER TABLE users ADD COLUMN password_enabled INTEGER NOT NULL DEFAULT 1 CHECK(password_enabled IN (0,1));

CREATE TABLE oauth_identities (
  provider TEXT NOT NULL CHECK(provider='google'),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(provider,subject),
  UNIQUE(provider,user_id)
);

-- Only short-lived login proof is persisted. Google access, refresh and ID tokens are never stored.
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  cookie_hash TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  intent TEXT NOT NULL CHECK(intent IN ('login','signup','link')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);
