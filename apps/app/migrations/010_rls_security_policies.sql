-- =====================================================
-- SKY PLANNER - Row Level Security Policies
-- Migration: 010_rls_security_policies.sql
-- =====================================================
-- Enables RLS on all tables exposed via PostgREST.
-- All access goes through Express backend with service_role,
-- so we only need service_role bypass policies.
--
-- Template tables also allow authenticated read access.
--
-- IMPORTANT: This migration is idempotent - safe to run multiple times
-- =====================================================

-- 1. password_reset_tokens (SERVICE ROLE ONLY)
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "password_reset_tokens_service_role" ON password_reset_tokens;
CREATE POLICY "password_reset_tokens_service_role" ON password_reset_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. industry_templates
ALTER TABLE industry_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Industry templates are viewable by authenticated users" ON industry_templates;
DROP POLICY IF EXISTS "industry_templates_service_role" ON industry_templates;
DROP POLICY IF EXISTS "industry_templates_public_read" ON industry_templates;
CREATE POLICY "industry_templates_service_role" ON industry_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "industry_templates_public_read" ON industry_templates FOR SELECT TO authenticated USING (true);

-- 3. template_service_types
ALTER TABLE template_service_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_service_types_service_role" ON template_service_types;
DROP POLICY IF EXISTS "template_service_types_public_read" ON template_service_types;
CREATE POLICY "template_service_types_service_role" ON template_service_types FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "template_service_types_public_read" ON template_service_types FOR SELECT TO authenticated USING (true);

-- 4. template_subtypes
ALTER TABLE template_subtypes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_subtypes_service_role" ON template_subtypes;
DROP POLICY IF EXISTS "template_subtypes_public_read" ON template_subtypes;
CREATE POLICY "template_subtypes_service_role" ON template_subtypes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "template_subtypes_public_read" ON template_subtypes FOR SELECT TO authenticated USING (true);

-- 5. template_equipment
ALTER TABLE template_equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_equipment_service_role" ON template_equipment;
DROP POLICY IF EXISTS "template_equipment_public_read" ON template_equipment;
CREATE POLICY "template_equipment_service_role" ON template_equipment FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "template_equipment_public_read" ON template_equipment FOR SELECT TO authenticated USING (true);

-- 6. template_intervals
ALTER TABLE template_intervals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_intervals_service_role" ON template_intervals;
DROP POLICY IF EXISTS "template_intervals_public_read" ON template_intervals;
CREATE POLICY "template_intervals_service_role" ON template_intervals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "template_intervals_public_read" ON template_intervals FOR SELECT TO authenticated USING (true);

-- 7. customer_services (service_role only - custom auth doesn't use auth.uid())
ALTER TABLE customer_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Customer services are viewable by organization members" ON customer_services;
DROP POLICY IF EXISTS "customer_services_service_role" ON customer_services;
DROP POLICY IF EXISTS "customer_services_org_read" ON customer_services;
DROP POLICY IF EXISTS "customer_services_org_insert" ON customer_services;
DROP POLICY IF EXISTS "customer_services_org_update" ON customer_services;
DROP POLICY IF EXISTS "customer_services_org_delete" ON customer_services;
CREATE POLICY "customer_services_service_role" ON customer_services FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. api_keys (service_role only)
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "API keys are viewable by organization members" ON api_keys;
DROP POLICY IF EXISTS "API keys are insertable by organization admins" ON api_keys;
DROP POLICY IF EXISTS "API keys are updatable by organization admins" ON api_keys;
DROP POLICY IF EXISTS "API keys are deletable by organization admins" ON api_keys;
DROP POLICY IF EXISTS "api_keys_service_role" ON api_keys;
DROP POLICY IF EXISTS "api_keys_org_read" ON api_keys;
DROP POLICY IF EXISTS "api_keys_admin_insert" ON api_keys;
DROP POLICY IF EXISTS "api_keys_admin_update" ON api_keys;
DROP POLICY IF EXISTS "api_keys_admin_delete" ON api_keys;
CREATE POLICY "api_keys_service_role" ON api_keys FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. api_key_usage_log (service_role only)
ALTER TABLE api_key_usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "API key usage logs are viewable by organization members" ON api_key_usage_log;
DROP POLICY IF EXISTS "api_key_usage_log_service_role" ON api_key_usage_log;
DROP POLICY IF EXISTS "api_key_usage_log_org_read" ON api_key_usage_log;
CREATE POLICY "api_key_usage_log_service_role" ON api_key_usage_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 10. webhook_endpoints (service_role only)
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Webhook endpoints are viewable by organization members" ON webhook_endpoints;
DROP POLICY IF EXISTS "Webhook endpoints are insertable by organization admins" ON webhook_endpoints;
DROP POLICY IF EXISTS "Webhook endpoints are updatable by organization admins" ON webhook_endpoints;
DROP POLICY IF EXISTS "Webhook endpoints are deletable by organization admins" ON webhook_endpoints;
DROP POLICY IF EXISTS "webhook_endpoints_service_role" ON webhook_endpoints;
DROP POLICY IF EXISTS "webhook_endpoints_org_read" ON webhook_endpoints;
DROP POLICY IF EXISTS "webhook_endpoints_admin_insert" ON webhook_endpoints;
DROP POLICY IF EXISTS "webhook_endpoints_admin_update" ON webhook_endpoints;
DROP POLICY IF EXISTS "webhook_endpoints_admin_delete" ON webhook_endpoints;
CREATE POLICY "webhook_endpoints_service_role" ON webhook_endpoints FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 11. webhook_deliveries (service_role only)
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Webhook deliveries are viewable by organization members" ON webhook_deliveries;
DROP POLICY IF EXISTS "webhook_deliveries_service_role" ON webhook_deliveries;
DROP POLICY IF EXISTS "webhook_deliveries_org_read" ON webhook_deliveries;
CREATE POLICY "webhook_deliveries_service_role" ON webhook_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- FIX: Remove duplicate INSERT policies (tenant_insert_*)
-- These overlap with tenant_isolation_* FOR ALL policies
-- =====================================================

-- avtaler table
DROP POLICY IF EXISTS "tenant_insert_avtaler" ON avtaler;

-- kunder table
DROP POLICY IF EXISTS "tenant_insert_kunder" ON kunder;

-- ruter table
DROP POLICY IF EXISTS "tenant_insert_ruter" ON ruter;

-- =====================================================
-- END OF MIGRATION
-- =====================================================
