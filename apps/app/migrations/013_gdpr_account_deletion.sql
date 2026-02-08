-- 013_gdpr_account_deletion.sql
-- GDPR-compliant account deletion with soft delete and grace period

-- ============ Add soft delete columns to organizations ============

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deletion_requested_by INTEGER;

-- ============ Add soft delete columns to klient ============

ALTER TABLE klient
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ============ Add soft delete columns to brukere ============

ALTER TABLE brukere
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ============ Account deletion requests table ============
-- Tracks deletion requests with grace period for recovery

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES klient(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by INTEGER REFERENCES klient(id),
  stripe_cancellation_id VARCHAR(255),
  data_export_url TEXT,
  data_export_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding pending deletions
CREATE INDEX IF NOT EXISTS idx_deletion_requests_pending
  ON account_deletion_requests(status, scheduled_deletion_at)
  WHERE status = 'pending';

-- Index for organization lookup
CREATE INDEX IF NOT EXISTS idx_deletion_requests_org
  ON account_deletion_requests(organization_id);

-- ============ Function to soft-delete an organization ============

CREATE OR REPLACE FUNCTION soft_delete_organization(
  p_organization_id INTEGER,
  p_deleted_by INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Mark organization as deleted
  UPDATE organizations
  SET
    deleted_at = v_now,
    updated_at = v_now
  WHERE id = p_organization_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Mark all klient in the organization as deleted
  UPDATE klient
  SET deleted_at = v_now
  WHERE organization_id = p_organization_id
    AND deleted_at IS NULL;

  -- Mark all brukere in the organization as deleted
  UPDATE brukere
  SET deleted_at = v_now
  WHERE organization_id = p_organization_id
    AND deleted_at IS NULL;

  -- Log the deletion
  INSERT INTO security_audit_log (
    organization_id,
    user_id,
    action,
    resource_type,
    resource_id,
    details,
    ip_address
  ) VALUES (
    p_organization_id,
    p_deleted_by,
    'SOFT_DELETE',
    'organization',
    p_organization_id::TEXT,
    jsonb_build_object(
      'reason', 'GDPR account deletion',
      'deleted_at', v_now
    ),
    '0.0.0.0'
  );

  RETURN TRUE;
END;
$$;

-- ============ Function to permanently delete organization data ============
-- This should be called by a cron job after grace period expires

CREATE OR REPLACE FUNCTION permanently_delete_organization(
  p_organization_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org RECORD;
BEGIN
  -- Get organization details for logging
  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Delete in correct order to respect foreign keys

  -- Delete kontaktlogg
  DELETE FROM kontaktlogg
  WHERE kunde_id IN (SELECT id FROM kunder WHERE organization_id = p_organization_id);

  -- Delete avtaler
  DELETE FROM avtaler
  WHERE kunde_id IN (SELECT id FROM kunder WHERE organization_id = p_organization_id);

  -- Delete rute_kunder associations
  DELETE FROM rute_kunder
  WHERE rute_id IN (SELECT id FROM ruter WHERE organization_id = p_organization_id);

  -- Delete email_varsler
  DELETE FROM email_varsler
  WHERE organization_id = p_organization_id;

  -- Delete kunder
  DELETE FROM kunder WHERE organization_id = p_organization_id;

  -- Delete ruter
  DELETE FROM ruter WHERE organization_id = p_organization_id;

  -- Delete brukere
  DELETE FROM brukere WHERE organization_id = p_organization_id;

  -- Delete API keys
  DELETE FROM api_keys WHERE organization_id = p_organization_id;

  -- Delete webhooks
  DELETE FROM webhook_endpoints WHERE organization_id = p_organization_id;
  DELETE FROM webhook_deliveries WHERE organization_id = p_organization_id;

  -- Delete integrations
  DELETE FROM integrations WHERE organization_id = p_organization_id;

  -- Delete import sessions and staged data
  DELETE FROM import_sessions WHERE organization_id = p_organization_id;

  -- Delete klient
  DELETE FROM klient WHERE organization_id = p_organization_id;

  -- Delete subscription events
  DELETE FROM subscription_events WHERE organization_id = p_organization_id;

  -- Delete deletion requests
  DELETE FROM account_deletion_requests WHERE organization_id = p_organization_id;

  -- Finally delete the organization
  DELETE FROM organizations WHERE id = p_organization_id;

  RETURN TRUE;
END;
$$;

-- ============ Function to cancel a deletion request ============

CREATE OR REPLACE FUNCTION cancel_deletion_request(
  p_request_id INTEGER,
  p_cancelled_by INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_request RECORD;
BEGIN
  -- Get the request
  SELECT * INTO v_request
  FROM account_deletion_requests
  WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Update the request
  UPDATE account_deletion_requests
  SET
    status = 'cancelled',
    cancelled_at = v_now,
    cancelled_by = p_cancelled_by,
    updated_at = v_now
  WHERE id = p_request_id;

  -- Remove soft-delete flags from organization
  UPDATE organizations
  SET
    deleted_at = NULL,
    deletion_requested_at = NULL,
    deletion_requested_by = NULL,
    updated_at = v_now
  WHERE id = v_request.organization_id;

  -- Remove soft-delete flags from users
  UPDATE klient
  SET deleted_at = NULL
  WHERE organization_id = v_request.organization_id;

  UPDATE brukere
  SET deleted_at = NULL
  WHERE organization_id = v_request.organization_id;

  RETURN TRUE;
END;
$$;

-- ============ View for pending deletions ============

CREATE OR REPLACE VIEW pending_deletions AS
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

-- ============ RLS policies for deletion requests ============

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Organization owners can view their own deletion requests
CREATE POLICY deletion_requests_select_own ON account_deletion_requests
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'organization_id')::INTEGER);

-- Only service role can insert/update deletion requests
CREATE POLICY deletion_requests_service_all ON account_deletion_requests
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============ Add comment for documentation ============

COMMENT ON TABLE account_deletion_requests IS 'GDPR-compliant account deletion tracking with 30-day grace period';
COMMENT ON FUNCTION soft_delete_organization IS 'Soft-deletes an organization and all associated users';
COMMENT ON FUNCTION permanently_delete_organization IS 'Permanently removes all data for an organization (called after grace period)';
COMMENT ON FUNCTION cancel_deletion_request IS 'Cancels a pending deletion request and restores the account';
