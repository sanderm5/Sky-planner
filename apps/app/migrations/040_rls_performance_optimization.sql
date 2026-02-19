-- Migration 040: RLS Performance Optimization
-- Fixes Supabase database linter warnings:
--   1. auth_rls_initplan: policies re-evaluating auth.role(), auth.jwt(),
--      or current_setting() for every row instead of using (select ...) subquery
--   2. multiple_permissive_policies: tables with overlapping SELECT coverage
--      from both FOR SELECT and FOR ALL policies
--
-- All DB access goes through Express backend using service_role (bypasses RLS).
-- These policies are defense-in-depth only. No downtime risk.


-- ============================================================
-- PART 1: Drop redundant service_role FOR ALL policies
-- ============================================================
-- These tables have a permissive FOR SELECT policy plus a FOR ALL policy
-- that checks auth.role() = 'service_role'. Since service_role bypasses
-- RLS in Supabase, the FOR ALL policies are dead code. Dropping them
-- fixes both multiple_permissive_policies AND auth_rls_initplan.
-- Non-service-role users are implicitly denied writes (RLS deny-by-default).

-- feature_definitions: keep feature_definitions_read (FOR SELECT USING true)
DROP POLICY IF EXISTS feature_definitions_write ON feature_definitions;

-- organization_service_types: keep org_service_types_read (FOR SELECT USING true)
DROP POLICY IF EXISTS org_service_types_write ON organization_service_types;

-- patch_notes: keep patch_notes_read (FOR SELECT USING true)
DROP POLICY IF EXISTS patch_notes_write ON patch_notes;

-- account_deletion_requests: keep deletion_requests_select_own (fixed in Part 3)
DROP POLICY IF EXISTS deletion_requests_service_all ON account_deletion_requests;


-- ============================================================
-- PART 2: Convert auth.role() check policies to grant-based
-- ============================================================
-- Replace USING (auth.role() = 'service_role') with TO service_role USING (true).
-- Matches the pattern from migrations 010/011 and eliminates per-row evaluation.

-- totp_pending_sessions
DROP POLICY IF EXISTS totp_pending_service_only ON totp_pending_sessions;
CREATE POLICY totp_pending_service_only ON totp_pending_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- totp_audit_log
DROP POLICY IF EXISTS totp_audit_service_only ON totp_audit_log;
CREATE POLICY totp_audit_service_only ON totp_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- kontaktpersoner
DROP POLICY IF EXISTS kontaktpersoner_service_only ON kontaktpersoner;
CREATE POLICY kontaktpersoner_service_only ON kontaktpersoner
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- tags
DROP POLICY IF EXISTS tags_service_only ON tags;
CREATE POLICY tags_service_only ON tags
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- kunde_tags
DROP POLICY IF EXISTS kunde_tags_service_only ON kunde_tags;
CREATE POLICY kunde_tags_service_only ON kunde_tags
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- security_audit_log
DROP POLICY IF EXISTS security_audit_service_only ON security_audit_log;
CREATE POLICY security_audit_service_only ON security_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- active_sessions
DROP POLICY IF EXISTS active_sessions_service_only ON active_sessions;
CREATE POLICY active_sessions_service_only ON active_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- organization_features
DROP POLICY IF EXISTS org_features_service ON organization_features;
CREATE POLICY org_features_service ON organization_features
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- rute_kunde_visits
DROP POLICY IF EXISTS rute_visits_service ON rute_kunde_visits;
CREATE POLICY rute_visits_service ON rute_kunde_visits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- login_attempts
DROP POLICY IF EXISTS login_attempts_service_only ON login_attempts;
CREATE POLICY login_attempts_service_only ON login_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================
-- PART 3: Fix auth.jwt() policy with (select ...) wrapper
-- ============================================================

-- account_deletion_requests
DROP POLICY IF EXISTS deletion_requests_select_own ON account_deletion_requests;
CREATE POLICY deletion_requests_select_own ON account_deletion_requests
  FOR SELECT
  USING (organization_id = ((select auth.jwt())->>'organization_id')::INTEGER);


-- ============================================================
-- PART 4: Fix current_setting() policies with (select ...) wrapper
-- ============================================================

-- organization_integrations
DROP POLICY IF EXISTS org_integrations_tenant_policy ON organization_integrations;
CREATE POLICY org_integrations_tenant_policy ON organization_integrations
  USING (organization_id = (select current_setting('app.current_organization_id', true))::integer);

-- integration_sync_log
DROP POLICY IF EXISTS sync_log_tenant_policy ON integration_sync_log;
CREATE POLICY sync_log_tenant_policy ON integration_sync_log
  USING (organization_id = (select current_setting('app.current_organization_id', true))::integer);

-- failed_sync_items (manually created in Supabase, now codified in migrations)
ALTER TABLE failed_sync_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS failed_sync_items_tenant_policy ON failed_sync_items;
CREATE POLICY failed_sync_items_tenant_policy ON failed_sync_items
  USING (organization_id = (select current_setting('app.current_organization_id', true))::integer);

-- chat_conversations
DROP POLICY IF EXISTS chat_conversations_tenant_isolation ON chat_conversations;
CREATE POLICY chat_conversations_tenant_isolation ON chat_conversations
  USING (organization_id = (select current_setting('app.current_tenant_id', true))::integer);

-- chat_participants
DROP POLICY IF EXISTS chat_participants_tenant_isolation ON chat_participants;
CREATE POLICY chat_participants_tenant_isolation ON chat_participants
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE organization_id = (select current_setting('app.current_tenant_id', true))::integer
    )
  );

-- chat_messages
DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;
CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE organization_id = (select current_setting('app.current_tenant_id', true))::integer
    )
  );

-- chat_read_status
DROP POLICY IF EXISTS chat_read_status_tenant_isolation ON chat_read_status;
CREATE POLICY chat_read_status_tenant_isolation ON chat_read_status
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE organization_id = (select current_setting('app.current_tenant_id', true))::integer
    )
  );
