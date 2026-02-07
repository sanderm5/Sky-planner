-- =====================================================
-- SKY PLANNER - Enhanced Tenant Security Policies
-- Migration: 011_tenant_rls_policies.sql
-- =====================================================
-- This migration adds:
-- 1. Organization-aware RLS policies for data isolation
-- 2. Database triggers for quota enforcement
-- 3. Audit logging for sensitive operations
--
-- IMPORTANT: This migration is idempotent - safe to run multiple times
-- =====================================================

-- =====================================================
-- PART 1: Helper Functions
-- =====================================================

-- Function to get current organization context from request header
-- This is set by the backend before each request
CREATE OR REPLACE FUNCTION get_current_organization_id()
RETURNS INTEGER AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_organization_id', true), '')::INTEGER;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user belongs to organization
CREATE OR REPLACE FUNCTION user_belongs_to_organization(user_org_id INTEGER, target_org_id INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN user_org_id IS NOT NULL AND user_org_id = target_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PART 2: Quota Enforcement Functions
-- =====================================================

-- Function to check customer quota before insert
CREATE OR REPLACE FUNCTION check_customer_quota()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  max_allowed INTEGER;
BEGIN
  -- Get current count and max allowed for this organization
  SELECT COUNT(*) INTO current_count
  FROM kunder
  WHERE organization_id = NEW.organization_id;

  SELECT max_kunder INTO max_allowed
  FROM organizations
  WHERE id = NEW.organization_id;

  -- Check quota
  IF max_allowed IS NOT NULL AND current_count >= max_allowed THEN
    RAISE EXCEPTION 'Customer quota exceeded. Current: %, Max: %', current_count, max_allowed
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to check user quota before insert
CREATE OR REPLACE FUNCTION check_user_quota()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  max_allowed INTEGER;
BEGIN
  -- Get current count and max allowed for this organization
  SELECT COUNT(*) INTO current_count
  FROM brukere
  WHERE organization_id = NEW.organization_id;

  SELECT max_brukere INTO max_allowed
  FROM organizations
  WHERE id = NEW.organization_id;

  -- Check quota
  IF max_allowed IS NOT NULL AND current_count >= max_allowed THEN
    RAISE EXCEPTION 'User quota exceeded. Current: %, Max: %', current_count, max_allowed
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to prevent organization_id modification
CREATE OR REPLACE FUNCTION prevent_organization_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Cannot change organization_id after creation'
      USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PART 3: Audit Logging
-- =====================================================

-- Create audit log table if not exists
CREATE TABLE IF NOT EXISTS security_audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  organization_id INTEGER,
  record_id INTEGER,
  old_data JSONB,
  new_data JSONB,
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  performed_by TEXT
);

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_security_audit_org ON security_audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_time ON security_audit_log(performed_at);

