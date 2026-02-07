-- ============================================
-- SKY PLANNER - Import System Tables (Combined)
-- ============================================
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard
-- This combines migrations 006 + 018
-- ============================================

-- 1. Import Mapping Templates (Lagrede mappinger per tenant)
CREATE TABLE IF NOT EXISTS import_mapping_templates (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  source_column_fingerprint TEXT NOT NULL,
  source_columns JSONB NOT NULL,
  mapping_config JSONB NOT NULL,
  ai_suggested BOOLEAN DEFAULT false,
  ai_confidence_score NUMERIC(3,2),
  human_confirmed BOOLEAN DEFAULT false,
  confirmed_by INTEGER,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  use_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

-- 2. Import Batches (Tracker hver filopplasting)
CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  original_file_url TEXT,
  column_fingerprint TEXT NOT NULL,
  column_count INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'parsing', 'parsed', 'mapping', 'mapped',
                      'validating', 'validated', 'committing', 'committed',
                      'failed', 'cancelled')),
  mapping_template_id INTEGER REFERENCES import_mapping_templates(id) ON DELETE SET NULL,
  format_change_detected BOOLEAN DEFAULT false,
  requires_remapping BOOLEAN DEFAULT false,
  valid_row_count INTEGER DEFAULT 0,
  error_row_count INTEGER DEFAULT 0,
  warning_row_count INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  committed_at TIMESTAMP WITH TIME ZONE,
  committed_by INTEGER,
  error_message TEXT,
  error_details JSONB,
  -- From migration 018: enhancements
  quality_report JSONB,
  selected_sheet TEXT,
  header_row_index INTEGER DEFAULT 0
);

-- 3. Import Staging Rows (Holder data før commit til produksjon)
CREATE TABLE IF NOT EXISTS import_staging_rows (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  mapped_data JSONB,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'valid', 'invalid', 'warning')),
  target_kunde_id INTEGER REFERENCES kunder(id) ON DELETE SET NULL,
  action_taken TEXT CHECK (action_taken IN ('created', 'updated', 'skipped', 'error')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- From migration 018: enhancements
  duplicate_info JSONB,
  completeness_score REAL,
  UNIQUE(batch_id, row_number)
);

-- 4. Import Validation Errors (Detaljert feilsporing per rad)
CREATE TABLE IF NOT EXISTS import_validation_errors (
  id SERIAL PRIMARY KEY,
  staging_row_id INTEGER NOT NULL REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  error_code TEXT NOT NULL,
  field_name TEXT,
  source_column TEXT,
  message TEXT NOT NULL,
  expected_format TEXT,
  actual_value TEXT,
  suggestion TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Import Column History (For format-endringsdeteksjon)
CREATE TABLE IF NOT EXISTS import_column_history (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  column_fingerprint TEXT NOT NULL,
  columns JSONB NOT NULL,
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  batch_count INTEGER DEFAULT 1,
  UNIQUE(organization_id, column_fingerprint)
);

-- 6. Import Audit Log (Komplett sporbarhet)
CREATE TABLE IF NOT EXISTS import_audit_log (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  affected_kunde_ids INTEGER[],
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Indexes for Performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_import_batches_org ON import_batches(organization_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);
CREATE INDEX IF NOT EXISTS idx_import_batches_created ON import_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_file_hash ON import_batches(file_hash);

CREATE INDEX IF NOT EXISTS idx_import_staging_batch ON import_staging_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_staging_status ON import_staging_rows(validation_status);
CREATE INDEX IF NOT EXISTS idx_import_staging_org ON import_staging_rows(organization_id);
CREATE INDEX IF NOT EXISTS idx_staging_rows_batch_status ON import_staging_rows(batch_id, validation_status);

CREATE INDEX IF NOT EXISTS idx_import_errors_staging ON import_validation_errors(staging_row_id);
CREATE INDEX IF NOT EXISTS idx_import_errors_batch ON import_validation_errors(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_errors_severity ON import_validation_errors(severity);

CREATE INDEX IF NOT EXISTS idx_import_templates_org ON import_mapping_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_import_templates_fingerprint ON import_mapping_templates(source_column_fingerprint);

CREATE INDEX IF NOT EXISTS idx_import_history_org ON import_column_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_import_history_fingerprint ON import_column_history(column_fingerprint);

CREATE INDEX IF NOT EXISTS idx_import_audit_batch ON import_audit_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_audit_org ON import_audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_import_audit_created ON import_audit_log(created_at DESC);

-- From migration 018: customer lookup index for duplicate detection
CREATE INDEX IF NOT EXISTS idx_kunder_org_navn_adresse ON kunder(organization_id, navn, adresse);

-- ============================================
-- Update Trigger for updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_import_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER import_batches_updated_at
  BEFORE UPDATE ON import_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_import_updated_at();

CREATE TRIGGER import_templates_updated_at
  BEFORE UPDATE ON import_mapping_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_import_updated_at();

-- ============================================
-- Done! Import system tables created.
-- NOTE: RLS is NOT enabled because the app uses
-- service_role key which bypasses RLS anyway.
-- ============================================
