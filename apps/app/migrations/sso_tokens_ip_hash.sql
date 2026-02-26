-- Add IP binding to SSO tokens for security
-- Token can only be redeemed from the same IP that created it
ALTER TABLE sso_tokens ADD COLUMN IF NOT EXISTS ip_hash TEXT;
