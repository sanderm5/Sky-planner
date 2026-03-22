-- Migration 061: Support chat ticket system between superadmin and organizations
-- Each support request is a separate ticket with ID, subject and status

-- 1. Expand type CHECK to include 'support'
ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_type_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_type_check
  CHECK (type IN ('org', 'dm', 'support'));

-- 2. Add ticket fields (only used for type='support')
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open'
  CHECK (status IS NULL OR status IN ('open', 'closed'));

-- 3. Drop the old unique constraint (multiple tickets per org allowed)
DROP INDEX IF EXISTS idx_chat_conversations_support_unique;

-- 4. Index for finding open support tickets per org
CREATE INDEX IF NOT EXISTS idx_chat_conversations_support_org
  ON chat_conversations(organization_id, status) WHERE type = 'support';
