-- Existing unfinished setups must explicitly confirm the current product flow.
-- Progress is upgraded lazily without changing projects, traces or consent.
ALTER TABLE user_onboarding ADD COLUMN flow_version INTEGER NOT NULL DEFAULT 1 CHECK(flow_version >= 1);
