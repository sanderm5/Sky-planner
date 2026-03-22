-- Migration 060: Refresh tokens table for token rotation
-- Enables short-lived access tokens (1h) with long-lived refresh tokens (30d)
-- family_id groups a chain of rotated tokens for replay detection

-- Drop and recreate to ensure correct schema (table is new, no production data)
DROP TABLE IF EXISTS refresh_tokens;

CREATE TABLE refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('klient', 'bruker')),
  organization_id INTEGER,
  jti TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family_id ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Enable RLS
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can access refresh tokens (backend only)
CREATE POLICY "Service role full access on refresh_tokens"
  ON refresh_tokens
  FOR ALL
  USING (auth.role() = 'service_role');
