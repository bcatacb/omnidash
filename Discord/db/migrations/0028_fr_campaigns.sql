-- v0.79: Friend Request campaign module.
CREATE TABLE IF NOT EXISTS tenant_main.fr_campaigns (
  id                     text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                   text NOT NULL,
  status                 text NOT NULL DEFAULT 'draft',
  mode                   text NOT NULL DEFAULT 'fr_only',
  guild_id               text,
  template               text,
  fr_per_account_per_day int  NOT NULL DEFAULT 20,
  min_interval_seconds   int  NOT NULL DEFAULT 300,
  max_interval_seconds   int  NOT NULL DEFAULT 900,
  combo_interval_seconds int  NOT NULL DEFAULT 300,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_main.fr_campaign_leads (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id         text NOT NULL REFERENCES tenant_main.fr_campaigns(id) ON DELETE CASCADE,
  discord_user_id     text NOT NULL,
  display_name        text,
  assigned_account_id text,
  status              text NOT NULL DEFAULT 'pending',
  fr_sent_at          timestamptz,
  fr_accepted_at      timestamptz,
  dm_sent_at          timestamptz,
  next_eligible_at    timestamptz,
  fr_due_at           timestamptz,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS fr_campaign_leads_campaign_status
  ON tenant_main.fr_campaign_leads(campaign_id, status);

-- Outreach+FR combo columns — guarded so migration succeeds even if these
-- tables don't exist yet on older installs.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'tenant_main' AND tablename = 'campaigns') THEN
    ALTER TABLE tenant_main.campaigns
      ADD COLUMN IF NOT EXISTS fr_enabled       boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS fr_mode          text    DEFAULT 'dm_then_fr',
      ADD COLUMN IF NOT EXISTS fr_combo_seconds int     DEFAULT 300;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'tenant_main' AND tablename = 'campaign_leads') THEN
    ALTER TABLE tenant_main.campaign_leads
      ADD COLUMN IF NOT EXISTS fr_sent_at     timestamptz,
      ADD COLUMN IF NOT EXISTS fr_accepted_at timestamptz,
      ADD COLUMN IF NOT EXISTS fr_due_at      timestamptz;
  END IF;
END $$;
