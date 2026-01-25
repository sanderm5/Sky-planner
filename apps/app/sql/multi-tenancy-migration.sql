-- =====================================================
-- MULTI-TENANCY MIGRATION FOR SAAS
-- Kjør dette i Supabase SQL Editor
-- =====================================================
--
-- Denne migreringen konverterer systemet fra single-tenant
-- til multi-tenant SaaS med full dataisolasjon.
--
-- VIKTIG: Ta backup før du kjører dette!
-- =====================================================

-- =====================================================
-- STEG 1: OPPRETT ORGANIZATIONS TABELL
-- =====================================================

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  navn TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,              -- URL-vennlig: "tre-allservice", "acme-elektro"

  -- Branding
  logo_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#F97316',
  secondary_color VARCHAR(7) DEFAULT '#1E293B',
  brand_title TEXT,                       -- Vises i header, f.eks. "TREkontroll"
  brand_subtitle TEXT,                    -- Undertittel

  -- Kontaktinfo
  firma_adresse TEXT,
  firma_telefon TEXT,
  firma_epost TEXT,
  firma_orgnr TEXT,                       -- Org.nr for fakturering

  -- Kart-innstillinger (per tenant)
  map_center_lat DECIMAL(10, 7) DEFAULT 65.5,
  map_center_lng DECIMAL(10, 7) DEFAULT 12.0,
  map_zoom INTEGER DEFAULT 5,
  route_start_lat DECIMAL(10, 7),
  route_start_lng DECIMAL(10, 7),
  route_start_address TEXT,

  -- Abonnement og begrensninger
  plan_type TEXT DEFAULT 'standard',      -- free, standard, professional, enterprise
  max_kunder INTEGER DEFAULT 200,
  max_brukere INTEGER DEFAULT 5,
  features JSONB DEFAULT '{}',            -- Feature flags per tenant

  -- Billing (for fremtidig integrasjon)
  stripe_customer_id TEXT,
  subscription_status TEXT DEFAULT 'active',  -- active, past_due, canceled, trialing
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Status
  aktiv BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indekser
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_aktiv ON organizations(aktiv);
CREATE INDEX IF NOT EXISTS idx_organizations_subscription ON organizations(subscription_status);

-- =====================================================
-- STEG 2: LEGG TIL organization_id PÅ BRUKERTABELLER
-- =====================================================

-- Klient-tabellen (portal-brukere)
ALTER TABLE klient ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_klient_organization ON klient(organization_id);

-- Brukere-tabellen (admin/ansatte)
ALTER TABLE brukere ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_brukere_organization ON brukere(organization_id);

-- Auth tokens må også ha organization context
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);

-- =====================================================
-- STEG 3: LEGG TIL organization_id PÅ DATATABELLER
-- =====================================================

-- Kunder (hovedtabellen)
ALTER TABLE kunder ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_kunder_organization ON kunder(organization_id);

-- Ruter
ALTER TABLE ruter ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_ruter_organization ON ruter(organization_id);

-- Rute-kunder kobling
ALTER TABLE rute_kunder ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);

-- Avtaler
ALTER TABLE avtaler ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_avtaler_organization ON avtaler(organization_id);

-- Kontaktlogg
ALTER TABLE kontaktlogg ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_kontaktlogg_organization ON kontaktlogg(organization_id);

-- Email varsler
ALTER TABLE email_varsler ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_email_varsler_organization ON email_varsler(organization_id);

-- Email innstillinger
ALTER TABLE email_innstillinger ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);

-- Kontroll historikk (hvis den eksisterer)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kontroll_historikk') THEN
    ALTER TABLE kontroll_historikk ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
    CREATE INDEX IF NOT EXISTS idx_kontroll_historikk_organization ON kontroll_historikk(organization_id);
  END IF;
END $$;

-- Login logg
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'login_logg') THEN
    ALTER TABLE login_logg ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
    CREATE INDEX IF NOT EXISTS idx_login_logg_organization ON login_logg(organization_id);
  END IF;
