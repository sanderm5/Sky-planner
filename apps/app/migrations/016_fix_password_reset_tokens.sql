-- Migration: Fix password_reset_tokens table schema
-- The TypeScript code expects different column names than the original schema

-- Step 1: Rename 'token' column to 'token_hash'
ALTER TABLE password_reset_tokens RENAME COLUMN token TO token_hash;

-- Step 2: Drop the 'used' boolean column
ALTER TABLE password_reset_tokens DROP COLUMN IF EXISTS used;

-- Step 3: Add 'used_at' timestamp column
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

-- Step 4: Drop the 'epost' column (not needed, user_id references the user)
ALTER TABLE password_reset_tokens DROP COLUMN IF EXISTS epost;

-- Step 5: Update index name to match new column name
DROP INDEX IF EXISTS idx_reset_tokens_token;
CREATE INDEX IF NOT EXISTS idx_reset_tokens_token_hash ON password_reset_tokens(token_hash);

-- Step 6: Update cleanup function to use new column name
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM auth_tokens WHERE expires_at < NOW();
  DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
