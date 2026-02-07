-- =====================================================
-- SKY PLANNER - Email Verification
-- Migration: 012_email_verification.sql
-- =====================================================
-- Adds email verification support for user accounts
-- =====================================================

-- Add email verification fields to klient table
ALTER TABLE klient
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verification_token_hash TEXT,
ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMP WITH TIME ZONE;

-- Add email verification fields to brukere table (team members)
ALTER TABLE brukere
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verification_token_hash TEXT,
ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMP WITH TIME ZONE;

-- Create index for efficient token lookups
CREATE INDEX IF NOT EXISTS idx_klient_verification_token ON klient(verification_token_hash) WHERE verification_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brukere_verification_token ON brukere(verification_token_hash) WHERE verification_token_hash IS NOT NULL;

-- Function to clean up expired verification tokens
CREATE OR REPLACE FUNCTION cleanup_expired_verification_tokens()
RETURNS INTEGER AS $$
DECLARE
  klient_count INTEGER;
  brukere_count INTEGER;
BEGIN
  -- Clean klient table
  UPDATE klient
  SET verification_token_hash = NULL, verification_expires_at = NULL
  WHERE verification_expires_at < NOW() AND verification_token_hash IS NOT NULL;
  GET DIAGNOSTICS klient_count = ROW_COUNT;

  -- Clean brukere table
  UPDATE brukere
  SET verification_token_hash = NULL, verification_expires_at = NULL
  WHERE verification_expires_at < NOW() AND verification_token_hash IS NOT NULL;
  GET DIAGNOSTICS brukere_count = ROW_COUNT;

  RETURN klient_count + brukere_count;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION cleanup_expired_verification_tokens() TO service_role;

-- =====================================================
-- END OF MIGRATION
-- =====================================================
