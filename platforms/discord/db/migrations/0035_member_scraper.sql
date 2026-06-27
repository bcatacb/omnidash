-- 0035: member scraper jobs + scraped members pool

CREATE TABLE IF NOT EXISTS tenant_main.member_scraper_jobs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         text        NOT NULL,
  guild_id           text        NOT NULL,
  guild_name         text,
  status             text        NOT NULL DEFAULT 'idle'
                                 CHECK (status IN ('idle','running','paused','error')),
  interval_minutes   integer     NOT NULL DEFAULT 60,
  last_scraped_at    timestamptz,
  next_scrape_at     timestamptz,
  members_new        integer     NOT NULL DEFAULT 0,
  members_total      integer     NOT NULL DEFAULT 0,
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, guild_id)
);

CREATE TABLE IF NOT EXISTS tenant_main.scraped_members (
  id               bigserial   PRIMARY KEY,
  job_id           uuid        NOT NULL REFERENCES tenant_main.member_scraper_jobs(id) ON DELETE CASCADE,
  discord_user_id  text        NOT NULL,
  username         text        NOT NULL,
  global_name      text,
  avatar_url       text,
  fr_status        text        NOT NULL DEFAULT 'pending'
                               CHECK (fr_status IN ('pending','fr_queued','fr_sent')),
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS scraped_members_job_fr ON tenant_main.scraped_members (job_id, fr_status);
CREATE INDEX IF NOT EXISTS scraped_members_fr_status ON tenant_main.scraped_members (fr_status);
