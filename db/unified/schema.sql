-- Unified Database Schema for OmniDash (omnibox)
-- Single DB for operator-level account + unified inbox across platforms.
-- 
-- Philosophy:
-- - One operator user.
-- - Platform accounts are linked to the operator (not tenants for now).
-- - Conversations and messages are normalized for the unified inbox.
-- - Platform-specific details go in JSONB `meta` columns.
-- - The platform backends (or their services) are responsible for writing
--   normalized data here when messages are sent/received.
-- - The frontend transformers read from a (future) unified API backed by this DB.
--
-- This replaces having three separate databases for the core unified experience.
-- Platform execution models remain separate (API vs Playwright).

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Operator Level
-- ============================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Platform Accounts (owned by the operator)
-- ============================================

CREATE TABLE platform_accounts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL CHECK (platform IN ('telegram', 'discord', 'tiktok')),
  label               TEXT,                    -- e.g. "Main Account", "Alt #3"
  external_id         TEXT,                    -- platform's native id (telegram id, discord user id, tiktok uid)
  username            TEXT,
  status              TEXT DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error', 'warming')),
  credentials         JSONB,                   -- token, session data, etc. (encrypted at rest in prod)
  proxy_id            TEXT,                    -- reference to proxy if managed centrally
  last_connected_at   TIMESTAMPTZ,
  meta                JSONB DEFAULT '{}',      -- platform specific (e.g. device profile for TG, browser fingerprint hints)
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_platform_accounts_user ON platform_accounts(user_id);
CREATE INDEX idx_platform_accounts_platform ON platform_accounts(platform);
CREATE UNIQUE INDEX idx_platform_accounts_unique ON platform_accounts(user_id, platform, external_id);

-- ============================================
-- Unified Inbox: Conversations
-- ============================================

CREATE TABLE conversations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_account_id UUID NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,
  peer_id             TEXT NOT NULL,           -- normalized peer identifier
  peer_display_name   TEXT,
  peer_username       TEXT,
  last_message_at     TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_direction TEXT CHECK (last_message_direction IN ('in', 'out')),
  unread_count        INTEGER DEFAULT 0,
  archived            BOOLEAN DEFAULT false,
  interested          BOOLEAN DEFAULT false,
  meta                JSONB DEFAULT '{}',      -- platform specifics: telegram folder_id, discord guild hints, tiktok pipeline_stage, etc.
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conversations_account ON conversations(platform_account_id);
CREATE INDEX idx_conversations_last_msg ON conversations(last_message_at DESC);
CREATE INDEX idx_conversations_unread ON conversations(platform_account_id) WHERE unread_count > 0 AND archived = false;
CREATE UNIQUE INDEX idx_conversations_peer ON conversations(platform_account_id, peer_id);

-- ============================================
-- Unified Messages
-- ============================================

CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body                TEXT,
  sent_at             TIMESTAMPTZ NOT NULL,
  author_name         TEXT,                    -- "Them" or peer name for incoming
  meta                JSONB DEFAULT '{}',      -- media, attachments, platform raw ids, etc.
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, sent_at DESC);

-- ============================================
-- Optional: Leads / Contacts (for future cross-platform)
-- ============================================

CREATE TABLE contacts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name        TEXT,
  platforms           JSONB DEFAULT '[]',      -- array of {platform, peer_id, username}
  meta                JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Notes
-- ============================================

-- For now, keep platform-specific notes inside meta or have a separate notes table.
-- Example: conversations can have notes via meta or a separate table if needed later.

COMMENT ON TABLE platform_accounts IS 'Operator owns these. One account can have multiple platform_accounts (e.g. 5 Discords + 3 Telegrams).';
COMMENT ON TABLE conversations IS 'Normalized for unified inbox. Source of truth for the OmniDash view.';
COMMENT ON COLUMN conversations.meta IS 'Platform differences live here so core schema stays clean. Transformers are responsible for populating it correctly.';

-- Example of how a transformer would insert:
-- INSERT INTO conversations (platform_account_id, platform, peer_id, ...) 
-- VALUES (...);
-- The platform backends (or sync workers) call into the unified layer to keep this table up to date.
