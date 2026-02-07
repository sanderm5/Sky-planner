-- 014_two_factor_auth.sql
-- Optional Two-Factor Authentication (TOTP)

-- ============ Add 2FA columns to klienter ============

ALTER TABLE klienter
ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT,
ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS backup_codes_hash TEXT[],
ADD COLUMN IF NOT EXISTS totp_recovery_codes_used INTEGER DEFAULT 0;

-- ============ Add 2FA columns to brukere ============

ALTER TABLE brukere
ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT,
ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS backup_codes_hash TEXT[],
ADD COLUMN IF NOT EXISTS totp_recovery_codes_used INTEGER DEFAULT 0;

-- ============ 2FA session tokens ============
-- Short-lived tokens for 2FA verification during login

CREATE TABLE IF NOT EXISTS totp_pending_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('klient', 'bruker')),
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_totp_pending_sessions_expires
  ON totp_pending_sessions(expires_at);

-- Index for lookup
CREATE INDEX IF NOT EXISTS idx_totp_pending_sessions_token
  ON totp_pending_sessions(session_token_hash);

-- ============ 2FA audit log ============

CREATE TABLE IF NOT EXISTS totp_audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('klient', 'bruker')),
  action VARCHAR(50) NOT NULL CHECK (action IN (
    'setup_initiated',
    'setup_completed',
    'setup_cancelled',
    'verification_success',
    'verification_failed',
    'backup_code_used',
    'disabled',
    'recovery_initiated'
  )),
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user audit trail
CREATE INDEX IF NOT EXISTS idx_totp_audit_user
  ON totp_audit_log(user_id, user_type, created_at DESC);

-- ============ Cleanup function for expired pending sessions ============

CREATE OR REPLACE FUNCTION cleanup_expired_totp_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM totp_pending_sessions
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ============ RLS policies ============

ALTER TABLE totp_pending_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE totp_audit_log ENABLE ROW LEVEL SECURITY;

-- Only service role can access these tables
CREATE POLICY totp_pending_service_only ON totp_pending_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY totp_audit_service_only ON totp_audit_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============ Comments ============

COMMENT ON COLUMN klienter.totp_secret_encrypted IS 'Encrypted TOTP secret (AES-256-GCM)';
COMMENT ON COLUMN klienter.totp_enabled IS 'Whether 2FA is enabled for this user';
COMMENT ON COLUMN klienter.backup_codes_hash IS 'Hashed backup recovery codes';
COMMENT ON TABLE totp_pending_sessions IS 'Short-lived sessions for 2FA verification during login';
COMMENT ON TABLE totp_audit_log IS 'Audit trail for all 2FA-related actions';
