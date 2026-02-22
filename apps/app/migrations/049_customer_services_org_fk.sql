-- =============================================
-- 049: Update customer_services FK to reference organization_service_types
-- =============================================
-- customer_services.service_type_id currently references template_service_types(id),
-- but the system now uses organization_service_types. This migration:
-- 1. Drops the old FK constraint
-- 2. Migrates existing service_type_id values to organization_service_types IDs
-- 3. Adds new FK referencing organization_service_types(id)

-- Step 1: Drop old FK constraint on service_type_id
-- The constraint name varies, so drop all FK constraints on customer_services.service_type_id
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'customer_services'
      AND kcu.column_name = 'service_type_id'
  LOOP
    EXECUTE format('ALTER TABLE customer_services DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

-- Step 2: Migrate existing rows from template_service_types IDs to organization_service_types IDs
-- Uses slug matching: template_service_types.slug → organization_service_types.slug
-- PostgreSQL UPDATE...FROM: all tables are comma-separated, joins use WHERE
UPDATE customer_services cs
SET service_type_id = ost.id
FROM template_service_types tst, kunder k, organization_service_types ost
WHERE cs.service_type_id = tst.id
  AND k.id = cs.kunde_id
  AND ost.organization_id = k.organization_id
  AND ost.slug = tst.slug;

-- Step 3: Delete orphaned rows that couldn't be migrated (no matching org service type)
DELETE FROM customer_services cs
WHERE NOT EXISTS (
  SELECT 1 FROM organization_service_types ost WHERE ost.id = cs.service_type_id
);

-- Step 4: Add new FK constraint referencing organization_service_types
ALTER TABLE customer_services
  ADD CONSTRAINT customer_services_org_service_type_fk
  FOREIGN KEY (service_type_id) REFERENCES organization_service_types(id) ON DELETE CASCADE;

-- Step 5: Add index for performance
CREATE INDEX IF NOT EXISTS idx_customer_services_org_type ON customer_services(service_type_id);
