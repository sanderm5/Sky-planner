-- Migration 026: Field work mode
-- Enables route execution with per-customer visit tracking

-- Add execution columns to ruter
ALTER TABLE ruter ADD COLUMN IF NOT EXISTS execution_started_at TIMESTAMPTZ;
ALTER TABLE ruter ADD COLUMN IF NOT EXISTS execution_ended_at TIMESTAMPTZ;
ALTER TABLE ruter ADD COLUMN IF NOT EXISTS current_stop_index INTEGER DEFAULT 0;

-- Per-customer visit records during field work
CREATE TABLE IF NOT EXISTS rute_kunde_visits (
  id SERIAL PRIMARY KEY,
  rute_id INTEGER NOT NULL REFERENCES ruter(id) ON DELETE CASCADE,
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ,
  completed BOOLEAN DEFAULT false,
  comment TEXT,
  materials_used TEXT[],
  equipment_registered TEXT[],
  todos TEXT[],
  travel_time_minutes INTEGER,
  travel_distance_km DECIMAL(8,2),
  UNIQUE(rute_id, kunde_id)
);

CREATE INDEX IF NOT EXISTS idx_rute_visits_rute ON rute_kunde_visits(rute_id);
CREATE INDEX IF NOT EXISTS idx_rute_visits_org ON rute_kunde_visits(organization_id);

-- RLS
ALTER TABLE rute_kunde_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rute_visits_service ON rute_kunde_visits;
CREATE POLICY rute_visits_service ON rute_kunde_visits
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
