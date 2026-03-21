-- Migration 057: Sync planned_date with planlagt_dato
-- Backfill planned_date where it is NULL but planlagt_dato has a value.
-- This ensures all routes have a canonical planned_date column.

UPDATE ruter
SET planned_date = planlagt_dato
WHERE planned_date IS NULL
  AND planlagt_dato IS NOT NULL;

-- Also handle the reverse: if planned_date is set but planlagt_dato is not
UPDATE ruter
SET planlagt_dato = planned_date
WHERE planlagt_dato IS NULL
  AND planned_date IS NOT NULL;
