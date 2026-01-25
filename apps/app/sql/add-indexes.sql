-- Database indexes for Sky Planner
-- Run this migration to improve query performance at scale
-- Created: 2026-01-24

-- ============================================================
-- KUNDER (Customers) - Primary table for multi-tenant queries
-- ============================================================

-- Critical for multi-tenant filtering - every query filters by org
CREATE INDEX IF NOT EXISTS idx_kunder_org_id ON kunder(organization_id);

-- Composite index for category filtering within organization
CREATE INDEX IF NOT EXISTS idx_kunder_org_kategori ON kunder(organization_id, kategori);

-- Composite index for area/location searches
CREATE INDEX IF NOT EXISTS idx_kunder_org_poststed ON kunder(organization_id, poststed);

-- Composite index for control date queries (el-kontroll alerts)
CREATE INDEX IF NOT EXISTS idx_kunder_org_el_kontroll ON kunder(organization_id, neste_el_kontroll);

-- Composite index for control date queries (brann-kontroll alerts)
CREATE INDEX IF NOT EXISTS idx_kunder_org_brann_kontroll ON kunder(organization_id, neste_brann_kontroll);

-- Index for active/inactive customer filtering
CREATE INDEX IF NOT EXISTS idx_kunder_org_aktiv ON kunder(organization_id, aktiv);

-- Index for name sorting (used in most list queries)
CREATE INDEX IF NOT EXISTS idx_kunder_navn ON kunder(navn COLLATE NOCASE);


-- ============================================================
-- EMAIL_VARSLER (Email notifications)
-- ============================================================

-- Composite index for email history lookups per customer
CREATE INDEX IF NOT EXISTS idx_email_varsler_kunde ON email_varsler(kunde_id, type, status);

-- Index for querying by status (pending emails to send)
CREATE INDEX IF NOT EXISTS idx_email_varsler_status ON email_varsler(status);

-- Index for date-based queries (email history)
CREATE INDEX IF NOT EXISTS idx_email_varsler_opprettet ON email_varsler(opprettet DESC);


-- ============================================================
-- KONTAKTLOGG (Contact log)
-- ============================================================

-- Composite index for customer contact history with org filtering
CREATE INDEX IF NOT EXISTS idx_kontaktlogg_kunde_org ON kontaktlogg(kunde_id, organization_id);

-- Index for date sorting
CREATE INDEX IF NOT EXISTS idx_kontaktlogg_dato ON kontaktlogg(dato DESC);


-- ============================================================
-- RUTER (Routes)
-- ============================================================

-- Index for multi-tenant route queries
CREATE INDEX IF NOT EXISTS idx_ruter_org_id ON ruter(organization_id);

-- Index for route status filtering
CREATE INDEX IF NOT EXISTS idx_ruter_org_status ON ruter(organization_id, status);


-- ============================================================
-- RUTE_KUNDER (Route-Customer mapping)
-- ============================================================

-- Index for getting customers in a route
CREATE INDEX IF NOT EXISTS idx_rute_kunder_rute ON rute_kunder(rute_id);

-- Index for finding routes containing a customer
CREATE INDEX IF NOT EXISTS idx_rute_kunder_kunde ON rute_kunder(kunde_id);


-- ============================================================
-- AVTALER (Appointments)
-- ============================================================

-- Index for multi-tenant appointment queries
CREATE INDEX IF NOT EXISTS idx_avtaler_org_id ON avtaler(organization_id);

-- Composite index for date range queries within organization
CREATE INDEX IF NOT EXISTS idx_avtaler_org_dato ON avtaler(organization_id, dato);

-- Index for customer appointment lookup
CREATE INDEX IF NOT EXISTS idx_avtaler_kunde ON avtaler(kunde_id);


-- ============================================================
-- ORGANIZATIONS
-- ============================================================

-- Index for Stripe webhook lookups
CREATE INDEX IF NOT EXISTS idx_org_stripe_customer ON organizations(stripe_customer_id);

-- Index for slug-based lookups (multi-tenant URL routing)
CREATE INDEX IF NOT EXISTS idx_org_slug ON organizations(slug);


-- ============================================================
-- BRUKER (Users)
-- ============================================================

-- Index for email-based login lookups
CREATE INDEX IF NOT EXISTS idx_bruker_epost ON bruker(epost);

-- Index for multi-tenant user queries
CREATE INDEX IF NOT EXISTS idx_bruker_org_id ON bruker(organization_id);


-- ============================================================
-- REFRESH_TOKENS
-- ============================================================

-- Index for token validation (already exists but ensure it's there)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Index for user token cleanup
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Index for expired token cleanup
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
