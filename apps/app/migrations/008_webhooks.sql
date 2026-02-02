-- ============================================
-- SKY PLANNER - Webhook System
-- ============================================
-- Enables outbound notifications when data changes
-- ============================================

-- 1. Webhook endpoints registered by organizations
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Endpoint configuration
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- Events to subscribe to (array of event types)
  events TEXT[] NOT NULL DEFAULT '{}',

  -- Security - HMAC secret for signature verification
  secret_hash TEXT NOT NULL,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Reliability tracking
  failure_count INTEGER DEFAULT 0,
  last_failure_at TIMESTAMP WITH TIME ZONE,
  last_success_at TIMESTAMP WITH TIME ZONE,
  disabled_at TIMESTAMP WITH TIME ZONE,
  disabled_reason TEXT,

  -- Audit
  created_by INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(organization_id, name)
);

-- 2. Webhook delivery log (for retry and debugging)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id SERIAL PRIMARY KEY,
  webhook_endpoint_id INTEGER NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL,

  -- Event details
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,

  -- Delivery status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),

  -- Attempt tracking
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  next_retry_at TIMESTAMP WITH TIME ZONE,

  -- Response details
  response_status INTEGER,
  response_body TEXT,
  response_time_ms INTEGER,

  -- Error info
  error_message TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivered_at TIMESTAMP WITH TIME ZONE
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org ON webhook_endpoints(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active ON webhook_endpoints(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries(webhook_endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org ON webhook_deliveries(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at)
  WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries(created_at DESC);

-- 4. Enable Row Level Security
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for webhook_endpoints (organization-scoped)
CREATE POLICY IF NOT EXISTS "Webhook endpoints are viewable by organization members"
  ON webhook_endpoints FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid()
    )
  );

CREATE POLICY IF NOT EXISTS "Webhook endpoints are insertable by organization admins"
  ON webhook_endpoints FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid() AND rolle = 'admin'
    )
  );

CREATE POLICY IF NOT EXISTS "Webhook endpoints are updatable by organization admins"
  ON webhook_endpoints FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid() AND rolle = 'admin'
    )
  );

CREATE POLICY IF NOT EXISTS "Webhook endpoints are deletable by organization admins"
  ON webhook_endpoints FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid() AND rolle = 'admin'
    )
  );

-- 6. RLS Policies for webhook_deliveries (organization-scoped)
CREATE POLICY IF NOT EXISTS "Webhook deliveries are viewable by organization members"
  ON webhook_deliveries FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM bruker WHERE id = auth.uid()
    )
  );

-- ============================================
-- Done! Webhook tables created
-- ============================================
