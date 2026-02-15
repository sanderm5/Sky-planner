-- Migration 033: Date display mode per organization
-- Allows organizations to choose between full dates (DD.MM.YYYY) and month+year mode (mars 2025)

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS dato_modus TEXT DEFAULT 'full_date';

ALTER TABLE organizations ADD CONSTRAINT chk_dato_modus
  CHECK (dato_modus IN ('full_date', 'month_year'));
