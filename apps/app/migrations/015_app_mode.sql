-- Migration: 015_app_mode.sql
-- Beskrivelse: Legger til app_mode for å skille mellom MVP og full versjon
-- MVP = enkel versjon for nye kunder
-- Full = komplett versjon (TRE Allservice)

-- Legg til app_mode kolonne
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS app_mode TEXT DEFAULT 'mvp';

-- Sett TRE Allservice til full mode (juster navn om nødvendig)
UPDATE organizations SET app_mode = 'full' WHERE navn ILIKE '%tre allservice%';

-- Kommentar for dokumentasjon
COMMENT ON COLUMN organizations.app_mode IS 'mvp = enkel versjon, full = komplett versjon med el/brann/integrasjoner';
