-- v2.0.4: store the unique Discord username on FR leads so the browser can
-- use Discord's own "Add Friend by username" UI flow for cold contacts
-- (no mutual guild required, pure Playwright stealth).
ALTER TABLE tenant_main.fr_campaign_leads
  ADD COLUMN IF NOT EXISTS username text;
