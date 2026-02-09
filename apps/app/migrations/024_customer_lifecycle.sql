-- Migration 024: Customer lifecycle tracking columns
-- Enables lifecycle-based color coding on map markers

ALTER TABLE kunder ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT;
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS inquiry_sent_date DATE;
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS last_visit_date DATE;
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS job_confirmed_type TEXT;

-- Indexes for filtering by lifecycle status
CREATE INDEX IF NOT EXISTS idx_kunder_lifecycle ON kunder(organization_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_kunder_job_type ON kunder(organization_id, job_confirmed_type);
CREATE INDEX IF NOT EXISTS idx_kunder_last_visit ON kunder(organization_id, last_visit_date);
