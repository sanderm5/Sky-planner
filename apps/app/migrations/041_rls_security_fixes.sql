-- Migration 041: RLS Security Fixes
-- Fixes Supabase database linter ERRORs:
--   1. security_definer_view: pending_deletions view uses SECURITY DEFINER
--   2. rls_disabled_in_public: 6 import tables missing RLS
--
-- The import tables lost RLS when 006_import_system_combined.sql was run
-- instead of the original 006_import_system.sql (which had RLS).


-- ============================================================
-- PART 1: Fix pending_deletions view (SECURITY DEFINER → INVOKER)
-- ============================================================
-- Recreate with security_invoker = true so the view uses the
-- querying user's permissions instead of the view creator's.

CREATE OR REPLACE VIEW pending_deletions
  WITH (security_invoker = true)
AS
SELECT
  adr.id AS request_id,
  adr.organization_id,
  o.navn AS organization_name,
  adr.requested_at,
  adr.scheduled_deletion_at,
  adr.scheduled_deletion_at - NOW() AS time_remaining,
  k.epost AS requester_email
FROM account_deletion_requests adr
JOIN organizations o ON o.id = adr.organization_id
JOIN klient k ON k.id = adr.requested_by
WHERE adr.status = 'pending'
  AND adr.scheduled_deletion_at > NOW();


-- ============================================================
-- PART 2: Enable RLS on import tables + service_role bypass
-- ============================================================
-- All access goes through Express backend using service_role.

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_mapping_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_staging_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_validation_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_column_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_batches_service ON import_batches;
CREATE POLICY import_batches_service ON import_batches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_mapping_templates_service ON import_mapping_templates;
CREATE POLICY import_mapping_templates_service ON import_mapping_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_staging_rows_service ON import_staging_rows;
CREATE POLICY import_staging_rows_service ON import_staging_rows
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_validation_errors_service ON import_validation_errors;
CREATE POLICY import_validation_errors_service ON import_validation_errors
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_column_history_service ON import_column_history;
CREATE POLICY import_column_history_service ON import_column_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_audit_log_service ON import_audit_log;
CREATE POLICY import_audit_log_service ON import_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
