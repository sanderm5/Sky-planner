-- Migration 058: Aggressive cleanup of duplicate routes AND avtaler
-- Run migration 057 first to backfill planned_date.

-- =============================================
-- PART A: Clean up duplicate ROUTES
-- =============================================

-- Step A1: Delete avtaler referencing duplicate routes (keep newest route per group)
DELETE FROM avtaler
WHERE rute_id IN (
  SELECT r.id
  FROM ruter r
  INNER JOIN (
    SELECT organization_id, COALESCE(planned_date, planlagt_dato) AS eff_date, navn, MAX(id) AS keep_id
    FROM ruter
    WHERE COALESCE(planned_date, planlagt_dato) IS NOT NULL
    GROUP BY organization_id, COALESCE(planned_date, planlagt_dato), navn
    HAVING COUNT(*) > 1
  ) dups
  ON r.organization_id = dups.organization_id
    AND COALESCE(r.planned_date, r.planlagt_dato) = dups.eff_date
    AND r.navn = dups.navn
    AND r.id < dups.keep_id
);

-- Step A2: Delete rute_kunder referencing duplicate routes
DELETE FROM rute_kunder
WHERE rute_id IN (
  SELECT r.id
  FROM ruter r
  INNER JOIN (
    SELECT organization_id, COALESCE(planned_date, planlagt_dato) AS eff_date, navn, MAX(id) AS keep_id
    FROM ruter
    WHERE COALESCE(planned_date, planlagt_dato) IS NOT NULL
    GROUP BY organization_id, COALESCE(planned_date, planlagt_dato), navn
    HAVING COUNT(*) > 1
  ) dups
  ON r.organization_id = dups.organization_id
    AND COALESCE(r.planned_date, r.planlagt_dato) = dups.eff_date
    AND r.navn = dups.navn
    AND r.id < dups.keep_id
);

-- Step A3: Delete rute_kunde_visits referencing duplicate routes
DELETE FROM rute_kunde_visits
WHERE rute_id IN (
  SELECT r.id
  FROM ruter r
  INNER JOIN (
    SELECT organization_id, COALESCE(planned_date, planlagt_dato) AS eff_date, navn, MAX(id) AS keep_id
    FROM ruter
    WHERE COALESCE(planned_date, planlagt_dato) IS NOT NULL
    GROUP BY organization_id, COALESCE(planned_date, planlagt_dato), navn
    HAVING COUNT(*) > 1
  ) dups
  ON r.organization_id = dups.organization_id
    AND COALESCE(r.planned_date, r.planlagt_dato) = dups.eff_date
    AND r.navn = dups.navn
    AND r.id < dups.keep_id
);

-- Step A4: Delete the duplicate routes themselves
DELETE FROM ruter
WHERE id IN (
  SELECT r.id
  FROM ruter r
  INNER JOIN (
    SELECT organization_id, COALESCE(planned_date, planlagt_dato) AS eff_date, navn, MAX(id) AS keep_id
    FROM ruter
    WHERE COALESCE(planned_date, planlagt_dato) IS NOT NULL
    GROUP BY organization_id, COALESCE(planned_date, planlagt_dato), navn
    HAVING COUNT(*) > 1
  ) dups
  ON r.organization_id = dups.organization_id
    AND COALESCE(r.planned_date, r.planlagt_dato) = dups.eff_date
    AND r.navn = dups.navn
    AND r.id < dups.keep_id
);

-- =============================================
-- PART B: Clean up duplicate AVTALER directly
-- Even if routes are unique, avtaler may have been duplicated
-- =============================================

-- Step B1: Delete duplicate avtaler (same org + kunde + dato + klokkeslett)
-- Keep the one with the highest ID in each duplicate group
DELETE FROM avtaler
WHERE id IN (
  SELECT a.id
  FROM avtaler a
  INNER JOIN (
    SELECT organization_id, kunde_id, dato, klokkeslett, MAX(id) AS keep_id
    FROM avtaler
    WHERE kunde_id IS NOT NULL
      AND dato IS NOT NULL
      AND klokkeslett IS NOT NULL
    GROUP BY organization_id, kunde_id, dato, klokkeslett
    HAVING COUNT(*) > 1
  ) dups
  ON a.organization_id = dups.organization_id
    AND a.kunde_id = dups.kunde_id
    AND a.dato = dups.dato
    AND a.klokkeslett = dups.klokkeslett
    AND a.id < dups.keep_id
);

-- =============================================
-- PART C: Clean up orphans
-- =============================================

-- Step C1: Delete avtaler referencing non-existent routes
DELETE FROM avtaler
WHERE rute_id IS NOT NULL
  AND rute_id NOT IN (SELECT id FROM ruter);

-- Step C2: Delete rute_kunder referencing non-existent routes
DELETE FROM rute_kunder
WHERE rute_id NOT IN (SELECT id FROM ruter);

-- =============================================
-- PART D: Sync date columns + add constraints
-- =============================================

-- Step D1: Ensure planned_date is synced (in case 057 wasn't run)
UPDATE ruter SET planned_date = planlagt_dato
WHERE planned_date IS NULL AND planlagt_dato IS NOT NULL;

UPDATE ruter SET planlagt_dato = planned_date
WHERE planlagt_dato IS NULL AND planned_date IS NOT NULL;

-- Step D2: Create unique partial index to prevent future route duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_ruter_unique_name_date_org
ON ruter (organization_id, navn, planned_date)
WHERE planned_date IS NOT NULL;
