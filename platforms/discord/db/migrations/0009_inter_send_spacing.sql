-- 0009_inter_send_spacing.sql
--
-- v0.13.2: per-campaign global rest between ANY two sends across all accounts.
-- Was: each tick (5s) could fire up to 5 sends from 5 different accounts.
-- Now: campaign-level cooldown enforced. Defaults:
--   dm mode: 1800s (30 minutes)
--   fr mode:  600s (10 minutes)
-- Existing rows get backfilled accordingly.

ALTER TABLE tenant_main.campaigns
  ADD COLUMN IF NOT EXISTS min_inter_send_seconds integer NOT NULL DEFAULT 600;

UPDATE tenant_main.campaigns
   SET min_inter_send_seconds = CASE
     WHEN mode = 'dm' THEN 1800
     ELSE 600
   END
 WHERE min_inter_send_seconds = 600;
