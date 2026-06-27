-- 0008_last_message_direction.sql
--
-- v0.12.2: track the direction of the latest message on each conversation,
-- so the Unibox "Needs reply" filter can be EXACT ("they wrote last") rather
-- than a count-based heuristic.
--
-- Backfill from existing messages so the filter is correct for all current
-- conversations, not just future ones.

ALTER TABLE tenant_main.conversations
  ADD COLUMN IF NOT EXISTS last_message_direction text;

-- Backfill: for every conversation, set the column to the direction of the
-- most-recently-sent message. Conversations with no messages stay NULL.
UPDATE tenant_main.conversations c
   SET last_message_direction = sub.direction
  FROM (
    SELECT DISTINCT ON (conversation_id) conversation_id, direction
      FROM tenant_main.messages
     ORDER BY conversation_id, sent_at DESC
  ) sub
 WHERE c.id = sub.conversation_id;
