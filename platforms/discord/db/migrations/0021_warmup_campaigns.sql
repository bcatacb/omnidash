-- 0021_warmup_campaigns.sql — continuous operator-controlled warmup campaigns.

SET search_path TO tenant_main, public;

CREATE TABLE IF NOT EXISTS warmup_campaigns (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('draft','running','paused','cancelled')) DEFAULT 'draft',
  active_hours_start_utc smallint NOT NULL DEFAULT 9   CHECK (active_hours_start_utc BETWEEN 0 AND 23),
  active_hours_end_utc   smallint NOT NULL DEFAULT 21  CHECK (active_hours_end_utc   BETWEEN 0 AND 23),
  per_account_interval_min_minutes integer NOT NULL DEFAULT 30,
  per_account_interval_max_minutes integer NOT NULL DEFAULT 90,
  started_at      timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warmup_campaign_accounts (
  campaign_id     text NOT NULL REFERENCES warmup_campaigns(id) ON DELETE CASCADE,
  account_id      text NOT NULL REFERENCES discord_accounts(id) ON DELETE CASCADE,
  message_bank    jsonb NOT NULL DEFAULT '[]'::jsonb,
  msgs_sent_count integer NOT NULL DEFAULT 0,
  partners_reached_count integer NOT NULL DEFAULT 0,
  last_sent_at    timestamptz,
  next_eligible_at timestamptz,
  dead_since      timestamptz,
  PRIMARY KEY (campaign_id, account_id)
);
CREATE INDEX IF NOT EXISTS warmup_campaign_accounts_acct_idx ON warmup_campaign_accounts(account_id);

CREATE TABLE IF NOT EXISTS warmup_campaign_pairs (
  campaign_id     text NOT NULL REFERENCES warmup_campaigns(id) ON DELETE CASCADE,
  account_a_id    text NOT NULL REFERENCES discord_accounts(id) ON DELETE CASCADE,
  account_b_id    text NOT NULL REFERENCES discord_accounts(id) ON DELETE CASCADE,
  channel_id_a_to_b text,
  channel_id_b_to_a text,
  msgs_a_to_b     integer NOT NULL DEFAULT 0,
  msgs_b_to_a     integer NOT NULL DEFAULT 0,
  paused_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (account_a_id < account_b_id),
  PRIMARY KEY (campaign_id, account_a_id, account_b_id)
);

CREATE TABLE IF NOT EXISTS warmup_campaign_messages (
  id              bigserial PRIMARY KEY,
  campaign_id     text NOT NULL REFERENCES warmup_campaigns(id) ON DELETE CASCADE,
  sender_account_id   text NOT NULL,
  recipient_account_id text NOT NULL,
  content         text NOT NULL,
  ok              boolean NOT NULL,
  http_status     integer,
  captcha_solved  boolean DEFAULT false,
  cost_cents      numeric(6,3) DEFAULT 0,
  error           text,
  sent_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warmup_campaign_messages_campaign_idx
  ON warmup_campaign_messages(campaign_id, sent_at DESC);
