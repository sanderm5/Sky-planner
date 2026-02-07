-- =====================================================
-- KOMPLETT DATABASE SETUP FOR SKY PLANNER
-- Kjør dette i Supabase SQL Editor
-- =====================================================
-- Dette scriptet oppretter ALLE tabeller fra bunnen av
-- inkludert multi-tenancy støtte.
-- =====================================================

-- =====================================================
-- STEG 1: GRUNNLEGGENDE TABELLER
-- =====================================================

-- 1.1 ORGANIZATIONS (Multi-tenancy)
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  navn TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,

  -- Branding
  logo_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#F97316',
  secondary_color VARCHAR(7) DEFAULT '#1E293B',
  brand_title TEXT,
  brand_subtitle TEXT,

  -- Kontaktinfo
  firma_adresse TEXT,
  firma_telefon TEXT,
  firma_epost TEXT,
  firma_orgnr TEXT,

  -- Kart-innstillinger
  map_center_lat DECIMAL(10, 7) DEFAULT 65.5,
  map_center_lng DECIMAL(10, 7) DEFAULT 12.0,
  map_zoom INTEGER DEFAULT 5,
  route_start_lat DECIMAL(10, 7),
  route_start_lng DECIMAL(10, 7),
  route_start_address TEXT,

  -- Abonnement
  plan_type TEXT DEFAULT 'standard',
  max_kunder INTEGER DEFAULT 200,
  max_brukere INTEGER DEFAULT 5,
  features JSONB DEFAULT '{}',

  -- Billing
  stripe_customer_id TEXT,
  subscription_status TEXT DEFAULT 'active',
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Status
  aktiv BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_aktiv ON organizations(aktiv);

-- 1.2 KLIENT (Portal-brukere / Kunder av SaaS)
CREATE TABLE IF NOT EXISTS klient (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  navn TEXT NOT NULL,
  epost TEXT NOT NULL UNIQUE,
  passord_hash TEXT NOT NULL,
  telefon TEXT,
  adresse TEXT,
  postnummer TEXT,
  poststed TEXT,
  aktiv BOOLEAN DEFAULT true,
  sist_innlogget TIMESTAMPTZ,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_klient_epost ON klient(epost);
CREATE INDEX IF NOT EXISTS idx_klient_organization ON klient(organization_id);

-- 1.3 BRUKERE (Admin/ansatte)
CREATE TABLE IF NOT EXISTS brukere (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  navn TEXT NOT NULL,
  epost TEXT UNIQUE NOT NULL,
  passord_hash TEXT NOT NULL,
  rolle TEXT DEFAULT 'admin',
  aktiv BOOLEAN DEFAULT true,
  sist_innlogget TIMESTAMPTZ,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brukere_epost ON brukere(epost);
CREATE INDEX IF NOT EXISTS idx_brukere_organization ON brukere(organization_id);

-- 1.4 AUTH_TOKENS (Sessions)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('klient', 'bruker')),
  epost TEXT NOT NULL,
  rolle TEXT DEFAULT 'klient',
  remember_me BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);

-- 1.5 PASSWORD_RESET_TOKENS
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('klient', 'bruker')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_token_hash ON password_reset_tokens(token_hash);

-- =====================================================
-- STEG 2: KUNDEDATA TABELLER
-- =====================================================

