-- 0006_campaign_mode.sql
--
-- v0.9: add `mode` column distinguishing FR-first vs direct-DM campaigns.
-- Existing rows default to 'fr' (current behavior). 'dm' opens a DM channel
-- and posts the template; if Discord 50007s, lead is flagged for FR fallback.

ALTER TABLE tenant_main.campaigns
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'fr'
    CHECK (mode IN ('fr','dm'));

-- Bump leads with the dm-error sub-state so the UI can show "needs FR".
ALTER TABLE tenant_main.leads
  DROP CONSTRAINT IF EXISTS leads_fr_status_check;
ALTER TABLE tenant_main.leads
  ADD CONSTRAINT leads_fr_status_check
  CHECK (fr_status IN ('pending','sent','accepted','declined','expired','error','dm_blocked'));