END $$;

-- =====================================================
-- STEG 4: ORGANISASJONER OPPRETTES DYNAMISK
-- =====================================================
-- Organisasjoner opprettes via registrering på skyplanner.no
-- Ingen hardkodede demo-data - alt er dynamisk per bedrift

-- =====================================================
-- STEG 5: MIGRER EKSISTERENDE DATA (HVIS NOEN FINNES)
-- =====================================================
-- Data migreres til riktig organisasjon basert på klient-tilknytning

-- =====================================================
-- STEG 6: AKTIVER ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Aktiver RLS på alle datatabeller
ALTER TABLE kunder ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruter ENABLE ROW LEVEL SECURITY;
ALTER TABLE rute_kunder ENABLE ROW LEVEL SECURITY;
ALTER TABLE avtaler ENABLE ROW LEVEL SECURITY;
ALTER TABLE kontaktlogg ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_varsler ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_innstillinger ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- STEG 7: OPPRETT RLS POLICIES
-- =====================================================

-- Funksjon for å hente gjeldende tenant fra JWT eller session
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS INTEGER AS $$
BEGIN
  -- Prøv å hente fra JWT claim først
  RETURN NULLIF(current_setting('request.jwt.claims', true)::json->>'organization_id', '')::INTEGER;
EXCEPTION
  WHEN OTHERS THEN
    -- Fallback til app-setting
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Policy for kunder: Kun se egen tenant's data
-- VIKTIG: Krever at tenant_id er satt - NULL gir INGEN tilgang (sikkerhet)
DROP POLICY IF EXISTS "tenant_isolation_kunder" ON kunder;
CREATE POLICY "tenant_isolation_kunder" ON kunder
  FOR ALL
  USING (
    get_current_tenant_id() IS NOT NULL
    AND organization_id = get_current_tenant_id()
  );

-- Policy for ruter
DROP POLICY IF EXISTS "tenant_isolation_ruter" ON ruter;
CREATE POLICY "tenant_isolation_ruter" ON ruter
  FOR ALL
  USING (
    get_current_tenant_id() IS NOT NULL
    AND organization_id = get_current_tenant_id()
  );

-- Policy for rute_kunder
DROP POLICY IF EXISTS "tenant_isolation_rute_kunder" ON rute_kunder;
CREATE POLICY "tenant_isolation_rute_kunder" ON rute_kunder
  FOR ALL
  USING (
    get_current_tenant_id() IS NOT NULL
    AND organization_id = get_current_tenant_id()
  );

-- Policy for avtaler
DROP POLICY IF EXISTS "tenant_isolation_avtaler" ON avtaler;
CREATE POLICY "tenant_isolation_avtaler" ON avtaler
  FOR ALL
  USING (
    get_current_tenant_id() IS NOT NULL
    AND organization_id = get_current_tenant_id()
  );

-- Policy for kontaktlogg
DROP POLICY IF EXISTS "tenant_isolation_kontaktlogg" ON kontaktlogg;
CREATE POLICY "tenant_isolation_kontaktlogg" ON kontaktlogg
  FOR ALL
  USING (
    get_current_tenant_id() IS NOT NULL
    AND organization_id = get_current_tenant_id()
  );

-- Policy for email_varsler
DROP POLICY IF EXISTS "tenant_isolation_email_varsler" ON email_varsler;
CREATE POLICY "tenant_isolation_email_varsler" ON email_varsler
  FOR ALL
  USING (
    get_current_tenant_id() IS NOT NULL
    AND organization_id = get_current_tenant_id()
  );

-- Policy for email_innstillinger
DROP POLICY IF EXISTS "tenant_isolation_email_innstillinger" ON email_innstillinger;
CREATE POLICY "tenant_isolation_email_innstillinger" ON email_innstillinger
  FOR ALL
  USING (
    get_current_tenant_id() IS NOT NULL
    AND organization_id = get_current_tenant_id()
  );

