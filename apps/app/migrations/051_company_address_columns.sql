-- Add company address columns to organizations table
-- These columns store the company office address separately from route_start_address
-- Used by admin settings and onboarding wizard

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_address TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_postnummer TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_poststed TEXT;
