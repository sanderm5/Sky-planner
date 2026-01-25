-- Create login_logg table for tracking all login attempts
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS login_logg (
  id SERIAL PRIMARY KEY,
  epost TEXT NOT NULL,
  bruker_navn TEXT,
  bruker_type TEXT,  -- 'klient' eller 'bruker'
  status TEXT NOT NULL,  -- 'vellykket' eller 'feilet'
  ip_adresse TEXT,
  user_agent TEXT,
  feil_melding TEXT,
  tidspunkt TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_login_logg_tidspunkt ON login_logg(tidspunkt DESC);
CREATE INDEX IF NOT EXISTS idx_login_logg_epost ON login_logg(epost);
CREATE INDEX IF NOT EXISTS idx_login_logg_status ON login_logg(status);

-- Enable RLS
ALTER TABLE login_logg ENABLE ROW LEVEL SECURITY;

-- Policy: Only authenticated users can read (admin check done in app)
CREATE POLICY "Allow authenticated read" ON login_logg
  FOR SELECT USING (auth.role() = 'authenticated');

-- Policy: Service role can insert
CREATE POLICY "Allow service insert" ON login_logg
  FOR INSERT WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON login_logg TO authenticated;
GRANT INSERT ON login_logg TO anon;
GRANT INSERT ON login_logg TO authenticated;
