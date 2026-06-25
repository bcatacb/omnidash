-- 0011_scraped_guild_cache.sql
--
-- v0.20: persist guild-member scrape results so the wizard reuses them
-- instead of re-hitting Discord every time. One row per (account, guild) —
-- the member list lives in a JSONB column (we don't need per-member queries).

CREATE TABLE IF NOT EXISTS tenant_main.scraped_guild_members (
  account_id      text        NOT NULL REFERENCES tenant_main.discord_accounts(id) ON DELETE CASCADE,
  guild_id        text        NOT NULL,
  guild_name      text,
  member_count    integer     NOT NULL DEFAULT 0,
  members         jsonb       NOT NULL,   -- array of { id, username, globalName, avatarUrl, nick }
  via             text,                   -- 'op8' | 'op14'
  truncated       boolean     NOT NULL DEFAULT false,
  scraped_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, guild_id)
);

CREATE INDEX IF NOT EXISTS scraped_guild_members_account_idx
  ON tenant_main.scraped_guild_members (account_id);
