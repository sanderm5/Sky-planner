-- Migration 047: Fix RLS auth.role() re-evaluation per row
-- Fixes Supabase database linter WARNs (auth_rls_initplan):
--   Policies using auth.role() are re-evaluated for each row,
--   causing suboptimal query performance at scale.
--
-- Fix: Replace auth.role() policies with TO service_role grants,
-- which is both faster (no per-row evaluation) and the recommended
-- Supabase pattern for service_role-only access.


-- ============================================================
-- 1. tag_groups — tag_groups_service_only
-- ============================================================
DROP POLICY IF EXISTS tag_groups_service_only ON tag_groups;
CREATE POLICY tag_groups_service_only ON tag_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================
-- 2. service_type_subcat_groups — subcat_groups_service_only
-- ============================================================
DROP POLICY IF EXISTS subcat_groups_service_only ON service_type_subcat_groups;
CREATE POLICY subcat_groups_service_only ON service_type_subcat_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================
-- 3. service_type_subcategories — subcategories_service_only
-- ============================================================
DROP POLICY IF EXISTS subcategories_service_only ON service_type_subcategories;
CREATE POLICY subcategories_service_only ON service_type_subcategories
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================
-- 4. kunde_subcategories — kunde_subcats_service_only
-- ============================================================
DROP POLICY IF EXISTS kunde_subcats_service_only ON kunde_subcategories;
CREATE POLICY kunde_subcats_service_only ON kunde_subcategories
  FOR ALL TO service_role USING (true) WITH CHECK (true);
