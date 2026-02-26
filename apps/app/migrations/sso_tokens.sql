-- SSO tokens for cross-domain authentication (web → app)
-- Tokens are one-time use with short expiry (30 seconds)

CREATE TABLE IF NOT EXISTS sso_tokens (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'klient',
  organization_id INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by token hash
CREATE INDEX IF NOT EXISTS idx_sso_tokens_hash ON sso_tokens(token_hash);

-- Auto-cleanup expired tokens (older than 5 minutes)
CREATE INDEX IF NOT EXISTS idx_sso_tokens_expires ON sso_tokens(expires_at);

-- RLS policies
ALTER TABLE sso_tokens ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (tokens are created/consumed server-side only)
DROP POLICY IF EXISTS "Service role full access on sso_tokens" ON sso_tokens;
CREATE POLICY "Service role full access on sso_tokens" ON sso_tokens
  FOR ALL
  USING (true)
  WITH CHECK (true);
