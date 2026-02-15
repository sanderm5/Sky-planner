-- =============================================
-- 038: Account-level login lockout + TOTP replay prevention
-- =============================================
-- Tracks failed login attempts per email for account-level lockout
-- and adds TOTP replay prevention column

-- Login attempts tracking for account-level lockout
CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  epost TEXT NOT NULL,
  ip_address VARCHAR(45),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_epost_time ON login_attempts(epost, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_cleanup ON login_attempts(attempted_at);

-- RLS: only service role can access
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS login_attempts_service_only ON login_attempts;
CREATE POLICY login_attempts_service_only ON login_attempts
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- TOTP replay prevention: track last used time step
ALTER TABLE klient ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;
ALTER TABLE brukere ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;
