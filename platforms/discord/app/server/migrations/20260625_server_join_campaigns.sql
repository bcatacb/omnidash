-- Server join campaign tables.
-- A campaign queues accounts to join a guild over multiple days via rotating
-- invite codes, with per-account scheduled_at timestamps so joins are spread
-- naturally instead of bursting.

CREATE TABLE IF NOT EXISTS tenant_main.server_join_campaigns (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id             text        NOT NULL,
  guild_name           text,
  guild_icon           text,
  invite_codes         text[]      NOT NULL DEFAULT '{}',
  joins_per_day        int         NOT NULL DEFAULT 10,
  min_account_age_days int         NOT NULL DEFAULT 0,
  post_join_action     text        NOT NULL DEFAULT 'browse'
    CHECK (post_join_action IN ('browse', 'outreach', 'none')),
  status               text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_main.server_join_queue (
  id             bigserial   PRIMARY KEY,
  campaign_id    uuid        NOT NULL
    REFERENCES tenant_main.server_join_campaigns ON DELETE CASCADE,
  account_id     text        NOT NULL,
  invite_code    text        NOT NULL,
  scheduled_at   timestamptz NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','joining','joined','failed','skipped')),
  attempt_count  int         NOT NULL DEFAULT 0,
  joined_at      timestamptz,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One account per campaign only
CREATE UNIQUE INDEX IF NOT EXISTS server_join_queue_unique_account
  ON tenant_main.server_join_queue (campaign_id, account_id);

-- Fast next-due lookup
CREATE INDEX IF NOT EXISTS server_join_queue_pending_scheduled
  ON tenant_main.server_join_queue (scheduled_at)
  WHERE status = 'pending';

-- Dashboard queries
CREATE INDEX IF NOT EXISTS server_join_queue_campaign_status
  ON tenant_main.server_join_queue (campaign_id, status);
