-- v0.80: Per-campaign send interval controls.
--   warmup_campaigns  → between_account_interval_minutes (global cooldown between any two account sends)
--   fr_campaigns      → inter_send_seconds (minimum gap between any two FR sends in the campaign)

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'tenant_main' AND tablename = 'warmup_campaigns') THEN
    ALTER TABLE tenant_main.warmup_campaigns
      ADD COLUMN IF NOT EXISTS between_account_interval_minutes integer NOT NULL DEFAULT 10;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'tenant_main' AND tablename = 'fr_campaigns') THEN
    ALTER TABLE tenant_main.fr_campaigns
      ADD COLUMN IF NOT EXISTS inter_send_seconds integer NOT NULL DEFAULT 60;
  END IF;
END $$;
