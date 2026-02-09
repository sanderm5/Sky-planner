-- Migration: 020_integration_tables.sql
-- Oppretter tabeller for regnskapsintegrasjoner (Tripletex, Fiken, PowerOffice)

-- Integrasjonskredentials per organisasjon
CREATE TABLE IF NOT EXISTS organization_integrations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  sync_frequency_hours INTEGER DEFAULT 24,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, integration_id)
);

CREATE INDEX IF NOT EXISTS idx_org_integrations_org ON organization_integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_integrations_active ON organization_integrations(organization_id, is_active);

-- Synkroniseringslogg
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  unchanged_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_log_org ON integration_sync_log(organization_id, integration_id);

-- Legg til external_source og external_id på kunder for synkronisering
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kunder_external ON kunder(organization_id, external_source, external_id);

-- RLS policies
ALTER TABLE organization_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_integrations_tenant_policy" ON organization_integrations;
CREATE POLICY "org_integrations_tenant_policy" ON organization_integrations
  USING (organization_id = current_setting('app.current_organization_id', true)::integer);

DROP POLICY IF EXISTS "sync_log_tenant_policy" ON integration_sync_log;
CREATE POLICY "sync_log_tenant_policy" ON integration_sync_log
  USING (organization_id = current_setting('app.current_organization_id', true)::integer);
