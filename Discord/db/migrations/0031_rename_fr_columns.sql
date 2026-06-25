-- Rename fr_ prefix columns in leads to dm_ — the "friend request" naming
-- was a legacy artifact; these columns track DM send state.
ALTER TABLE tenant_main.leads
  RENAME COLUMN fr_sent_at TO dm_sent_at;

ALTER TABLE tenant_main.leads
  RENAME COLUMN fr_error TO dm_error;
