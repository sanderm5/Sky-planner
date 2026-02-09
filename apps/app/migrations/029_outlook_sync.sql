-- Migration 029: Outlook contact sync tables

-- Outlook sync log - tracks which customers have been synced to Outlook
CREATE TABLE IF NOT EXISTS outlook_sync_log (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  outlook_contact_id TEXT,         -- ID in Microsoft Graph
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  sync_status TEXT DEFAULT 'synced',  -- synced, failed, deleted
  error_message TEXT,
  UNIQUE(organization_id, kunde_id)
);

CREATE INDEX IF NOT EXISTS idx_outlook_sync_org ON outlook_sync_log(organization_id);

-- RLS
ALTER TABLE outlook_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outlook_sync_service ON outlook_sync_log;
CREATE POLICY outlook_sync_service ON outlook_sync_log
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
