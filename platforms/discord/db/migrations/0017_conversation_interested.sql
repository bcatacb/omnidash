-- 0017_conversation_interested.sql
-- Add the per-conversation "interested" star flag.
SET search_path = tenant_main;

ALTER TABLE tenant_main.conversations
  ADD COLUMN IF NOT EXISTS interested boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversations_interested
  ON tenant_main.conversations(interested)
  WHERE interested = true;
