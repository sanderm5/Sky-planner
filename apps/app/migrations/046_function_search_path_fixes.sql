-- Migration 046: Fix Function Search Path Mutable
-- Fixes Supabase database linter WARNs:
--   Functions without SET search_path are vulnerable to search_path injection.
--   A malicious user could create objects in a different schema that get
--   resolved before the intended public schema objects.
--
-- Fix: Recreate each function with SET search_path = '' and fully-qualified
-- table references (public.tablename).
--
-- NOTE: get_public_tables is not in migrations — fix it separately if needed.


-- ============================================================
-- 1. update_import_updated_at (trigger function)
-- ============================================================
CREATE OR REPLACE FUNCTION update_import_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ============================================================
-- 2. soft_delete_organization
-- ============================================================
CREATE OR REPLACE FUNCTION soft_delete_organization(
  p_organization_id INTEGER,
  p_deleted_by INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Mark organization as deleted
  UPDATE public.organizations
  SET
    deleted_at = v_now,
    updated_at = v_now
  WHERE id = p_organization_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Mark all klient in the organization as deleted
  UPDATE public.klient
  SET deleted_at = v_now
  WHERE organization_id = p_organization_id
    AND deleted_at IS NULL;

  -- Mark all brukere in the organization as deleted
  UPDATE public.brukere
  SET deleted_at = v_now
  WHERE organization_id = p_organization_id
    AND deleted_at IS NULL;

  -- Log the deletion
  INSERT INTO public.security_audit_log (
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


-- ============================================================
-- 3. permanently_delete_organization
-- ============================================================
CREATE OR REPLACE FUNCTION permanently_delete_organization(
  p_organization_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org RECORD;
BEGIN
  -- Get organization details for logging
  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Delete in correct order to respect foreign keys

  -- Delete kontaktlogg
  DELETE FROM public.kontaktlogg
  WHERE kunde_id IN (SELECT id FROM public.kunder WHERE organization_id = p_organization_id);

  -- Delete avtaler
  DELETE FROM public.avtaler
  WHERE kunde_id IN (SELECT id FROM public.kunder WHERE organization_id = p_organization_id);

  -- Delete rute_kunder associations
  DELETE FROM public.rute_kunder
  WHERE rute_id IN (SELECT id FROM public.ruter WHERE organization_id = p_organization_id);

  -- Delete email_varsler
  DELETE FROM public.email_varsler
  WHERE organization_id = p_organization_id;

  -- Delete kunder
  DELETE FROM public.kunder WHERE organization_id = p_organization_id;

  -- Delete ruter
  DELETE FROM public.ruter WHERE organization_id = p_organization_id;

  -- Delete brukere
  DELETE FROM public.brukere WHERE organization_id = p_organization_id;

  -- Delete API keys
  DELETE FROM public.api_keys WHERE organization_id = p_organization_id;

  -- Delete webhooks
  DELETE FROM public.webhook_endpoints WHERE organization_id = p_organization_id;
  DELETE FROM public.webhook_deliveries WHERE organization_id = p_organization_id;

  -- Delete integrations
  DELETE FROM public.integrations WHERE organization_id = p_organization_id;

  -- Delete import sessions and staged data
  DELETE FROM public.import_sessions WHERE organization_id = p_organization_id;

  -- Delete klient
  DELETE FROM public.klient WHERE organization_id = p_organization_id;

  -- Delete subscription events
  DELETE FROM public.subscription_events WHERE organization_id = p_organization_id;

  -- Delete deletion requests
  DELETE FROM public.account_deletion_requests WHERE organization_id = p_organization_id;

  -- Finally delete the organization
  DELETE FROM public.organizations WHERE id = p_organization_id;

  RETURN TRUE;
END;
$$;


-- ============================================================
-- 4. cancel_deletion_request
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_deletion_request(
  p_request_id INTEGER,
  p_cancelled_by INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_request RECORD;
BEGIN
  -- Get the request
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Update the request
  UPDATE public.account_deletion_requests
  SET
    status = 'cancelled',
    cancelled_at = v_now,
    cancelled_by = p_cancelled_by,
    updated_at = v_now
  WHERE id = p_request_id;

  -- Remove soft-delete flags from organization
  UPDATE public.organizations
  SET
    deleted_at = NULL,
    deletion_requested_at = NULL,
    deletion_requested_by = NULL,
    updated_at = v_now
  WHERE id = v_request.organization_id;

  -- Remove soft-delete flags from users
  UPDATE public.klient
  SET deleted_at = NULL
  WHERE organization_id = v_request.organization_id;

  UPDATE public.brukere
  SET deleted_at = NULL
  WHERE organization_id = v_request.organization_id;

  RETURN TRUE;
END;
$$;


-- ============================================================
-- 5. cleanup_expired_totp_sessions
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_expired_totp_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.totp_pending_sessions
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


-- ============================================================
-- 6. get_public_tables
-- ============================================================
CREATE OR REPLACE FUNCTION get_public_tables()
RETURNS TABLE(tablename TEXT)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT table_name::text
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE';
$$;
