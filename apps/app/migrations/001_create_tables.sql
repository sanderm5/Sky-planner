-- ============================================
-- SKY PLANNER - Multi-Industry Platform Schema
-- ============================================
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Industry Templates (Bransje-maler)
-- Stores pre-defined industry configurations
CREATE TABLE IF NOT EXISTS industry_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT 'fa-briefcase',
  color TEXT DEFAULT '#F97316',
  description TEXT,
  aktiv BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Template Service Types (Tjenestekategorier per bransje)
-- e.g., "El-Kontroll", "Brannvarsling" for El-bransjen
CREATE TABLE IF NOT EXISTS template_service_types (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES industry_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  default_interval_months INTEGER DEFAULT 12,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  aktiv BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(template_id, slug)
);

-- 3. Template Subtypes (Undertyper per tjeneste)
-- e.g., "Landbruk", "Næring", "Bolig" for El-Kontroll
CREATE TABLE IF NOT EXISTS template_subtypes (
  id SERIAL PRIMARY KEY,
  service_type_id INTEGER NOT NULL REFERENCES template_service_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  default_interval_months INTEGER,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  aktiv BOOLEAN DEFAULT true,
  UNIQUE(service_type_id, slug)
);

-- 4. Template Equipment (Utstyr/systemer per tjeneste)
-- e.g., "Elotec", "ICAS" for Brannvarsling
CREATE TABLE IF NOT EXISTS template_equipment (
  id SERIAL PRIMARY KEY,
  service_type_id INTEGER NOT NULL REFERENCES template_service_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  aktiv BOOLEAN DEFAULT true,
  UNIQUE(service_type_id, slug)
);

-- 5. Template Intervals (Tilgjengelige intervaller per bransje)
CREATE TABLE IF NOT EXISTS template_intervals (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES industry_templates(id) ON DELETE CASCADE,
  months INTEGER NOT NULL,
  label TEXT,
  is_default BOOLEAN DEFAULT false,
  UNIQUE(template_id, months)
);

-- 6. Customer Services (Kundens tjenester - erstatter hardkodede kolonner)
CREATE TABLE IF NOT EXISTS customer_services (
  id SERIAL PRIMARY KEY,
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  service_type_id INTEGER NOT NULL REFERENCES template_service_types(id),
  subtype_id INTEGER REFERENCES template_subtypes(id),
  equipment_type_id INTEGER REFERENCES template_equipment(id),
  siste_kontroll DATE,
  neste_kontroll DATE,
  intervall_months INTEGER,
  notater TEXT,
  aktiv BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(kunde_id, service_type_id)
);

-- 7. Add industry_template_id to organizations (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'industry_template_id'
  ) THEN
    ALTER TABLE organizations ADD COLUMN industry_template_id INTEGER REFERENCES industry_templates(id);
  END IF;
END $$;

-- 8. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_customer_services_kunde ON customer_services(kunde_id);
CREATE INDEX IF NOT EXISTS idx_customer_services_type ON customer_services(service_type_id);
CREATE INDEX IF NOT EXISTS idx_customer_services_neste ON customer_services(neste_kontroll);
CREATE INDEX IF NOT EXISTS idx_template_service_types_template ON template_service_types(template_id);

-- 9. Enable Row Level Security (RLS)
ALTER TABLE industry_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_subtypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_services ENABLE ROW LEVEL SECURITY;

-- 10. RLS Policies for industry_templates (readable by all, writable by admins)
CREATE POLICY IF NOT EXISTS "Industry templates are viewable by authenticated users"
  ON industry_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY IF NOT EXISTS "Industry templates are insertable by admins"
  ON industry_templates FOR INSERT
  TO authenticated
  WITH CHECK (true);  -- Adjust for proper admin check

-- 11. RLS Policies for template_service_types
CREATE POLICY IF NOT EXISTS "Service types are viewable by authenticated users"
  ON template_service_types FOR SELECT
  TO authenticated
  USING (true);

