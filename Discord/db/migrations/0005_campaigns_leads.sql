-- 0005_campaigns_leads.sql
--
-- v0.8: real campaign engine. Drops the placeholder `leads` table from 0002
-- (it was uuid-keyed and didn't have campaign_id) and recreates `campaigns` +
-- `leads` matching what the engine actually writes.
--
-- Run order: AFTER 0004. Idempotent (DROP IF EXISTS + CREATE).

DROP TABLE IF EXISTS tenant_main.leads CASCADE;
DROP TABLE IF EXISTS tenant_main.campaigns CASCADE;

CREATE TABLE tenant_main.campaigns (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  account_ids         text[] NOT NULL DEFAULT '{}',
  template            text NOT NULL DEFAULT '',
  rate_per_hour       integer NOT NULL DEFAULT 5,
  rate_per_day        integer NOT NULL DEFAULT 30,
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','running','paused','finished')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  totals_queued       integer NOT NULL DEFAULT 0,
  totals_sent         integer NOT NULL DEFAULT 0,
  totals_accepted     integer NOT NULL DEFAULT 0,
  totals_declined     integer NOT NULL DEFAULT 0
);

CREATE INDEX campaigns_status_idx ON tenant_main.campaigns (status);
CREATE INDEX campaigns_created_at_idx ON tenant_main.campaigns (created_at DESC);

CREATE TABLE tenant_main.leads (
  id                  text PRIMARY KEY,
  campaign_id         text REFERENCES tenant_main.campaigns(id) ON DELETE CASCADE,
  discord_user_id     text NOT NULL,
  display_name        text,
  source              text NOT NULL DEFAULT 'manual',
  assigned_account_id text REFERENCES tenant_main.discord_accounts(id) ON DELETE SET NULL,
  fr_status           text NOT NULL DEFAULT 'pending'
                      CHECK (fr_status IN ('pending','sent','accepted','declined','expired','error')),
  dm_status           text NOT NULL DEFAULT 'none'
                      CHECK (dm_status IN ('none','sent','replied','archived')),
  fr_sent_at          timestamptz,
  fr_resolved_at      timestamptz,
  fr_error            text,
  conversation_id     text REFERENCES tenant_main.conversations(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_campaign_idx ON tenant_main.leads (campaign_id);
CREATE INDEX leads_fr_status_idx ON tenant_main.leads (fr_status);
CREATE INDEX leads_discord_user_id_idx ON tenant_main.leads (discord_user_id);
CREATE INDEX leads_assigned_account_idx ON tenant_main.leads (assigned_account_id);
