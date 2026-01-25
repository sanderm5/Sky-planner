-- =====================================================
-- SUPABASE MIGRATIONS FOR KLIENTPORTAL
-- Run these in your Supabase SQL Editor
-- =====================================================

-- 1. BRUKERE TABLE (Admin users)
CREATE TABLE IF NOT EXISTS brukere (
  id SERIAL PRIMARY KEY,
  navn TEXT NOT NULL,
  epost TEXT UNIQUE NOT NULL,
  passord_hash TEXT NOT NULL,
  rolle TEXT DEFAULT 'admin',
  aktiv BOOLEAN DEFAULT true,
  sist_innlogget TIMESTAMPTZ,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

-- 2. AUTH_TOKENS TABLE (Persistent session storage)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('klient', 'bruker')),
  epost TEXT NOT NULL,
  rolle TEXT DEFAULT 'klient',
  remember_me BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);

-- 3. PASSWORD_RESET_TOKENS TABLE
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('klient', 'bruker')),
  epost TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token);

-- 4. KONTROLL_HISTORIKK TABLE (History of past controls)
CREATE TABLE IF NOT EXISTS kontroll_historikk (
  id SERIAL PRIMARY KEY,
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  kontroll_dato DATE NOT NULL,
  utfort_av TEXT,
  kategori TEXT,
  notater TEXT,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kontroll_historikk_kunde ON kontroll_historikk(kunde_id);

-- 5. Add klient_id to kunder table for multi-location support
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS klient_id INTEGER REFERENCES klient(id);
CREATE INDEX IF NOT EXISTS idx_kunder_klient ON kunder(klient_id);

-- 6. Add columns to klient table for contact info editing
ALTER TABLE klient ADD COLUMN IF NOT EXISTS telefon TEXT;
ALTER TABLE klient ADD COLUMN IF NOT EXISTS adresse TEXT;
ALTER TABLE klient ADD COLUMN IF NOT EXISTS postnummer TEXT;
ALTER TABLE klient ADD COLUMN IF NOT EXISTS poststed TEXT;

-- 7. Function to clean up expired tokens (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM auth_tokens WHERE expires_at < NOW();
  DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = true;
END;
$$ LANGUAGE plpgsql;

-- 8. Enable RLS (Row Level Security) for auth_tokens
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access on auth_tokens" ON auth_tokens
  FOR ALL USING (true);

CREATE POLICY "Service role full access on password_reset_tokens" ON password_reset_tokens
  FOR ALL USING (true);
