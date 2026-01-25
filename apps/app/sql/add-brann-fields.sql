-- SQL for å legge til brannvarsling-felt i kunder-tabellen
-- Kjør dette i Supabase SQL Editor

-- Brannvarsling systemtype (f.eks. Elotec)
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS brann_system VARCHAR(50);

-- Driftstype for brannvarsling (f.eks. Storfe)
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS brann_driftstype VARCHAR(50);

-- El-kontroll type (Landbruk, Bolig, etc.)
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS el_type VARCHAR(50);
