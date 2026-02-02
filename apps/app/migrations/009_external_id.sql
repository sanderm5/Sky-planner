-- Add external_id column for Tripletex project numbers
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Add org_nr column for organization numbers
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS org_nr TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_kunder_external_id ON kunder(external_id) WHERE external_id IS NOT NULL;
