-- =============================================
-- 046: Create token_blacklist table in Supabase
-- =============================================
-- Required for web dashboard auth middleware to check revoked tokens.
-- Without this table, the fail-closed blacklist check blocks all logins.

CREATE TABLE IF NOT EXISTS token_blacklist (
  id BIGSERIAL PRIMARY KEY,
  jti TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  user_type TEXT DEFAULT 'klient',
  expires_at TIMESTAMPTZ NOT NULL,
  reason TEXT DEFAULT 'logout',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_jti ON token_blacklist(jti);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);

-- RLS: service_role can manage, authenticated can read their own
ALTER TABLE token_blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on token_blacklist" ON token_blacklist;
CREATE POLICY "Service role full access on token_blacklist"
  ON token_blacklist FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
