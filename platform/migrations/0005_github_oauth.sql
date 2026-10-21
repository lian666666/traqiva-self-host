-- Preserve existing Google identities while extending the provider constraint.
-- No provider tokens are persisted; only stable provider/user identifiers are copied.
CREATE TABLE oauth_identities_next (
  provider TEXT NOT NULL CHECK(provider IN ('google','github')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(provider,subject),
  UNIQUE(provider,user_id)
);
INSERT INTO oauth_identities_next(provider,subject,user_id,created_at)
  SELECT provider,subject,user_id,created_at FROM oauth_identities;
DROP TABLE oauth_identities;
ALTER TABLE oauth_identities_next RENAME TO oauth_identities;

-- Pending pre-migration flows are Google flows. Callback consumption always
-- includes the provider, preventing one provider from consuming another's proof.
ALTER TABLE oauth_states ADD COLUMN provider TEXT NOT NULL DEFAULT 'google'
  CHECK(provider IN ('google','github'));
