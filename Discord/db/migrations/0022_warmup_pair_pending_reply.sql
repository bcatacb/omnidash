-- 0022_warmup_pair_pending_reply.sql — track which account owes a reply in a
-- warmup pair so the engine can drive true back-and-forth conversations.

SET search_path TO tenant_main, public;

ALTER TABLE warmup_campaign_pairs
  ADD COLUMN IF NOT EXISTS pending_reply_from TEXT;
