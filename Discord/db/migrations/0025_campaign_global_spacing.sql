-- 0025_campaign_global_spacing.sql
-- Adds min_global_spacing_seconds: minimum wait between ANY two sends in a
-- campaign, regardless of which account is sending. Prevents 40-account
-- campaigns from firing a DM every 5 seconds on startup.

SET search_path TO tenant_main, public;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS min_global_spacing_seconds INTEGER NOT NULL DEFAULT 300;
