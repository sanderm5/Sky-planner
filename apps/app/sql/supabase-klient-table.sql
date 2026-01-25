-- Klient-tabell for portal-innlogging
-- Kjør dette i Supabase SQL Editor

CREATE TABLE IF NOT EXISTS klient (
  id SERIAL PRIMARY KEY,
  navn TEXT NOT NULL,
  epost TEXT NOT NULL UNIQUE,
  passord_hash TEXT NOT NULL,
  telefon TEXT,
  aktiv BOOLEAN DEFAULT true,
  sist_innlogget TIMESTAMP WITH TIME ZONE,
  opprettet TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Legg til index for raskere oppslag
CREATE INDEX IF NOT EXISTS idx_klient_epost ON klient(epost);

-- VIKTIG: Opprett klient med bcrypt-hashet passord
-- Bruk scripts/create-user.js for å opprette bruker med sikkert passord:
--   node scripts/create-user.js
--
-- Eller generer hash manuelt i Node.js:
--   const bcrypt = require('bcryptjs');
--   const hash = await bcrypt.hash('ditt-passord', 10);
--   console.log(hash);
--
-- Deretter kjør:
-- INSERT INTO klient (navn, epost, passord_hash, telefon)
-- VALUES ('Firmanavn', 'epost@example.com', '<BCRYPT_HASH_HER>', NULL);