-- 2.1 KUNDER (Hovedtabell for kundedata)
CREATE TABLE IF NOT EXISTS kunder (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  navn TEXT NOT NULL,
  adresse TEXT NOT NULL,
  postnummer TEXT,
  poststed TEXT,
  telefon TEXT,
  epost TEXT,
  lat REAL,
  lng REAL,

  -- Kategori og type (no default - set based on industry template)
  kategori TEXT,
  el_type TEXT,
  brann_system TEXT,
  brann_driftstype TEXT,
  driftskategori TEXT,

  -- El-Kontroll datoer
  siste_el_kontroll DATE,
  neste_el_kontroll DATE,
  el_kontroll_intervall INTEGER DEFAULT 36,

  -- Brannvarsling datoer
  siste_brann_kontroll DATE,
  neste_brann_kontroll DATE,
  brann_kontroll_intervall INTEGER DEFAULT 12,

  -- Legacy felt
  siste_kontroll DATE,
  neste_kontroll DATE,
  kontroll_intervall_mnd INTEGER DEFAULT 12,

  notater TEXT,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kunder_organization ON kunder(organization_id);
CREATE INDEX IF NOT EXISTS idx_kunder_poststed ON kunder(poststed);
CREATE INDEX IF NOT EXISTS idx_kunder_kategori ON kunder(kategori);
CREATE INDEX IF NOT EXISTS idx_kunder_neste_el ON kunder(neste_el_kontroll);
CREATE INDEX IF NOT EXISTS idx_kunder_neste_brann ON kunder(neste_brann_kontroll);

-- 2.2 RUTER (Planlagte serviceruter)
CREATE TABLE IF NOT EXISTS ruter (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  navn TEXT NOT NULL,
  beskrivelse TEXT,
  planlagt_dato DATE,
  total_distanse REAL,
  total_tid INTEGER,
  status TEXT DEFAULT 'planlagt',
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ruter_organization ON ruter(organization_id);
CREATE INDEX IF NOT EXISTS idx_ruter_status ON ruter(status);

-- 2.3 RUTE_KUNDER (Kobling)
CREATE TABLE IF NOT EXISTS rute_kunder (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  rute_id INTEGER REFERENCES ruter(id) ON DELETE CASCADE,
  kunde_id INTEGER REFERENCES kunder(id) ON DELETE CASCADE,
  rekkefolge INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rute_kunder_rute ON rute_kunder(rute_id);
CREATE INDEX IF NOT EXISTS idx_rute_kunder_kunde ON rute_kunder(kunde_id);

-- 2.4 AVTALER (Kalender)
CREATE TABLE IF NOT EXISTS avtaler (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  kunde_id INTEGER REFERENCES kunder(id) ON DELETE CASCADE,
  dato DATE NOT NULL,
  klokkeslett TIME,
  type VARCHAR(50),
  beskrivelse TEXT,
  status VARCHAR(20) DEFAULT 'planlagt',
  opprettet_av VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avtaler_organization ON avtaler(organization_id);
CREATE INDEX IF NOT EXISTS idx_avtaler_dato ON avtaler(dato);
CREATE INDEX IF NOT EXISTS idx_avtaler_kunde_id ON avtaler(kunde_id);

-- 2.5 KONTAKTLOGG (Kundekontakt-historikk)
CREATE TABLE IF NOT EXISTS kontaktlogg (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  kunde_id INTEGER REFERENCES kunder(id) ON DELETE CASCADE,
  dato TIMESTAMPTZ DEFAULT NOW(),
  type VARCHAR(50) DEFAULT 'Telefonsamtale',
  notat TEXT,
  opprettet_av VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kontaktlogg_organization ON kontaktlogg(organization_id);
CREATE INDEX IF NOT EXISTS idx_kontaktlogg_kunde_id ON kontaktlogg(kunde_id);

-- 2.6 KONTROLL_HISTORIKK
CREATE TABLE IF NOT EXISTS kontroll_historikk (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  kontroll_dato DATE NOT NULL,
  utfort_av TEXT,
  kategori TEXT,
  notater TEXT,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kontroll_historikk_organization ON kontroll_historikk(organization_id);
CREATE INDEX IF NOT EXISTS idx_kontroll_historikk_kunde ON kontroll_historikk(kunde_id);

-- =====================================================
-- STEG 3: EMAIL OG LOGGING TABELLER
-- =====================================================

-- 3.1 EMAIL_VARSLER
CREATE TABLE IF NOT EXISTS email_varsler (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  kunde_id INTEGER REFERENCES kunder(id) ON DELETE CASCADE,
  epost TEXT,
  emne TEXT,
  melding TEXT,
  type TEXT,
  status TEXT DEFAULT 'pending',
  sendt_dato TIMESTAMPTZ,
  feil_melding TEXT,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_varsler_organization ON email_varsler(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_varsler_status ON email_varsler(status);

-- 3.2 EMAIL_INNSTILLINGER
CREATE TABLE IF NOT EXISTS email_innstillinger (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  kunde_id INTEGER UNIQUE REFERENCES kunder(id) ON DELETE CASCADE,
  email_aktiv INTEGER DEFAULT 1,
  forste_varsel_dager INTEGER DEFAULT 30,
  paaminnelse_etter_dager INTEGER DEFAULT 7
);

-- 3.3 LOGIN_LOGG
CREATE TABLE IF NOT EXISTS login_logg (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  epost TEXT NOT NULL,
  bruker_navn TEXT,
  bruker_type TEXT,
  status TEXT NOT NULL,
  ip_adresse TEXT,
  user_agent TEXT,
  feil_melding TEXT,
  tidspunkt TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_logg_organization ON login_logg(organization_id);
CREATE INDEX IF NOT EXISTS idx_login_logg_tidspunkt ON login_logg(tidspunkt DESC);

-- =====================================================
-- STEG 4: ORGANISASJONER OPPRETTES DYNAMISK
-- =====================================================
-- Organisasjoner opprettes via registrering på skyplanner.no
-- Ingen hardkodede demo-data - alt er dynamisk per bedrift

-- =====================================================
-- STEG 5: ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Aktiver RLS på alle datatabeller
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient ENABLE ROW LEVEL SECURITY;
ALTER TABLE brukere ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE kunder ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruter ENABLE ROW LEVEL SECURITY;
ALTER TABLE rute_kunder ENABLE ROW LEVEL SECURITY;
ALTER TABLE avtaler ENABLE ROW LEVEL SECURITY;
ALTER TABLE kontaktlogg ENABLE ROW LEVEL SECURITY;
ALTER TABLE kontroll_historikk ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_varsler ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_innstillinger ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_logg ENABLE ROW LEVEL SECURITY;

-- Service role bypass (for backend med service_role key)
CREATE POLICY "service_role_full_access" ON organizations FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON klient FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON brukere FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON auth_tokens FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON kunder FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON ruter FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON rute_kunder FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON avtaler FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON kontaktlogg FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON kontroll_historikk FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON email_varsler FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON email_innstillinger FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON login_logg FOR ALL TO service_role USING (true);

-- =====================================================
-- STEG 6: HJELPEFUNKSJONER
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
  SELECT max_kunder INTO v_max_kunder
  FROM organizations
  WHERE id = NEW.organization_id;

  SELECT COUNT(*) INTO v_current_count
  FROM kunder
  WHERE organization_id = NEW.organization_id;

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

-- Funksjon for å rydde opp utløpte tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM auth_tokens WHERE expires_at < NOW();
  DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Funksjon for å oppdatere updated_at automatisk
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
-- 1. Kjør dette scriptet i Supabase SQL Editor
-- 2. Registrer organisasjon via skyplanner.no
--
-- For å opprette admin-bruker manuelt:
-- 1. Generer bcrypt hash: node -e "console.log(require('bcrypt').hashSync('passord', 10))"
-- 2. Kjør SQL:
--    INSERT INTO klient (navn, epost, passord_hash, organization_id, aktiv)
--    VALUES ('Admin', 'admin@treallservice.no', '<HASH>', 1, true);
-- =====================================================
