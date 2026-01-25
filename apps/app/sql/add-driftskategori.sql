-- Legg til driftskategori kolonne i kunder tabellen
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS driftskategori TEXT;

-- Mulige verdier: Storfe, Sau, Geit, Gris, Storfe/Sau, Gartneri, Ingen, NULL
