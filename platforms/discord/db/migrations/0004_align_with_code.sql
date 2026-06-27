-- 0004_align_with_code.sql
--
-- Drop the v0.6 tenant tables and recreate them with the column shapes the
-- v0.7 server actually uses (string ids, discord user info on each side,
-- message author name+avatar, encrypted token column, etc).
--
-- v0.7 single-tenant: writes go to tenant_main.* directly. We dual-write
-- from the existing in-memory state for now; reads stay against memory but
-- are hydrated from the DB on boot.
--
-- Run order: AFTER 0003. Idempotent (DROP IF EXISTS + CREATE).

DROP TABLE IF EXISTS tenant_main.messages CASCADE;
DROP TABLE IF EXISTS tenant_main.conversations CASCADE;
DROP TABLE IF EXISTS tenant_main.discord_accounts CASCADE;

CREATE TABLE tenant_main.discord_accounts (
  id                text PRIMARY KEY,
  label             text NOT NULL,
  username          text NOT NULL,
  discord_user_id   text,
  avatar_url        text,
  status            text NOT NULL DEFAULT 'connecting',
  token_encrypted   bytea,                      -- AES-256-GCM blob (iv||tag||ct), or NULL
  proxy_id          text,
  friends_count     integer NOT NULL DEFAULT 0,
  pending_outgoing  integer NOT NULL DEFAULT 0,
  last_status_at    timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX discord_accounts_status_idx ON tenant_main.discord_accounts (status);

CREATE TABLE tenant_main.conversations (
  id                    text PRIMARY KEY,
  account_id            text NOT NULL REFERENCES tenant_main.discord_accounts(id) ON DELETE CASCADE,
  peer_discord_user_id  text NOT NULL,
  peer_display_name     text NOT NULL,
  peer_avatar_url       text,
  channel_type          text,                   -- 'dm' | 'group_dm'
  last_message_preview  text,
  last_message_at       timestamptz NOT NULL DEFAULT now(),
  unread_count          integer NOT NULL DEFAULT 0,
  label                 text NOT NULL DEFAULT 'inbox'  CHECK (label IN ('inbox','archived'))
);

CREATE INDEX conversations_account_idx ON tenant_main.conversations (account_id);
CREATE INDEX conversations_last_message_at_idx ON tenant_main.conversations (last_message_at DESC);

CREATE TABLE tenant_main.messages (
  id                text PRIMARY KEY,
  conversation_id   text NOT NULL REFERENCES tenant_main.conversations(id) ON DELETE CASCADE,
  direction         text NOT NULL CHECK (direction IN ('in','out')),
  body              text NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  author_name       text NOT NULL,
  author_avatar_url text
);

CREATE INDEX messages_conv_sent_idx ON tenant_main.messages (conversation_id, sent_at);
