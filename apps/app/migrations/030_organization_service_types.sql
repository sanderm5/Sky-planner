-- Migration 030: Organization-specific service types
-- Replaces hardcoded El-Kontroll/Brannvarsling with per-org configurable categories
-- Service types can be created manually, from templates, or auto-imported from Tripletex

CREATE TABLE IF NOT EXISTS organization_service_types (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT DEFAULT 'fa-wrench',
  color TEXT DEFAULT '#F97316',
  default_interval_months INTEGER DEFAULT 12,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  aktiv BOOLEAN DEFAULT true,
  source TEXT DEFAULT 'manual',  -- 'template', 'manual', 'tripletex'
  source_ref TEXT,               -- template_service_type_id or tripletex category name
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_org_service_types_org ON organization_service_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_service_types_active ON organization_service_types(organization_id) WHERE aktiv = true;

-- RLS
ALTER TABLE organization_service_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_service_types_read ON organization_service_types;
CREATE POLICY org_service_types_read ON organization_service_types
  FOR SELECT USING (true);

DROP POLICY IF EXISTS org_service_types_write ON organization_service_types;
CREATE POLICY org_service_types_write ON organization_service_types
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Seed step 1: Copy template service types for orgs that have an industry template
INSERT INTO organization_service_types (organization_id, name, slug, icon, color, default_interval_months, description, sort_order, source, source_ref)
SELECT o.id, tst.name, tst.slug, tst.icon, tst.color, tst.default_interval_months, tst.description, tst.sort_order, 'template', tst.id::text
FROM organizations o
JOIN template_service_types tst ON tst.template_id = o.industry_template_id
WHERE o.industry_template_id IS NOT NULL AND tst.aktiv = true
ON CONFLICT (organization_id, slug) DO NOTHING;

-- Seed step 2: For orgs WITHOUT industry_template_id (e.g. Tre Allservice),
-- give them the default 'el-kontroll-brannvarsling' template service types
INSERT INTO organization_service_types (organization_id, name, slug, icon, color, default_interval_months, description, sort_order, source, source_ref)
SELECT o.id, tst.name, tst.slug, tst.icon, tst.color, tst.default_interval_months, tst.description, tst.sort_order, 'template', tst.id::text
FROM organizations o
CROSS JOIN template_service_types tst
JOIN industry_templates it ON tst.template_id = it.id AND it.slug = 'el-kontroll-brannvarsling'
WHERE tst.aktiv = true
AND NOT EXISTS (
  SELECT 1 FROM organization_service_types ost WHERE ost.organization_id = o.id
)
ON CONFLICT (organization_id, slug) DO NOTHING;
