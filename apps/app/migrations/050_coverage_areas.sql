-- Coverage areas (dekningsomrader) for organizations
-- Supports isochrone (drive time) and radius (km) based coverage zones

CREATE TABLE IF NOT EXISTS coverage_areas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  navn TEXT NOT NULL DEFAULT 'Hovedområde',
  coverage_type TEXT NOT NULL CHECK (coverage_type IN ('isochrone', 'radius')),
  coverage_value NUMERIC NOT NULL,
  origin_lat DOUBLE PRECISION,
  origin_lng DOUBLE PRECISION,
  polygon_geojson JSONB,
  polygon_cached_at TIMESTAMPTZ,
  fill_color TEXT DEFAULT '#2563eb',
  fill_opacity NUMERIC DEFAULT 0.1,
  line_color TEXT DEFAULT '#2563eb',
  zone_priority INTEGER DEFAULT 0,
  aktiv BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coverage_areas_org ON coverage_areas(organization_id);

-- RLS policies
ALTER TABLE coverage_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coverage_areas_tenant_select" ON coverage_areas;
CREATE POLICY "coverage_areas_tenant_select" ON coverage_areas
  FOR SELECT USING (organization_id = current_setting('app.current_organization_id', true)::int);

DROP POLICY IF EXISTS "coverage_areas_tenant_insert" ON coverage_areas;
CREATE POLICY "coverage_areas_tenant_insert" ON coverage_areas
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::int);

DROP POLICY IF EXISTS "coverage_areas_tenant_update" ON coverage_areas;
CREATE POLICY "coverage_areas_tenant_update" ON coverage_areas
  FOR UPDATE USING (organization_id = current_setting('app.current_organization_id', true)::int);

DROP POLICY IF EXISTS "coverage_areas_tenant_delete" ON coverage_areas;
CREATE POLICY "coverage_areas_tenant_delete" ON coverage_areas
  FOR DELETE USING (organization_id = current_setting('app.current_organization_id', true)::int);
