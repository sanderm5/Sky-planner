-- Migration: Add custom_fields table for dynamic Excel import columns
-- This table tracks custom columns added per organization when importing Excel/CSV files

CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  table_name TEXT NOT NULL DEFAULT 'kunder',
  column_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'TEXT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, table_name, column_name)
);

-- Index for faster lookups by organization
CREATE INDEX IF NOT EXISTS idx_custom_fields_org ON custom_fields(organization_id);

-- For Supabase: Enable RLS
-- ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Organizations can only see their own custom fields
-- CREATE POLICY "Organizations can view own custom fields" ON custom_fields
--   FOR SELECT USING (organization_id = current_setting('app.current_organization_id')::INTEGER);

-- CREATE POLICY "Organizations can insert own custom fields" ON custom_fields
--   FOR INSERT WITH CHECK (organization_id = current_setting('app.current_organization_id')::INTEGER);
