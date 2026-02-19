-- Migration 039: Database Performance Cleanup
-- Adds missing foreign key indexes and removes unused indexes
-- Based on Supabase database linter findings

-- ============================================================
-- PART 1: Add missing foreign key indexes (15 indexes)
-- ============================================================

-- account_deletion_requests
CREATE INDEX IF NOT EXISTS idx_deletion_requests_cancelled_by ON account_deletion_requests(cancelled_by);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_requested_by ON account_deletion_requests(requested_by);

-- auth_tokens
CREATE INDEX IF NOT EXISTS idx_auth_tokens_org ON auth_tokens(organization_id);

-- chat_read_status
CREATE INDEX IF NOT EXISTS idx_chat_read_status_conversation ON chat_read_status(conversation_id);

-- customer_services
CREATE INDEX IF NOT EXISTS idx_customer_services_equipment_type ON customer_services(equipment_type_id);
CREATE INDEX IF NOT EXISTS idx_customer_services_subtype ON customer_services(subtype_id);

-- email_innstillinger
CREATE INDEX IF NOT EXISTS idx_email_innstillinger_org ON email_innstillinger(organization_id);

-- email_tokens
CREATE INDEX IF NOT EXISTS idx_email_tokens_org ON email_tokens(organization_id);

-- email_varsler
CREATE INDEX IF NOT EXISTS idx_email_varsler_kunde ON email_varsler(kunde_id);

-- import_batches
CREATE INDEX IF NOT EXISTS idx_import_batches_mapping_template ON import_batches(mapping_template_id);

-- import_staging_rows
CREATE INDEX IF NOT EXISTS idx_import_staging_target_kunde ON import_staging_rows(target_kunde_id);

-- organization_features
CREATE INDEX IF NOT EXISTS idx_org_features_feature_key ON organization_features(feature_key);

-- organizations
CREATE INDEX IF NOT EXISTS idx_organizations_industry_template ON organizations(industry_template_id);

-- rute_kunde_visits
CREATE INDEX IF NOT EXISTS idx_rute_visits_kunde ON rute_kunde_visits(kunde_id);

-- rute_kunder
CREATE INDEX IF NOT EXISTS idx_rute_kunder_org ON rute_kunder(organization_id);


-- ============================================================
-- PART 2: Remove unused indexes (34 indexes)
-- Security-critical indexes (auth, tokens, audit) are kept
-- ============================================================

-- organizations
DROP INDEX IF EXISTS idx_organizations_slug;
DROP INDEX IF EXISTS idx_organizations_aktiv;
DROP INDEX IF EXISTS idx_organizations_subscription;

-- kunder
DROP INDEX IF EXISTS idx_kunder_lifecycle;
DROP INDEX IF EXISTS idx_kunder_job_type;
DROP INDEX IF EXISTS idx_kunder_neste_el;
DROP INDEX IF EXISTS idx_kunder_status;
DROP INDEX IF EXISTS idx_kunder_org_status;

-- ruter
DROP INDEX IF EXISTS idx_ruter_status;
DROP INDEX IF EXISTS idx_ruter_assigned;

-- rute_kunde_visits / rute_kunder
DROP INDEX IF EXISTS idx_rute_visits_rute;
DROP INDEX IF EXISTS idx_rute_kunder_rute;

-- avtaler
DROP INDEX IF EXISTS idx_avtaler_rute;
DROP INDEX IF EXISTS idx_avtaler_gjentakelse;

-- kunde_tags
DROP INDEX IF EXISTS idx_kunde_tags_tag;

-- customer_services
DROP INDEX IF EXISTS idx_customer_services_kunde;
DROP INDEX IF EXISTS idx_customer_services_type;
DROP INDEX IF EXISTS idx_customer_services_neste;

-- email_varsler
DROP INDEX IF EXISTS idx_email_varsler_status;

-- api_keys / api_key_usage_log
DROP INDEX IF EXISTS idx_api_keys_active;
DROP INDEX IF EXISTS idx_api_key_usage_key;
DROP INDEX IF EXISTS idx_api_key_usage_created;

-- webhook_endpoints / webhook_deliveries
DROP INDEX IF EXISTS idx_webhook_endpoints_active;
DROP INDEX IF EXISTS idx_webhook_deliveries_endpoint;
DROP INDEX IF EXISTS idx_webhook_deliveries_status;
DROP INDEX IF EXISTS idx_webhook_deliveries_retry;

-- import tables
DROP INDEX IF EXISTS idx_import_batches_created;
DROP INDEX IF EXISTS idx_import_batches_file_hash;
DROP INDEX IF EXISTS idx_import_staging_status;
DROP INDEX IF EXISTS idx_import_errors_severity;
DROP INDEX IF EXISTS idx_import_history_fingerprint;
DROP INDEX IF EXISTS idx_import_audit_org;
DROP INDEX IF EXISTS idx_import_audit_created;

-- organization_integrations
DROP INDEX IF EXISTS idx_org_integrations_org;
