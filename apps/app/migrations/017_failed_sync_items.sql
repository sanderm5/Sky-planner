-- Failed sync items table for retry mechanism
-- Tracks individual customer sync failures and retries them on subsequent syncs

CREATE TABLE IF NOT EXISTS failed_sync_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  integration_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_source TEXT NOT NULL,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  status TEXT DEFAULT 'pending',  -- pending | resolved | permanently_failed
  last_attempt_at DATETIME,
  next_retry_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, integration_id, external_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_failed_sync_org ON failed_sync_items(organization_id, integration_id);
CREATE INDEX IF NOT EXISTS idx_failed_sync_status ON failed_sync_items(status, next_retry_at);
