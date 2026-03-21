-- Huskeliste/notater per kunde per uke i ukeplanen
CREATE TABLE IF NOT EXISTS ukeplan_notater (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  uke_start DATE NOT NULL,
  notat TEXT NOT NULL,
  fullfort BOOLEAN DEFAULT false,
  opprettet_av TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE ukeplan_notater ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ukeplan_notater_org_isolation" ON ukeplan_notater;
CREATE POLICY "ukeplan_notater_org_isolation" ON ukeplan_notater
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id', true)::INTEGER)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::INTEGER);

-- Index for rask oppslag per org + uke
CREATE INDEX IF NOT EXISTS idx_ukeplan_notater_org_uke ON ukeplan_notater(organization_id, uke_start);
CREATE INDEX IF NOT EXISTS idx_ukeplan_notater_kunde ON ukeplan_notater(kunde_id);
