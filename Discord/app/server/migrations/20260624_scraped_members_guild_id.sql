-- Store guild_id + guild_name directly on scraped_members so members
-- remain filterable by server even after the originating job is deleted.
ALTER TABLE tenant_main.scraped_members
  ADD COLUMN IF NOT EXISTS guild_id   text,
  ADD COLUMN IF NOT EXISTS guild_name text;

-- Backfill from active jobs (orphaned rows stay NULL — caught by index).
UPDATE tenant_main.scraped_members sm
SET guild_id   = j.guild_id,
    guild_name = j.guild_name
FROM tenant_main.member_scraper_jobs j
WHERE sm.job_id = j.id
  AND sm.guild_id IS NULL;

CREATE INDEX IF NOT EXISTS scraped_members_guild_id_idx
  ON tenant_main.scraped_members (guild_id);