-- Policy for organizations (brukere kan kun se sin egen org)
DROP POLICY IF EXISTS "tenant_isolation_organizations" ON organizations;
CREATE POLICY "tenant_isolation_organizations" ON organizations
  FOR SELECT
  USING (
    get_current_tenant_id() IS NOT NULL
    AND id = get_current_tenant_id()
  );

-- Service role bypass (for backend)
DROP POLICY IF EXISTS "service_role_bypass_kunder" ON kunder;
CREATE POLICY "service_role_bypass_kunder" ON kunder
  FOR ALL
  TO service_role
  USING (true);

DROP POLICY IF EXISTS "service_role_bypass_ruter" ON ruter;
CREATE POLICY "service_role_bypass_ruter" ON ruter
  FOR ALL
  TO service_role
  USING (true);

DROP POLICY IF EXISTS "service_role_bypass_organizations" ON organizations;
CREATE POLICY "service_role_bypass_organizations" ON organizations
  FOR ALL
  TO service_role
  USING (true);

-- =====================================================
-- STEG 8: HJELPEFUNKSJONER
-- =====================================================

-- Funksjon for å opprette ny organisasjon med admin-bruker
CREATE OR REPLACE FUNCTION create_organization_with_admin(
  p_org_navn TEXT,
  p_org_slug TEXT,
  p_admin_navn TEXT,
  p_admin_epost TEXT,
  p_admin_passord_hash TEXT,
  p_primary_color VARCHAR(7) DEFAULT '#F97316'
)
RETURNS TABLE(organization_id INTEGER, admin_id INTEGER) AS $$
DECLARE
  v_org_id INTEGER;
  v_admin_id INTEGER;
BEGIN
  -- Opprett organisasjon
  INSERT INTO organizations (navn, slug, primary_color)
  VALUES (p_org_navn, p_org_slug, p_primary_color)
  RETURNING id INTO v_org_id;

  -- Opprett admin-bruker
  INSERT INTO klient (navn, epost, passord_hash, organization_id, aktiv)
  VALUES (p_admin_navn, p_admin_epost, p_admin_passord_hash, v_org_id, true)
  RETURNING id INTO v_admin_id;

  RETURN QUERY SELECT v_org_id, v_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funksjon for å sjekke tenant-grenser
CREATE OR REPLACE FUNCTION check_tenant_limits()
RETURNS TRIGGER AS $$
DECLARE
  v_max_kunder INTEGER;
  v_current_count INTEGER;
BEGIN
  -- Hent grense for tenant
  SELECT max_kunder INTO v_max_kunder
  FROM organizations
  WHERE id = NEW.organization_id;

  -- Tell eksisterende kunder
  SELECT COUNT(*) INTO v_current_count
  FROM kunder
  WHERE organization_id = NEW.organization_id;

  -- Sjekk grense
  IF v_current_count >= v_max_kunder THEN
    RAISE EXCEPTION 'Kundelimit nådd for denne organisasjonen (maks: %)', v_max_kunder;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for å sjekke grenser ved ny kunde
DROP TRIGGER IF EXISTS check_kunde_limit ON kunder;
CREATE TRIGGER check_kunde_limit
  BEFORE INSERT ON kunder
  FOR EACH ROW
  EXECUTE FUNCTION check_tenant_limits();

-- =====================================================
-- STEG 9: OPPDATER TIMESTAMP AUTOMATISK
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_updated_at ON organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- FERDIG!
-- =====================================================
--
-- Neste steg:
-- 1. Oppdater server.js med tenant-middleware
-- 2. Oppdater alle API-endepunkter
-- 3. Oppdater frontend med dynamisk branding
--
-- For å teste, opprett en ny organisasjon:
-- SELECT * FROM create_organization_with_admin(
--   'Test Elektro AS',
--   'test-elektro',
--   'Admin Testesen',
--   'admin@testelektro.no',
--   '$2b$10$...'  -- Husk å hashe passord!
-- );
-- =====================================================
