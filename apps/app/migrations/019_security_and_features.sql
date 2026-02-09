-- 019_security_and_features.sql
-- Security enhancements and feature additions for SaaS launch

-- ============ 2FA Rate Limiting ============
-- Add attempts counter to prevent brute force on TOTP codes

ALTER TABLE totp_pending_sessions
ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- ============ Customer Status ============
-- Track customer lifecycle: aktiv, inaktiv, prospekt, avsluttet

ALTER TABLE kunder
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'aktiv';

-- Add constraint separately (IF NOT EXISTS not supported for constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kunder_status_check'
  ) THEN
    ALTER TABLE kunder ADD CONSTRAINT kunder_status_check
      CHECK (status IN ('aktiv', 'inaktiv', 'prospekt', 'avsluttet'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_kunder_status ON kunder(status);
CREATE INDEX IF NOT EXISTS idx_kunder_org_status ON kunder(organization_id, status);

-- ============ Contact Persons ============
-- Multiple contacts per customer with roles

CREATE TABLE IF NOT EXISTS kontaktpersoner (
  id SERIAL PRIMARY KEY,
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  navn TEXT NOT NULL,
  rolle TEXT CHECK (rolle IN ('teknisk', 'faktura', 'daglig', 'annet')),
  telefon TEXT,
  epost TEXT,
  er_primaer BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kontaktpersoner_kunde ON kontaktpersoner(kunde_id);
CREATE INDEX IF NOT EXISTS idx_kontaktpersoner_org ON kontaktpersoner(organization_id);

-- ============ Tags ============
-- Flexible tagging system for customers

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  navn TEXT NOT NULL,
  farge TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, navn)
);

CREATE TABLE IF NOT EXISTS kunde_tags (
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (kunde_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_kunde_tags_tag ON kunde_tags(tag_id);

-- ============ Security Audit Log ============
-- Comprehensive audit logging for all security-relevant events

CREATE TABLE IF NOT EXISTS security_audit_log (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  user_id INTEGER,
  user_type VARCHAR(10) CHECK (user_type IN ('klient', 'bruker')),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id TEXT,
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_org ON security_audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit_log(user_id, user_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_action ON security_audit_log(action, created_at DESC);

-- ============ Recurring Appointments ============
-- Add recurrence support to avtaler

ALTER TABLE avtaler
ADD COLUMN IF NOT EXISTS gjentakelse_regel TEXT,
ADD COLUMN IF NOT EXISTS gjentakelse_slutt DATE,
ADD COLUMN IF NOT EXISTS er_gjentakelse BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS original_avtale_id INTEGER REFERENCES avtaler(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_avtaler_gjentakelse ON avtaler(er_gjentakelse) WHERE er_gjentakelse = TRUE;
CREATE INDEX IF NOT EXISTS idx_avtaler_original ON avtaler(original_avtale_id) WHERE original_avtale_id IS NOT NULL;

-- ============ Active Sessions ============
-- Track user sessions for session management UI

CREATE TABLE IF NOT EXISTS active_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('klient', 'bruker')),
  jti TEXT NOT NULL UNIQUE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  device_info TEXT,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id, user_type);
CREATE INDEX IF NOT EXISTS idx_active_sessions_jti ON active_sessions(jti);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires ON active_sessions(expires_at);

-- ============ RLS Policies ============

ALTER TABLE kontaktpersoner ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE kunde_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;

-- Service role access for all new tables
DROP POLICY IF EXISTS kontaktpersoner_service_only ON kontaktpersoner;
CREATE POLICY kontaktpersoner_service_only ON kontaktpersoner
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS tags_service_only ON tags;
CREATE POLICY tags_service_only ON tags
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS kunde_tags_service_only ON kunde_tags;
CREATE POLICY kunde_tags_service_only ON kunde_tags
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS security_audit_service_only ON security_audit_log;
CREATE POLICY security_audit_service_only ON security_audit_log
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS active_sessions_service_only ON active_sessions;
CREATE POLICY active_sessions_service_only ON active_sessions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============ Comments ============

COMMENT ON TABLE kontaktpersoner IS 'Contact persons associated with a customer';
COMMENT ON TABLE tags IS 'Organization-scoped tags for categorizing customers';
COMMENT ON TABLE kunde_tags IS 'Many-to-many relation between customers and tags';
COMMENT ON TABLE security_audit_log IS 'Comprehensive audit trail for security-relevant events';
COMMENT ON TABLE active_sessions IS 'Active user sessions for session management';
COMMENT ON COLUMN kunder.status IS 'Customer lifecycle status: aktiv, inaktiv, prospekt, avsluttet';
COMMENT ON COLUMN avtaler.gjentakelse_regel IS 'Recurrence rule in RRULE format (RFC 5545)';
COMMENT ON COLUMN totp_pending_sessions.attempts IS 'Number of verification attempts (max 5)';
