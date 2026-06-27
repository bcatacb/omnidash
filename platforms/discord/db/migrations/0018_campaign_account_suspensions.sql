-- 0018_campaign_account_suspensions.sql
--
-- v0.33: per-(campaign, account) suspension list. When the engine panic-pauses
-- a campaign because an account hit a fatal Discord signal (captcha-required,
-- 401 revoked, 403 limited, 429 punishment), we also record the (campaign,
-- account) pair here. Pre-assigned leads for that account get rebalanced to
-- other eligible non-suspended accounts. Suspension survives the operator's
-- "Resume" action until they explicitly clear it on the campaign detail page.

CREATE TABLE IF NOT EXISTS tenant_main.campaign_account_suspensions (
  campaign_id   text NOT NULL,
  account_id    text NOT NULL,
  suspended_at  timestamp with time zone NOT NULL DEFAULT now(),
  reason        text NOT NULL DEFAULT '',
  PRIMARY KEY (campaign_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_cas_account ON tenant_main.campaign_account_suspensions(account_id);
