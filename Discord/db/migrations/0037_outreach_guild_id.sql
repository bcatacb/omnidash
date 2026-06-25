-- Outreach campaigns now record the guild the leads were scraped from.
-- When set, the engine opens DM channels through the browser with guild
-- context (X-Context-Properties: User Profile + guild_id) instead of
-- using the raw tlsFetch path.
ALTER TABLE tenant_main.campaigns
  ADD COLUMN IF NOT EXISTS guild_id TEXT DEFAULT NULL;
