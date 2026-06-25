-- 0010_campaign_mode_both.sql
--
-- v0.14: add 'both' mode — sends a DM and a Friend Request to each lead in the
-- same step. DM goes first (shared-server DM-open is more likely to succeed
-- before the FR triggers any "stranger" friction); FR fires regardless.
--
-- Caps (perHour/perDay/inter-send) come from the operator — no implicit DM-mode
-- floor in this mode. UI shows recommended values before confirm.

ALTER TABLE tenant_main.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_mode_check;

ALTER TABLE tenant_main.campaigns
  ADD CONSTRAINT campaigns_mode_check
  CHECK (mode IN ('fr','dm','both'));
