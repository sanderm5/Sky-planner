-- 036: Internal chat system for technician communication
-- Adds tables for org-wide and DM conversations with messages and read tracking

-- ============================================================
-- 1. Conversations (org channel or DM)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_conversations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('org', 'dm')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_org
  ON chat_conversations(organization_id, type);

-- ============================================================
-- 2. DM participants (not needed for org channel — all org members participate)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_participants (
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user
  ON chat_participants(user_id);

-- ============================================================
-- 3. Messages
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_time
  ON chat_messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_id
  ON chat_messages(conversation_id, id DESC);

-- ============================================================
-- 4. Read status per user per conversation
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_read_status (
  user_id INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  last_read_message_id INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, conversation_id)
);

-- ============================================================
-- 5. RLS Policies
-- ============================================================

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_read_status ENABLE ROW LEVEL SECURITY;

-- Conversations: users can see conversations in their org
DROP POLICY IF EXISTS chat_conversations_tenant_isolation ON chat_conversations;
CREATE POLICY chat_conversations_tenant_isolation ON chat_conversations
  USING (organization_id = current_setting('app.current_tenant_id', true)::integer);

-- Participants: users can see participant records for conversations in their org
DROP POLICY IF EXISTS chat_participants_tenant_isolation ON chat_participants;
CREATE POLICY chat_participants_tenant_isolation ON chat_participants
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE organization_id = current_setting('app.current_tenant_id', true)::integer
    )
  );

-- Messages: users can see messages for conversations in their org
DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;
CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE organization_id = current_setting('app.current_tenant_id', true)::integer
    )
  );

-- Read status: users can manage their own read status
DROP POLICY IF EXISTS chat_read_status_tenant_isolation ON chat_read_status;
CREATE POLICY chat_read_status_tenant_isolation ON chat_read_status
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE organization_id = current_setting('app.current_tenant_id', true)::integer
    )
  );

-- Service role bypass (for server-side operations)
DROP POLICY IF EXISTS chat_conversations_service ON chat_conversations;
CREATE POLICY chat_conversations_service ON chat_conversations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS chat_participants_service ON chat_participants;
CREATE POLICY chat_participants_service ON chat_participants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS chat_messages_service ON chat_messages;
CREATE POLICY chat_messages_service ON chat_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS chat_read_status_service ON chat_read_status;
CREATE POLICY chat_read_status_service ON chat_read_status
  FOR ALL TO service_role USING (true) WITH CHECK (true);
