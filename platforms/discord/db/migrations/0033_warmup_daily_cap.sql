DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'tenant_main' AND tablename = 'warmup_campaigns') THEN
    ALTER TABLE tenant_main.warmup_campaigns
      ADD COLUMN IF NOT EXISTS daily_send_cap integer NOT NULL DEFAULT 15;
  END IF;
END $$;
