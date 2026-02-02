-- ============================================
-- SKY PLANNER - API Keys System
-- ============================================
-- Enables external systems to authenticate via API keys
-- ============================================

-- 1. API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Key identification (never store the full key, only hash)
  key_prefix TEXT NOT NULL,           -- First 16 chars for display (sk_live_abc12345...)
  key_hash TEXT NOT NULL UNIQUE,      -- SHA-256 hash of full key
  name TEXT NOT NULL,                 -- Descriptive name (e.g., "CRM Integration")
  description TEXT,

  -- Permissions & Scopes
  scopes TEXT[] NOT NULL DEFAULT '{}', -- ['customers:read', 'customers:write', 'routes:read']

  -- Rate limiting per key
  rate_limit_requests INTEGER DEFAULT 1000,       -- Requests per window
  rate_limit_window_seconds INTEGER DEFAULT 3600, -- Window size (default 1 hour)

  -- Quotas
  monthly_quota INTEGER,              -- NULL = unlimited
  quota_used_this_month INTEGER DEFAULT 0,
  quota_reset_at TIMESTAMP WITH TIME ZONE,

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,

  -- Audit
  created_by INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by INTEGER,
  revoked_reason TEXT,

  UNIQUE(organization_id, name)
);

-- 2. API Key usage logs for analytics and debugging
CREATE TABLE IF NOT EXISTS api_key_usage_log (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL,

  -- Request details
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER,

  -- Request metadata
  ip_address TEXT,
  user_agent TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key ON api_key_usage_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_org ON api_key_usage_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_created ON api_key_usage_log(created_at DESC);

-- 4. Enable Row Level Security
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_usage_log ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for api_keys (organization-scoped)
CREATE POLICY IF NOT EXISTS "API keys are viewable by organization members"
  ON api_keys FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid()
    )
  );

CREATE POLICY IF NOT EXISTS "API keys are insertable by organization admins"
  ON api_keys FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid() AND rolle = 'admin'
    )
  );

CREATE POLICY IF NOT EXISTS "API keys are updatable by organization admins"
  ON api_keys FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid() AND rolle = 'admin'
    )
  );

CREATE POLICY IF NOT EXISTS "API keys are deletable by organization admins"
  ON api_keys FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid() AND rolle = 'admin'
    )
  );

-- 6. RLS Policies for api_key_usage_log (organization-scoped)
CREATE POLICY IF NOT EXISTS "API key usage logs are viewable by organization members"
  ON api_key_usage_log FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid()
    )
  );

-- ============================================
-- Done! API Keys tables created
-- ============================================
