-- 0034: outreach daily cap enforcement + FR warmup gate bypass

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'tenant_main' AND tablename = 'fr_campaigns') THEN
    ALTER TABLE tenant_main.fr_campaigns
      ADD COLUMN IF NOT EXISTS bypass_warmup_gate boolean NOT NULL DEFAULT false;
  END IF;
END $$;
