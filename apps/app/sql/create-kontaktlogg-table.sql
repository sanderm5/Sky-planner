-- SQL for å opprette kontaktlogg-tabell i Supabase
-- Kjør dette i Supabase SQL Editor

CREATE TABLE IF NOT EXISTS kontaktlogg (
  id SERIAL PRIMARY KEY,
  kunde_id INTEGER REFERENCES kunder(id) ON DELETE CASCADE,
  dato TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  type VARCHAR(50) DEFAULT 'Telefonsamtale',
  notat TEXT,
  opprettet_av VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indekser for raskere søk
CREATE INDEX IF NOT EXISTS idx_kontaktlogg_kunde_id ON kontaktlogg(kunde_id);
CREATE INDEX IF NOT EXISTS idx_kontaktlogg_dato ON kontaktlogg(dato);

-- RLS policies (Row Level Security)
ALTER TABLE kontaktlogg ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON kontaktlogg
  FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users" ON kontaktlogg
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users" ON kontaktlogg
  FOR UPDATE USING (true);

CREATE POLICY "Enable delete for authenticated users" ON kontaktlogg
  FOR DELETE USING (true);