-- Function to log sensitive operations
CREATE OR REPLACE FUNCTION log_sensitive_operation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO security_audit_log (table_name, operation, organization_id, record_id, old_data)
    VALUES (TG_TABLE_NAME, TG_OP, OLD.organization_id, OLD.id, to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO security_audit_log (table_name, operation, organization_id, record_id, old_data, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, NEW.organization_id, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO security_audit_log (table_name, operation, organization_id, record_id, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, NEW.organization_id, NEW.id, to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PART 4: Apply Triggers to Tables
-- =====================================================

-- Drop existing triggers if they exist (idempotent)
DROP TRIGGER IF EXISTS enforce_customer_quota ON kunder;
DROP TRIGGER IF EXISTS prevent_customer_org_change ON kunder;
DROP TRIGGER IF EXISTS audit_customer_changes ON kunder;

DROP TRIGGER IF EXISTS enforce_user_quota ON brukere;
DROP TRIGGER IF EXISTS prevent_user_org_change ON brukere;
DROP TRIGGER IF EXISTS audit_user_changes ON brukere;

DROP TRIGGER IF EXISTS prevent_route_org_change ON ruter;
DROP TRIGGER IF EXISTS audit_route_changes ON ruter;

DROP TRIGGER IF EXISTS prevent_appointment_org_change ON avtaler;
DROP TRIGGER IF EXISTS audit_appointment_changes ON avtaler;

DROP TRIGGER IF EXISTS audit_api_key_changes ON api_keys;
DROP TRIGGER IF EXISTS audit_webhook_changes ON webhook_endpoints;

-- Kunder (Customers) table triggers
CREATE TRIGGER enforce_customer_quota
  BEFORE INSERT ON kunder
  FOR EACH ROW
  EXECUTE FUNCTION check_customer_quota();

CREATE TRIGGER prevent_customer_org_change
  BEFORE UPDATE ON kunder
  FOR EACH ROW
  EXECUTE FUNCTION prevent_organization_change();

CREATE TRIGGER audit_customer_changes
  AFTER INSERT OR UPDATE OR DELETE ON kunder
  FOR EACH ROW
  EXECUTE FUNCTION log_sensitive_operation();

-- Brukere (Team members) table triggers
CREATE TRIGGER enforce_user_quota
  BEFORE INSERT ON brukere
  FOR EACH ROW
  EXECUTE FUNCTION check_user_quota();

CREATE TRIGGER prevent_user_org_change
  BEFORE UPDATE ON brukere
  FOR EACH ROW
  EXECUTE FUNCTION prevent_organization_change();

CREATE TRIGGER audit_user_changes
  AFTER INSERT OR UPDATE OR DELETE ON brukere
  FOR EACH ROW
  EXECUTE FUNCTION log_sensitive_operation();

-- Ruter (Routes) table triggers
CREATE TRIGGER prevent_route_org_change
  BEFORE UPDATE ON ruter
  FOR EACH ROW
  EXECUTE FUNCTION prevent_organization_change();

CREATE TRIGGER audit_route_changes
  AFTER INSERT OR UPDATE OR DELETE ON ruter
  FOR EACH ROW
  EXECUTE FUNCTION log_sensitive_operation();

-- Avtaler (Appointments) table triggers
CREATE TRIGGER prevent_appointment_org_change
  BEFORE UPDATE ON avtaler
  FOR EACH ROW
  EXECUTE FUNCTION prevent_organization_change();

CREATE TRIGGER audit_appointment_changes
  AFTER INSERT OR UPDATE OR DELETE ON avtaler
  FOR EACH ROW
  EXECUTE FUNCTION log_sensitive_operation();

-- API Keys - audit only (no org change possible via app)
CREATE TRIGGER audit_api_key_changes
  AFTER INSERT OR UPDATE OR DELETE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION log_sensitive_operation();

-- Webhook Endpoints - audit only
CREATE TRIGGER audit_webhook_changes
  AFTER INSERT OR UPDATE OR DELETE ON webhook_endpoints
  FOR EACH ROW
  EXECUTE FUNCTION log_sensitive_operation();

-- =====================================================
-- PART 5: Enhanced RLS Policies for Key Tables
-- =====================================================

-- Note: These policies provide defense-in-depth when using anon/authenticated roles
-- The service_role still bypasses RLS for backend operations

-- Enable RLS on core tables (if not already enabled)
ALTER TABLE kunder ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruter ENABLE ROW LEVEL SECURITY;
ALTER TABLE rute_kunder ENABLE ROW LEVEL SECURITY;
ALTER TABLE avtaler ENABLE ROW LEVEL SECURITY;
ALTER TABLE kontaktlogg ENABLE ROW LEVEL SECURITY;
ALTER TABLE brukere ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Organizations: users can only see their own organization
DROP POLICY IF EXISTS "organizations_tenant_isolation" ON organizations;
CREATE POLICY "organizations_tenant_isolation" ON organizations
  FOR ALL TO authenticated
  USING (id = get_current_organization_id())
  WITH CHECK (id = get_current_organization_id());

-- Keep service_role bypass for backend
DROP POLICY IF EXISTS "organizations_service_role" ON organizations;
CREATE POLICY "organizations_service_role" ON organizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Kunder: organization isolation
DROP POLICY IF EXISTS "kunder_tenant_isolation" ON kunder;
CREATE POLICY "kunder_tenant_isolation" ON kunder
  FOR ALL TO authenticated
  USING (organization_id = get_current_organization_id())
  WITH CHECK (organization_id = get_current_organization_id());

DROP POLICY IF EXISTS "kunder_service_role" ON kunder;
CREATE POLICY "kunder_service_role" ON kunder
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Ruter: organization isolation
DROP POLICY IF EXISTS "ruter_tenant_isolation" ON ruter;
CREATE POLICY "ruter_tenant_isolation" ON ruter
  FOR ALL TO authenticated
  USING (organization_id = get_current_organization_id())
  WITH CHECK (organization_id = get_current_organization_id());

DROP POLICY IF EXISTS "ruter_service_role" ON ruter;
CREATE POLICY "ruter_service_role" ON ruter
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Rute_kunder: organization isolation
DROP POLICY IF EXISTS "rute_kunder_tenant_isolation" ON rute_kunder;
CREATE POLICY "rute_kunder_tenant_isolation" ON rute_kunder
  FOR ALL TO authenticated
  USING (organization_id = get_current_organization_id())
  WITH CHECK (organization_id = get_current_organization_id());

DROP POLICY IF EXISTS "rute_kunder_service_role" ON rute_kunder;
CREATE POLICY "rute_kunder_service_role" ON rute_kunder
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Avtaler: organization isolation
DROP POLICY IF EXISTS "avtaler_tenant_isolation" ON avtaler;
CREATE POLICY "avtaler_tenant_isolation" ON avtaler
  FOR ALL TO authenticated
  USING (organization_id = get_current_organization_id())
  WITH CHECK (organization_id = get_current_organization_id());

DROP POLICY IF EXISTS "avtaler_service_role" ON avtaler;
CREATE POLICY "avtaler_service_role" ON avtaler
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Kontaktlogg: organization isolation
DROP POLICY IF EXISTS "kontaktlogg_tenant_isolation" ON kontaktlogg;
CREATE POLICY "kontaktlogg_tenant_isolation" ON kontaktlogg
  FOR ALL TO authenticated
  USING (organization_id = get_current_organization_id())
  WITH CHECK (organization_id = get_current_organization_id());

DROP POLICY IF EXISTS "kontaktlogg_service_role" ON kontaktlogg;
CREATE POLICY "kontaktlogg_service_role" ON kontaktlogg
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Brukere: organization isolation
DROP POLICY IF EXISTS "brukere_tenant_isolation" ON brukere;
CREATE POLICY "brukere_tenant_isolation" ON brukere
  FOR ALL TO authenticated
  USING (organization_id = get_current_organization_id())
  WITH CHECK (organization_id = get_current_organization_id());

DROP POLICY IF EXISTS "brukere_service_role" ON brukere;
CREATE POLICY "brukere_service_role" ON brukere
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- PART 6: Cleanup function for expired tokens
-- =====================================================

-- Function to clean up expired password reset tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM password_reset_tokens
  WHERE expires_at < NOW()
  RETURNING 1 INTO deleted_count;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old audit logs (keep 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM security_audit_log
  WHERE performed_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- END OF MIGRATION
-- =====================================================

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_current_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_tokens() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_audit_logs() TO service_role;
