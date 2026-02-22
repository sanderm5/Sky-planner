-- =============================================
-- 048: Decouple subcategory groups from service types
-- =============================================
-- Subcategory groups move from being per-service-type to per-organization.
-- This makes groups standalone, not tied to El-kontroll/Brannvarsling etc.

-- Step 1: Add organization_id column (nullable initially)
ALTER TABLE service_type_subcat_groups
  ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;

-- Step 2: Populate organization_id from existing service_type_id via organization_service_types
UPDATE service_type_subcat_groups g
SET organization_id = ost.organization_id
FROM organization_service_types ost
WHERE g.service_type_id = ost.id
  AND g.organization_id IS NULL;

-- Step 3: Handle duplicate group names within same org (before adding unique constraint)
-- Append " (2)", " (3)" etc. to duplicates, keeping the lowest id as original
WITH ranked AS (
  SELECT id, navn, organization_id,
    ROW_NUMBER() OVER (PARTITION BY organization_id, navn ORDER BY id) AS rn
  FROM service_type_subcat_groups
  WHERE organization_id IS NOT NULL
)
UPDATE service_type_subcat_groups
SET navn = service_type_subcat_groups.navn || ' (' || ranked.rn || ')'
FROM ranked
WHERE ranked.id = service_type_subcat_groups.id
  AND ranked.rn > 1;

-- Step 4: Make organization_id NOT NULL
ALTER TABLE service_type_subcat_groups
  ALTER COLUMN organization_id SET NOT NULL;

-- Step 5: Drop old unique constraint and add new one
ALTER TABLE service_type_subcat_groups
  DROP CONSTRAINT IF EXISTS service_type_subcat_groups_service_type_id_navn_key;

ALTER TABLE service_type_subcat_groups
  ADD CONSTRAINT service_type_subcat_groups_organization_id_navn_key
  UNIQUE(organization_id, navn);

-- Step 6: Drop service_type_id column (no longer needed)
ALTER TABLE service_type_subcat_groups
  DROP COLUMN IF EXISTS service_type_id;

-- Step 7: Update indexes
DROP INDEX IF EXISTS idx_subcat_groups_service_type;
CREATE INDEX IF NOT EXISTS idx_subcat_groups_organization
  ON service_type_subcat_groups(organization_id);
