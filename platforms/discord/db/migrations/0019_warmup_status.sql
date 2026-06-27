-- 0019_warmup_status.sql
--
-- v0.70: account warmup state machine + audit + curated warmup server list.
-- Goal: gate all outreach behind `warmed`/`outreach` so the v0.65 burn (3
-- accounts 4004'd in one test campaign) can't repeat. Each account moves
-- through a state machine driven by warmup-engine.ts:
--
--   captured ──proxy assigned──> warming ──Day 10──> warmed ──> outreach
--                                  │
--                                  │ (4004)
--                                  ▼
--                              quarantined ──Day 7──> retired
--
-- (No `soaking` phase — operator chose light active warmup from Day 1.)

ALTER TABLE tenant_main.discord_accounts
  ADD COLUMN IF NOT EXISTS warmup_status text NOT NULL DEFAULT 'captured'
    CHECK (warmup_status IN ('captured','warming','warmed','outreach','quarantined','retired')),
  ADD COLUMN IF NOT EXISTS warmup_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_action_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_accounts_warmup_status
  ON tenant_main.discord_accounts(warmup_status);

-- Curated list of public Discord servers warmup-actions can join. The
-- operator-curated subset prevents accounts from joining 4chan-mirror /
-- raid / phone-verify-gated servers. Seeded via separate INSERTs in
-- warmup-servers-seed.sql (next migration ships the rows).
CREATE TABLE IF NOT EXISTS tenant_main.warmup_servers (
  id                bigserial PRIMARY KEY,
  invite_code       text NOT NULL UNIQUE,   -- the 'AbCdEf' from discord.gg/AbCdEf
  label             text NOT NULL,          -- short human name for logs
  category          text NOT NULL DEFAULT 'general' CHECK (category IN ('gaming','crypto','general','tech','community')),
  default_channel_id text,                  -- where warmup_engine posts channel messages; populated by seeder or first-join sync
  active            boolean NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warmup_servers_active_category
  ON tenant_main.warmup_servers(active, category);

-- Append-only audit trail. One row per warmup-engine action attempt. Used
-- for: (a) day-boundary throttling (count today's actions per account),
-- (b) post-mortem when an account burns ("what was its last action?"),
-- (c) per-account captcha-cost reporting.
CREATE TABLE IF NOT EXISTS tenant_main.warmup_actions (
  id              bigserial PRIMARY KEY,
  account_id      text NOT NULL REFERENCES tenant_main.discord_accounts(id) ON DELETE CASCADE,
  action_type     text NOT NULL CHECK (action_type IN (
    'join_server','channel_post','react_message','set_avatar','set_bio',
    'set_status','accept_friend','inter_account_dm','state_transition'
  )),
  target_id       text,                    -- guild id / channel id / partner account id / etc.
  success         boolean NOT NULL,
  http_status     int,
  error           text,
  captcha_solved  boolean NOT NULL DEFAULT false,
  captcha_cost_cents int NOT NULL DEFAULT 0,
  spintax_seed    text,                    -- so we can replay the exact content variant
  payload         text,                    -- redacted content actually sent (channel post body, etc.)
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warmup_actions_account_time
  ON tenant_main.warmup_actions(account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_warmup_actions_action_time
  ON tenant_main.warmup_actions(action_type, occurred_at DESC);
