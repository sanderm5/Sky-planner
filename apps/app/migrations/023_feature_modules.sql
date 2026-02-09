-- Migration 023: Feature module system
-- Simple feature flags per organization
-- Features are either default (everyone gets them) or custom (explicitly enabled per org)

-- Feature definitions catalog
CREATE TABLE IF NOT EXISTS feature_definitions (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,                          -- kart, integrasjon, feltarbeid, kommunikasjon
  default_enabled BOOLEAN DEFAULT false,  -- true = all orgs get this, false = only explicitly enabled orgs
  dependencies TEXT[],                    -- feature keys this depends on
  config_schema JSONB,                    -- optional JSON schema for feature config
  aktiv BOOLEAN DEFAULT true,             -- global kill switch
  sort_order INTEGER DEFAULT 0
);

-- Per-organization feature activation
CREATE TABLE IF NOT EXISTS organization_features (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES feature_definitions(key) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  config JSONB DEFAULT '{}',
  activated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_org_features_org ON organization_features(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_features_enabled ON organization_features(organization_id, feature_key) WHERE enabled = true;

-- RLS
ALTER TABLE feature_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_definitions_read ON feature_definitions;
CREATE POLICY feature_definitions_read ON feature_definitions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS feature_definitions_write ON feature_definitions;
CREATE POLICY feature_definitions_write ON feature_definitions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS org_features_service ON organization_features;
CREATE POLICY org_features_service ON organization_features
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Seed features — all default_enabled = true (available to all orgs)
INSERT INTO feature_definitions (key, name, description, category, default_enabled, dependencies, sort_order) VALUES
  ('hover_tooltip',      'Hover-tooltip',          'Vis kundeinfo ved hover/trykk på kartmarkorer',                    'kart',           true, NULL, 10),
  ('context_menu',       'Kontekstmeny',           'Hoyreklikk-meny på kartmarkorer med handlinger',                   'kart',           true, NULL, 20),
  ('lifecycle_colors',   'Livssyklus-fargekoding', 'Dynamisk fargekoding basert på kundestatus og besokshistorikk',    'kart',           true, NULL, 30),
  ('tripletex_projects', 'Tripletex-prosjekter',   'Opprett og synkroniser prosjekter i Tripletex fra kartet',         'integrasjon',    true, ARRAY['context_menu'], 40),
  ('field_work',         'Feltarbeid-modus',       'Utfor ruter med kundebesok, kommentarer og materiellregistrering', 'feltarbeid',     true, NULL, 50),
  ('email_templates',    'E-postmaler',            'Send e-post til kunder med konfigurerbare maler',                  'kommunikasjon',  true, NULL, 60),
  ('ekk_integration',    'EKK/IKK-integrasjon',    'Integrasjon med EKK rapportsystem for kontrollrapporter',          'integrasjon',    true, NULL, 70),
  ('outlook_sync',       'Outlook-synk',           'Synkroniser kundekontakter til Microsoft Outlook',                 'integrasjon',    true, NULL, 80)
ON CONFLICT (key) DO NOTHING;

-- Enable all features for ALL existing orgs
INSERT INTO organization_features (organization_id, feature_key, enabled, config)
SELECT o.id, fd.key, true, '{}'::jsonb
FROM organizations o
CROSS JOIN feature_definitions fd
WHERE fd.aktiv = true
ON CONFLICT (organization_id, feature_key) DO NOTHING;
