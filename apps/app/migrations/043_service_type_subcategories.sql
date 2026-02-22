-- =============================================
-- 043: Service Type Subcategories
-- =============================================
-- Replaces the tag system with subcategories tied to service types.
-- Each service type can have multiple subcategory groups,
-- each group containing multiple subcategory options.
--
-- Example:
--   Service Type: "Brannvarsling"
--     Group: "Brannsystem" -> [Elotec, ICAS, ES 801]
--     Group: "Driftstype" -> [Sau/Geit, Storfe, Fjørfe]

-- Drop old tag tables (replaced by subcategories)
DROP TABLE IF EXISTS kunde_tags;
DROP TABLE IF EXISTS tags;

-- Subcategory groups per service type
CREATE TABLE IF NOT EXISTS service_type_subcat_groups (
  id SERIAL PRIMARY KEY,
  service_type_id INTEGER NOT NULL REFERENCES organization_service_types(id) ON DELETE CASCADE,
  navn TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(service_type_id, navn)
);

-- Subcategory options within a group
CREATE TABLE IF NOT EXISTS service_type_subcategories (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES service_type_subcat_groups(id) ON DELETE CASCADE,
  navn TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, navn)
);

-- Customer subcategory assignments (one per group per customer)
CREATE TABLE IF NOT EXISTS kunde_subcategories (
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES service_type_subcat_groups(id) ON DELETE CASCADE,
  subcategory_id INTEGER NOT NULL REFERENCES service_type_subcategories(id) ON DELETE CASCADE,
  PRIMARY KEY (kunde_id, group_id)
);

-- RLS (service_role only)
ALTER TABLE service_type_subcat_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subcat_groups_service_only ON service_type_subcat_groups;
CREATE POLICY subcat_groups_service_only ON service_type_subcat_groups
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE service_type_subcategories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subcategories_service_only ON service_type_subcategories;
CREATE POLICY subcategories_service_only ON service_type_subcategories
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE kunde_subcategories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kunde_subcats_service_only ON kunde_subcategories;
CREATE POLICY kunde_subcats_service_only ON kunde_subcategories
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subcat_groups_service_type ON service_type_subcat_groups(service_type_id);
CREATE INDEX IF NOT EXISTS idx_subcategories_group ON service_type_subcategories(group_id);
CREATE INDEX IF NOT EXISTS idx_kunde_subcats_kunde ON kunde_subcategories(kunde_id);
