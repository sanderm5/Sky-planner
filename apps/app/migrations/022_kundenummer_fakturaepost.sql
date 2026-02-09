-- Migration: 022_kundenummer_fakturaepost.sql
-- Legger til kundenummer og faktura_epost på kunder for integrasjonsimport

ALTER TABLE kunder ADD COLUMN IF NOT EXISTS kundenummer TEXT;
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS faktura_epost TEXT;
