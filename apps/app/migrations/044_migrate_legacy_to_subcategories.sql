-- Migration 044: Migrate legacy dropdown fields to subcategory system
-- SCOPED TO TRE ALLSERVICE ONLY (app_mode = 'full')
-- Creates subcategory groups + items for el-kontroll and brannvarsling,
-- then migrates existing customer data from legacy columns.
-- Safe to run multiple times (ON CONFLICT DO NOTHING).

-- =============================================
-- 1. Create subcategory groups (only for Tre Allservice)
-- =============================================

-- El-kontroll → "Kundetype" group
INSERT INTO service_type_subcat_groups (service_type_id, navn, sort_order)
SELECT ost.id, 'Kundetype', 0
FROM organization_service_types ost
JOIN organizations o ON o.id = ost.organization_id
WHERE ost.slug = 'el-kontroll' AND o.app_mode = 'full'
ON CONFLICT (service_type_id, navn) DO NOTHING;

-- Brannvarsling → "Brannsystem" group
INSERT INTO service_type_subcat_groups (service_type_id, navn, sort_order)
SELECT ost.id, 'Brannsystem', 0
FROM organization_service_types ost
JOIN organizations o ON o.id = ost.organization_id
WHERE ost.slug = 'brannvarsling' AND o.app_mode = 'full'
ON CONFLICT (service_type_id, navn) DO NOTHING;

-- Brannvarsling → "Driftskategori" group
INSERT INTO service_type_subcat_groups (service_type_id, navn, sort_order)
SELECT ost.id, 'Driftskategori', 1
FROM organization_service_types ost
JOIN organizations o ON o.id = ost.organization_id
WHERE ost.slug = 'brannvarsling' AND o.app_mode = 'full'
ON CONFLICT (service_type_id, navn) DO NOTHING;

-- =============================================
-- 2. Create subcategory items
-- =============================================

-- Kundetype items (for el-kontroll)
INSERT INTO service_type_subcategories (group_id, navn, sort_order)
SELECT g.id, item.navn, item.sort_order
FROM service_type_subcat_groups g
JOIN organization_service_types ost ON ost.id = g.service_type_id
JOIN organizations o ON o.id = ost.organization_id
CROSS JOIN (VALUES
  ('Landbruk', 0),
  ('Næring', 1),
  ('Gartneri', 2),
  ('Bolig', 3)
) AS item(navn, sort_order)
WHERE ost.slug = 'el-kontroll' AND g.navn = 'Kundetype' AND o.app_mode = 'full'
ON CONFLICT (group_id, navn) DO NOTHING;

-- Brannsystem items (for brannvarsling)
INSERT INTO service_type_subcategories (group_id, navn, sort_order)
SELECT g.id, item.navn, item.sort_order
FROM service_type_subcat_groups g
JOIN organization_service_types ost ON ost.id = g.service_type_id
JOIN organizations o ON o.id = ost.organization_id
CROSS JOIN (VALUES
  ('Elotec', 0),
  ('ES 801', 1),
  ('ES 601', 2),
  ('2 x Elotec', 3),
  ('ICAS', 4),
  ('Elotec + ICAS', 5)
) AS item(navn, sort_order)
WHERE ost.slug = 'brannvarsling' AND g.navn = 'Brannsystem' AND o.app_mode = 'full'
ON CONFLICT (group_id, navn) DO NOTHING;

-- Driftskategori items (for brannvarsling) — all values from live database
INSERT INTO service_type_subcategories (group_id, navn, sort_order)
SELECT g.id, item.navn, item.sort_order
FROM service_type_subcat_groups g
JOIN organization_service_types ost ON ost.id = g.service_type_id
JOIN organizations o ON o.id = ost.organization_id
CROSS JOIN (VALUES
  ('Storfe', 0),
  ('Sau', 1),
  ('Geit', 2),
  ('Gris', 3),
  ('Storfe/Sau', 4),
  ('Gartneri', 5),
  ('Svin', 6),
  ('Korn', 7),
  ('Fjærfeoppdrett', 8),
  ('Sau/Geit', 9),
  ('Fjørfe', 10),
  ('Hest', 11),
  ('Grønnsaker', 12),
  ('Drivhus', 13)
) AS item(navn, sort_order)
WHERE ost.slug = 'brannvarsling' AND g.navn = 'Driftskategori' AND o.app_mode = 'full'
ON CONFLICT (group_id, navn) DO NOTHING;

-- =============================================
-- 3. Normalize dirty legacy data before migrating
-- =============================================

-- Fix "Gartn" → "Gartneri"
UPDATE kunder SET brann_driftstype = 'Gartneri' WHERE brann_driftstype = 'Gartn';
-- Fix "Storfe+Sau" → "Storfe/Sau"
UPDATE kunder SET brann_driftstype = 'Storfe/Sau' WHERE brann_driftstype = 'Storfe+Sau';
-- Fix "Sau / geit" → "Sau/Geit"
UPDATE kunder SET brann_driftstype = 'Sau/Geit' WHERE LOWER(REPLACE(brann_driftstype, ' ', '')) = 'sau/geit';
-- Clear "Ingen" (means no value)
UPDATE kunder SET brann_driftstype = NULL WHERE brann_driftstype = 'Ingen';

-- =============================================
-- 4. Migrate existing customer data
-- =============================================

-- el_type → Kundetype subcategory assignment
INSERT INTO kunde_subcategories (kunde_id, group_id, subcategory_id)
SELECT k.id, g.id, sc.id
FROM kunder k
JOIN organization_service_types ost ON ost.organization_id = k.organization_id AND ost.slug = 'el-kontroll'
JOIN organizations o ON o.id = ost.organization_id
JOIN service_type_subcat_groups g ON g.service_type_id = ost.id AND g.navn = 'Kundetype'
JOIN service_type_subcategories sc ON sc.group_id = g.id AND sc.navn = k.el_type
WHERE k.el_type IS NOT NULL AND k.el_type != '' AND o.app_mode = 'full'
ON CONFLICT (kunde_id, group_id) DO NOTHING;

-- brann_system → Brannsystem subcategory assignment
INSERT INTO kunde_subcategories (kunde_id, group_id, subcategory_id)
SELECT k.id, g.id, sc.id
FROM kunder k
JOIN organization_service_types ost ON ost.organization_id = k.organization_id AND ost.slug = 'brannvarsling'
JOIN organizations o ON o.id = ost.organization_id
JOIN service_type_subcat_groups g ON g.service_type_id = ost.id AND g.navn = 'Brannsystem'
JOIN service_type_subcategories sc ON sc.group_id = g.id AND sc.navn = k.brann_system
WHERE k.brann_system IS NOT NULL AND k.brann_system != '' AND o.app_mode = 'full'
ON CONFLICT (kunde_id, group_id) DO NOTHING;

-- brann_driftstype → Driftskategori subcategory assignment
INSERT INTO kunde_subcategories (kunde_id, group_id, subcategory_id)
SELECT k.id, g.id, sc.id
FROM kunder k
JOIN organization_service_types ost ON ost.organization_id = k.organization_id AND ost.slug = 'brannvarsling'
JOIN organizations o ON o.id = ost.organization_id
JOIN service_type_subcat_groups g ON g.service_type_id = ost.id AND g.navn = 'Driftskategori'
JOIN service_type_subcategories sc ON sc.group_id = g.id AND sc.navn = k.brann_driftstype
WHERE k.brann_driftstype IS NOT NULL AND k.brann_driftstype != '' AND o.app_mode = 'full'
ON CONFLICT (kunde_id, group_id) DO NOTHING;