-- 12. RLS Policies for customer_services (organization-scoped)
CREATE POLICY IF NOT EXISTS "Customer services are viewable by organization members"
  ON customer_services FOR SELECT
  TO authenticated
  USING (
    kunde_id IN (
      SELECT id FROM kunder WHERE organization_id IN (
        SELECT organization_id FROM bruker WHERE id = auth.uid()
      )
    )
  );

-- ============================================
-- Seed Data: El-Kontroll + Brannvarsling
-- ============================================

-- Insert industry template
INSERT INTO industry_templates (name, slug, icon, color, description, sort_order)
VALUES (
  'El-Kontroll + Brannvarsling',
  'el-kontroll-brannvarsling',
  'fa-bolt',
  '#F97316',
  'Periodisk el-kontroll og brannvarsling for landbruk, næring og bolig',
  1
)
ON CONFLICT (slug) DO NOTHING;

-- Get template ID for subsequent inserts
DO $$
DECLARE
  v_template_id INTEGER;
  v_el_service_id INTEGER;
  v_brann_service_id INTEGER;
BEGIN
  SELECT id INTO v_template_id FROM industry_templates WHERE slug = 'el-kontroll-brannvarsling';

  -- Insert El-Kontroll service type
  INSERT INTO template_service_types (template_id, name, slug, icon, color, default_interval_months, description, sort_order)
  VALUES (v_template_id, 'El-Kontroll', 'el-kontroll', 'fa-bolt', '#F59E0B', 36, 'Periodisk kontroll av elektriske anlegg', 1)
  ON CONFLICT (template_id, slug) DO NOTHING;

  SELECT id INTO v_el_service_id FROM template_service_types WHERE template_id = v_template_id AND slug = 'el-kontroll';

  -- Insert El-Kontroll subtypes
  INSERT INTO template_subtypes (service_type_id, name, slug, default_interval_months, sort_order)
  VALUES
    (v_el_service_id, 'Landbruk', 'landbruk', 36, 1),
    (v_el_service_id, 'Næring', 'naering', 12, 2),
    (v_el_service_id, 'Bolig', 'bolig', 60, 3),
    (v_el_service_id, 'Gartneri', 'gartneri', 36, 4)
  ON CONFLICT (service_type_id, slug) DO NOTHING;

  -- Insert Brannvarsling service type
  INSERT INTO template_service_types (template_id, name, slug, icon, color, default_interval_months, description, sort_order)
  VALUES (v_template_id, 'Brannvarsling', 'brannvarsling', 'fa-fire', '#DC2626', 12, 'Årlig kontroll av brannvarslingssystemer', 2)
  ON CONFLICT (template_id, slug) DO NOTHING;

  SELECT id INTO v_brann_service_id FROM template_service_types WHERE template_id = v_template_id AND slug = 'brannvarsling';

  -- Insert Brannvarsling equipment types
  INSERT INTO template_equipment (service_type_id, name, slug, sort_order)
  VALUES
    (v_brann_service_id, 'Elotec', 'elotec', 1),
    (v_brann_service_id, 'ICAS', 'icas', 2),
    (v_brann_service_id, 'Elotec + ICAS', 'elotec-icas', 3),
    (v_brann_service_id, '2 x Elotec', '2x-elotec', 4)
  ON CONFLICT (service_type_id, slug) DO NOTHING;

  -- Insert control intervals
  INSERT INTO template_intervals (template_id, months, label, is_default)
  VALUES
    (v_template_id, 6, '6 mnd', false),
    (v_template_id, 12, '1 år', false),
    (v_template_id, 24, '2 år', false),
    (v_template_id, 36, '3 år', true),
    (v_template_id, 48, '4 år', false),
    (v_template_id, 60, '5 år', false)
  ON CONFLICT (template_id, months) DO NOTHING;

END $$;

-- ============================================
-- Done! Tables and seed data created
-- ============================================
