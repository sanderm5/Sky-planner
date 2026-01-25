-- ============================================
-- AUTH TABELLER FOR SKY PLANNER
-- Kjør dette i Supabase SQL Editor
-- ============================================

-- 1. BRUKERE (Admin/ansatte som bruker hovedappen)
CREATE TABLE IF NOT EXISTS brukere (
  id SERIAL PRIMARY KEY,
  navn TEXT NOT NULL,
  epost TEXT NOT NULL UNIQUE,
  passord_hash TEXT NOT NULL,
  rolle TEXT DEFAULT 'bruker',  -- 'admin', 'bruker'
  aktiv BOOLEAN DEFAULT true,
  sist_innlogget TIMESTAMP WITH TIME ZONE,
  opprettet TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brukere_epost ON brukere(epost);

-- 2. KLIENT (Den som har bestilt systemet - ser kun dashboard)
CREATE TABLE IF NOT EXISTS klient (
  id SERIAL PRIMARY KEY,
  navn TEXT NOT NULL,
  epost TEXT NOT NULL UNIQUE,
  passord_hash TEXT NOT NULL,
  telefon TEXT,
  firma TEXT,
  aktiv BOOLEAN DEFAULT true,
  sist_innlogget TIMESTAMP WITH TIME ZONE,
  opprettet TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_klient_epost ON klient(epost);

-- ============================================
-- EKSEMPEL DATA (oppdater passord før bruk!)
-- ============================================

-- Legg til admin bruker
-- Passord må hashes med bcrypt først!
-- INSERT INTO brukere (navn, epost, passord_hash, rolle)
-- VALUES ('Admin', 'admin@example.com', '$2b$10$...hash...', 'admin');

-- Legg til klient
-- INSERT INTO klient (navn, epost, passord_hash, firma)
-- VALUES ('Klient Navn', 'klient@example.no', '$2b$10$...hash...', 'Firma AS');

-- ============================================
-- FOR Å GENERERE PASSORD HASH:
-- ============================================
-- Kjør dette i Node.js:
--
-- const bcrypt = require('bcrypt');
-- bcrypt.hash('ditt-passord', 10).then(hash => console.log(hash));
--
