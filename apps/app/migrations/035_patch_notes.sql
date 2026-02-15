-- Migration 035: Patch Notes / Changelog system
-- Viser nye funksjoner og endringer til brukere, filtrert etter MVP/full synlighet

CREATE TABLE IF NOT EXISTS patch_notes (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  aktiv BOOLEAN DEFAULT true
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_patch_notes_published ON patch_notes(published_at DESC) WHERE aktiv = true;

-- RLS
ALTER TABLE patch_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patch_notes_read ON patch_notes;
CREATE POLICY patch_notes_read ON patch_notes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS patch_notes_write ON patch_notes;
CREATE POLICY patch_notes_write ON patch_notes
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Ingen seed-data: patch notes legges til ved hver reelle utrulling.
-- Eksempel på INSERT for ny oppdatering:
--
-- INSERT INTO patch_notes (version, title, summary, items) VALUES
--   ('v1.1.0', 'Ny oppdatering', 'Kort beskrivelse av oppdateringen.',
--    '[
--      {"text": "Beskrivelse av ny funksjon", "type": "nytt", "visibility": "mvp"},
--      {"text": "Pro-funksjon", "type": "nytt", "visibility": "full", "feature_key": "feature_key"},
--      {"text": "Forbedring", "type": "forbedring", "visibility": "mvp"},
--      {"text": "Bugfiks", "type": "fiks", "visibility": "mvp"}
--    ]'::jsonb);
