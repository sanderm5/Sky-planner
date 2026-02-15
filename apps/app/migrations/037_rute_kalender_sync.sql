-- Migration 037: Rute → Kalender auto-synk
-- Legg til rute_id og varighet på avtaler for automatisk opprettelse
-- av kalenderoppføringer når en rute tildeles en tekniker

ALTER TABLE avtaler ADD COLUMN IF NOT EXISTS rute_id INTEGER REFERENCES ruter(id) ON DELETE SET NULL;
ALTER TABLE avtaler ADD COLUMN IF NOT EXISTS varighet INTEGER; -- minutter

CREATE INDEX IF NOT EXISTS idx_avtaler_rute ON avtaler(rute_id);
