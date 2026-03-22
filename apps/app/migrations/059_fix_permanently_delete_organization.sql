-- Migration 059: Fix permanently_delete_organization function
-- The function referenced non-existent tables causing GDPR cron job failures:
--   - "integrations" → correct name is "organization_integrations"
--   - "import_sessions" → doesn't exist (import tables: import_batches, import_mapping_templates, etc.)
--   - "subscription_events" → doesn't exist
-- Also adds explicit deletion for tables added after migration 013.

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
  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Delete in correct order to respect foreign keys
  -- 1. Tables referencing kunder (must go before kunder deletion)

  DELETE FROM public.kontaktlogg
  WHERE kunde_id IN (SELECT id FROM public.kunder WHERE organization_id = p_organization_id);

  DELETE FROM public.avtaler
  WHERE kunde_id IN (SELECT id FROM public.kunder WHERE organization_id = p_organization_id);

  DELETE FROM public.kontaktpersoner
  WHERE kunde_id IN (SELECT id FROM public.kunder WHERE organization_id = p_organization_id);

  DELETE FROM public.kunde_tags
  WHERE kunde_id IN (SELECT id FROM public.kunder WHERE organization_id = p_organization_id);

  DELETE FROM public.kunde_subcategories
  WHERE kunde_id IN (SELECT id FROM public.kunder WHERE organization_id = p_organization_id);

  DELETE FROM public.ukeplan_notater
  WHERE organization_id = p_organization_id;

  DELETE FROM public.customer_emails_sent
  WHERE organization_id = p_organization_id;

  DELETE FROM public.rute_kunde_visits
  WHERE organization_id = p_organization_id;

  -- 2. Rute associations (before ruter deletion)
  DELETE FROM public.rute_kunder
  WHERE rute_id IN (SELECT id FROM public.ruter WHERE organization_id = p_organization_id);

  -- 3. Email notifications
  DELETE FROM public.email_varsler
  WHERE organization_id = p_organization_id;

  -- 4. Core data
  DELETE FROM public.kunder WHERE organization_id = p_organization_id;
  DELETE FROM public.ruter WHERE organization_id = p_organization_id;
  DELETE FROM public.brukere WHERE organization_id = p_organization_id;

  -- 5. API and webhooks
  DELETE FROM public.api_keys WHERE organization_id = p_organization_id;
  DELETE FROM public.webhook_endpoints WHERE organization_id = p_organization_id;
  DELETE FROM public.webhook_deliveries WHERE organization_id = p_organization_id;

  -- 6. Integrations (corrected table name)
  DELETE FROM public.organization_integrations WHERE organization_id = p_organization_id;
  DELETE FROM public.integration_sync_log WHERE organization_id = p_organization_id;
  DELETE FROM public.failed_sync_items WHERE organization_id = p_organization_id;

  -- 7. Import data
  DELETE FROM public.import_batches WHERE organization_id = p_organization_id;
  DELETE FROM public.import_mapping_templates WHERE organization_id = p_organization_id;
  DELETE FROM public.import_column_history WHERE organization_id = p_organization_id;
  DELETE FROM public.import_audit_log WHERE organization_id = p_organization_id;

  -- 8. Tags and groups
  DELETE FROM public.tags WHERE organization_id = p_organization_id;
  DELETE FROM public.tag_groups WHERE organization_id = p_organization_id;

  -- 9. Organization config
  DELETE FROM public.organization_features WHERE organization_id = p_organization_id;
  DELETE FROM public.organization_service_types WHERE organization_id = p_organization_id;
  DELETE FROM public.coverage_areas WHERE organization_id = p_organization_id;

  -- 10. Communication
  DELETE FROM public.chat_messages WHERE organization_id = p_organization_id;
  DELETE FROM public.customer_email_templates WHERE organization_id = p_organization_id;

  -- 11. Auth and account
  DELETE FROM public.klient WHERE organization_id = p_organization_id;
  DELETE FROM public.account_deletion_requests WHERE organization_id = p_organization_id;

  -- 12. Finally delete the organization
  DELETE FROM public.organizations WHERE id = p_organization_id;

  RETURN TRUE;
END;
$$;
