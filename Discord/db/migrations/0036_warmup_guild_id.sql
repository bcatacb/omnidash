-- Warmup campaigns now navigate to a shared guild before opening DM channels
-- so the first contact looks like a real user clicking "Message" inside a server.
ALTER TABLE tenant_main.warmup_campaigns
  ADD COLUMN IF NOT EXISTS guild_id TEXT DEFAULT NULL;
