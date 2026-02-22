-- =============================================
-- 045: Add rolle (role) column to klient table
-- =============================================
-- Roles: admin, redigerer, leser
-- Default: leser
-- First user per organization is always admin.

ALTER TABLE klient ADD COLUMN IF NOT EXISTS rolle TEXT DEFAULT 'leser';

-- Set first user per organization as admin
-- (DISTINCT ON picks the lowest id per org = first created user)
UPDATE klient SET rolle = 'admin'
WHERE id IN (
  SELECT DISTINCT ON (organization_id) id
  FROM klient
  WHERE organization_id IS NOT NULL
  ORDER BY organization_id, id ASC
);
