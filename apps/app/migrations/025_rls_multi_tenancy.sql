-- Migration: 023_rls_multi_tenancy.sql
-- Defense-in-depth: Row Level Security for multi-tenancy isolation
-- Even though application code filters by organization_id, RLS provides database-level safety net
--
-- NOTE: service_role key bypasses RLS by default in Supabase.
-- The primary protection is application-level organization_id filtering
-- in database.ts (validateTenantContext + mandatory organizationId parameters).
-- RLS is an additional safety net for direct database access scenarios.

ALTER TABLE kunder ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruter ENABLE ROW LEVEL SECURITY;
ALTER TABLE avtaler ENABLE ROW LEVEL SECURITY;
ALTER TABLE kontaktlogg ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_integrations ENABLE ROW LEVEL SECURITY;
