-- Migration: 021_prosjektnummer.sql
-- Legg til prosjektnummer-kolonne for Tripletex-integrasjon

ALTER TABLE kunder ADD COLUMN IF NOT EXISTS prosjektnummer TEXT;
