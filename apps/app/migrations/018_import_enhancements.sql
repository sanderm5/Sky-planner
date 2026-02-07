-- Migration 018: Import System Enhancements
-- Adds columns for duplicate detection, quality reporting, and sheet selection

-- Duplicate detection info per staging row
ALTER TABLE import_staging_rows ADD COLUMN IF NOT EXISTS duplicate_info JSONB;

-- Row completeness score (0-1)
ALTER TABLE import_staging_rows ADD COLUMN IF NOT EXISTS completeness_score REAL;

-- Batch-level quality report
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS quality_report JSONB;

-- Track which sheet was selected (multi-sheet support)
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS selected_sheet TEXT;

-- Track detected header row index
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS header_row_index INTEGER DEFAULT 0;

-- Index for duplicate detection queries
CREATE INDEX IF NOT EXISTS idx_kunder_org_navn_adresse
  ON kunder (organization_id, navn, adresse);

-- Index for staging row batch lookups
CREATE INDEX IF NOT EXISTS idx_staging_rows_batch_status
  ON import_staging_rows (batch_id, validation_status);
