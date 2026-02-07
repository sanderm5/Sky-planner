-- SQL for å opprette avtaler-tabell i Supabase
-- Kjør dette i Supabase SQL Editor

CREATE TABLE IF NOT EXISTS avtaler (
  id SERIAL PRIMARY KEY,
  kunde_id INTEGER REFERENCES kunder(id) ON DELETE CASCADE,
  dato DATE NOT NULL,
  klokkeslett TIME,
  type VARCHAR(50),
  beskrivelse TEXT,
  status VARCHAR(20) DEFAULT 'planlagt',
  opprettet_av VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indekser for raskere søk
CREATE INDEX IF NOT EXISTS idx_avtaler_dato ON avtaler(dato);
CREATE INDEX IF NOT EXISTS idx_avtaler_kunde_id ON avtaler(kunde_id);
CREATE INDEX IF NOT EXISTS idx_avtaler_status ON avtaler(status);

-- RLS policies (Row Level Security)
ALTER TABLE avtaler ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON avtaler
  FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users" ON avtaler
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users" ON avtaler
  FOR UPDATE USING (true);

CREATE POLICY "Enable delete for authenticated users" ON avtaler
  FOR DELETE USING (true);
